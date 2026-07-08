/**
 * server/index.ts — Mournvale WebSocket Server
 *
 * Manages the full player lifecycle:
 *   pending → character_creation → active
 *
 * All messages conform to the ClientMessage / ServerMessage
 * discriminated unions in src/types/network.ts.
 *
 * Architecture note: Message routing lives here (the "controller").
 * Business logic lives in CharacterManager and command handlers.
 * This file should only orchestrate — not implement game logic.
 *
 * Phase 2: handleTalk now accepts an optional TalkIntent and runs a
 * skill check when the NPC has a matching dialogue branch.
 *
 * Phase 3: combat_submit_action handler collects player submissions
 * and resolves the round once all players have submitted.
 */

import { WebSocketServer, WebSocket, RawData } from "ws";
import { createServer } from "http";
import * as path from "path";
import * as os from "os";
import { randomUUID } from "crypto";
import { createStaticHandler } from "./httpStatic";
import { handleCommand } from "./commands";
import { say } from "./commands/say";
import { look } from "./commands/look";
import { broadcastToRoom, sendToPlayer } from "./roomUtils";
import { players, rooms, getDisplayName, getActivePlayersInRoom, getPlayerById, getPlayerByPlayerId } from "./gameState";
import {
  getDialogueForStep,
  getNextStep,
  getFirstStep,
  applyAnswer,
  finalizeDraft,
} from "./character/CharacterManager";
import { JsonFileSaveStore, buildSaveData } from "./persistence/SaveStore";
import type { SaveStore } from "./persistence/SaveStore";
import { PartyManager } from "./party/PartyManager";
import { QuestManager } from "./quest/QuestManager";
import { EPILOGUE_SCENES } from "./quest/epilogue";
import { worldManager } from "./world/WorldManager";
import { TOWN_CODEX } from "./world/townCodex";
import { combatManager, buildPlayerCombatEntity, buildEnemyFromTemplate } from "./combat/CombatManager";
import { getEnemyTemplate } from "./combat/enemyTemplates";
import type {
  ClientMessage,
  ServerMessage,
  CharacterCreationStep,
} from "../types/network";
import type { TalkIntent, NPC } from "../types/npc";
import type { Player } from "../types/game";
import type { CharacterClass, Skill } from "../types/character";
import { buildCharacterStats } from "../types/character";
import { rollSkillCheck, type CheckTier } from "./skills/SkillEngine";
import { NpcChatService } from "./dialogue/NpcChatService";
import { OllamaBrain } from "./dialogue/OllamaBrain";
import { ScriptedBrain } from "./dialogue/ScriptedBrain";
import { inferIntent, skillForIntent, TIER_LABEL } from "./dialogue/NpcBrain";
import { buildPlayerContext } from "./dialogue/playerContext";
import {
  newSocialMemory, dispositionWith, applyTalkOutcome,
  dispositionDcModifier, dispositionGuidance, bandChangeNotice,
} from "./social/disposition";
import {
  rumorMill, rumorInfluence, clampReputation, buildRumorContext,
} from "./social/rumors";
import {
  newInventory, addItem, itemById, itemByName, equip, unequip, buy, sell, sellValue,
} from "../types/items";
import type { ItemSlot } from "../types/items";
import { buildInventoryView, buildShopView } from "./character/inventoryScreen";
import { vendorPrice } from "./world/vendor";

/** Gold a freshly-created character starts with. */
const STARTING_GOLD = 50;
import {
  newProgression, awardXp, levelForXp,
  spendTalentPoint, spendAttributePoint, equipAbility, unequipSlot, ABILITY_SLOTS,
} from "../types/progression";
import { CLASS_TALENT_TREES } from "../types/talents";
import { ABILITY_SCORE_NAMES, type AbilityScore } from "../types/character";
import { buildSkillScreenView } from "./character/skillScreen";


// ─────────────────────────────────────────────
// SERVER SETUP
// ─────────────────────────────────────────────

/** Port comes from the environment (cloud hosts inject PORT), else 3000. */
const PORT = Number(process.env["PORT"]) || 3000;

/**
 * One HTTP server serves the built client (dist/client) AND hosts the
 * WebSocket — so the whole game lives at a single address/port. Players load
 * the page from here and the client connects its socket back to the same
 * origin (see resolveServerUrl in the client). In dev, Vite serves the client
 * separately and this static dir is simply unused.
 */
const CLIENT_DIR = path.resolve(process.cwd(), "dist/client");
const httpServer = createServer(createStaticHandler(CLIENT_DIR));
const server = new WebSocketServer({ server: httpServer });

const saveStore: SaveStore = new JsonFileSaveStore();
const partyManager = new PartyManager();
const questManager = new QuestManager();

/**
 * Free-text NPC dialogue. Prefers a local Ollama LLM (free, no key — see
 * OllamaBrain) and falls back to the authored scripted dialogue when Ollama
 * isn't running. ScriptedBrain must stay last (it's the guaranteed floor).
 */
const npcChat = new NpcChatService([new OllamaBrain(), new ScriptedBrain()]);

/** DC for a free-text conversational skill check (easy — casual talk should
 * land warm more often than not; raise it for pricklier NPCs later). */
const NPC_CHAT_DC = 10;

/**
 * Action verbs that force a conversational approach: `persuade Aldric <words>`.
 * Without one of these, `say`/`ask` infers the approach from the player's words.
 */
const SPEAK_INTENT_VERBS: Record<string, TalkIntent> = {
  persuade: "persuade",
  intimidate: "intimidate",
  inquire: "inquire",
  deceive: "deceive",
};

/**
 * Maps playerId → WebSocket so we can send targeted messages during
 * combat (each player gets a personalised CombatStateView).
 */
const playerSockets = new Map<string, WebSocket>();

/** Every non-internal IPv4 address this machine has — the URLs LAN players use. */
function lanUrls(port: number): string[] {
  const urls: string[] = [];
  for (const ifaces of Object.values(os.networkInterfaces())) {
    for (const iface of ifaces ?? []) {
      if (iface.family === "IPv4" && !iface.internal) {
        urls.push(`http://${iface.address}:${port}`);
      }
    }
  }
  return urls;
}

// A friendly diagnosis instead of a raw stack trace when the port is taken —
// the usual cause is the always-on PM2 server already holding it.
httpServer.on("error", (err: NodeJS.ErrnoException) => {
  if (err.code === "EADDRINUSE") {
    console.error(`✖ Port ${PORT} is already in use — another Mournvale server is likely running.`);
    console.error(`  If it's the always-on PM2 server, that's normal: dev uses port 3001 (npm run dev).`);
    console.error(`  Check with:  pm2 status   ·   lsof -nP -iTCP:${PORT} -sTCP:LISTEN`);
    console.error(`  Or run this instance on another port:  PORT=${PORT + 1} npm start`);
    process.exit(1);
  }
  throw err;
});

// Bind all interfaces (0.0.0.0) so the server is reachable from other machines
// — LAN, a tunnel, or a cloud host — not just localhost.
httpServer.listen(PORT, () => {
  console.log(`🏰 Mournvale listening on http://localhost:${PORT}`);
  const urls = lanUrls(PORT);
  if (urls.length > 0) {
    console.log(`   Players on your network join at: ${urls.join("  or  ")}`);
  }
  console.log(`   (For play beyond the LAN, use a tunnel or domain pointed at this host.)`);
});

// ─────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────

/** Send a message to a specific player by their persistent playerId. */
function emitToPlayer(playerId: string, msg: ServerMessage): void {
  const socket = playerSockets.get(playerId);
  if (socket) sendToPlayer(socket, msg);
}

/**
 * Re-sends the room snapshot to everyone standing in `roomId` (optionally
 * excluding one session id). Call after any presence change — a player moving,
 * entering the world, or disconnecting — so the "Here:" panel every occupant
 * sees stays live, not just the mover's.
 */
function refreshRoomOccupants(roomId: string | undefined, excludeSessionId?: string): void {
  if (!roomId) return;
  for (const p of getActivePlayersInRoom(roomId)) {
    if (p.id === excludeSessionId) continue;
    sendRoomUpdate(p, p.socket);
  }
}

// ─────────────────────────────────────────────
// CONNECTION HANDLER
// ─────────────────────────────────────────────

server.on("connection", (socket: WebSocket) => {
  const player: Player = {
    id: randomUUID(),
    socket,
    state: "menu",
    tempName: `Traveler-${Math.floor(Math.random() * 9999)}`,
    draft: {},
  };

  players.set(socket, player);

  console.log(`[+] ${player.tempName} connected (${player.id})`);

  sendToPlayer(socket, {
    type: "system",
    payload: { message: "Connected to Mournvale." },
  });

  // ─────────────────────────────────────────────
  // MESSAGE HANDLER
  // ─────────────────────────────────────────────

  socket.on("message", (raw: RawData) => {
    const currentPlayer = players.get(socket);
    if (!currentPlayer) return;

    let msg: ClientMessage;
    try {
      msg = JSON.parse(raw.toString()) as ClientMessage;
    } catch {
      sendToPlayer(socket, { type: "system", payload: { message: "Invalid message format." } });
      return;
    }

    console.log(`[${currentPlayer.tempName}] state:${currentPlayer.state} type:${msg.type}`);

    if (msg.type === "identify") {
      handleIdentify(currentPlayer, socket, msg.payload.playerId);
      return;
    }

    switch (currentPlayer.state) {
      case "menu":
        void handleMenuMessage(currentPlayer, socket, msg);
        break;
      case "pending":
        handlePendingMessage(currentPlayer, socket, msg);
        break;
      case "character_creation":
        handleCreationMessage(currentPlayer, socket, msg);
        break;
      case "active":
        handleActiveMessage(currentPlayer, socket, msg);
        break;
    }
  });

  // ─────────────────────────────────────────────
  // DISCONNECT HANDLER
  // ─────────────────────────────────────────────

  socket.on("close", () => {
    const currentPlayer = players.get(socket);
    if (!currentPlayer) return;

    console.log(`[-] ${getDisplayName(currentPlayer)} disconnected`);

    if (
      currentPlayer.state === "active" &&
      currentPlayer.character &&
      currentPlayer.roomId &&
      currentPlayer.playerId &&
      currentPlayer.activeSlot
    ) {
      const data = buildSaveData(currentPlayer.character, currentPlayer.roomId, currentPlayer.progression, currentPlayer.social, currentPlayer.inventory, currentPlayer.lore);
      const { playerId, activeSlot } = currentPlayer;
      saveStore
        .save(playerId, activeSlot, data)
        .then(() => console.log(`[save] Auto-saved ${data.character.name} to slot ${activeSlot} on disconnect.`))
        .catch((err) => console.error(`[save] Auto-save failed for ${playerId}:`, err));
    }

    if (currentPlayer.state === "active" && currentPlayer.roomId) {
      broadcastToRoom(currentPlayer.roomId, {
        type: "player_presence",
        payload: { playerName: getDisplayName(currentPlayer), event: "left" },
      }, currentPlayer.id);
    }

    // Leaving mid-fight counts as falling: the entity dies and the round no
    // longer waits on them. Otherwise one closed tab froze the combat (and
    // the room it locked) forever, and party members waited on a ghost.
    if (currentPlayer.playerId) {
      const combatExit = combatManager.removePlayer(currentPlayer.playerId);
      if (combatExit) {
        if (!combatExit.playersRemain) {
          // Nobody left standing on the players' side — dissolve the fight.
          // The hostiles were never defeated, so they simply remain.
          combatManager.endCombat(combatExit.combatId);
          console.log(`[combat] Fight in ${combatExit.roomId} dissolved — last player disconnected.`);
        } else {
          const combatState = combatManager.getState(combatExit.combatId);
          if (combatState) {
            const remaining = combatState.entities
              .filter(e => e.type === "player" && e.playerId && e.playerId !== currentPlayer.playerId)
              .map(e => e.playerId!);
            for (const pid of remaining) {
              emitToPlayer(pid, {
                type: "system",
                payload: { message: `${getDisplayName(currentPlayer)} is swallowed by the fog — they fight no more.` },
              });
            }
            if (combatState.phase === "planning" && combatState.pendingSubmissions.length === 0) {
              // The leaver was the last one everyone was waiting on.
              resolveCombatRound(combatExit.combatId);
            } else {
              // Refresh each survivor's "waiting on…" list minus the leaver.
              const pendingPlayerIds = combatState.pendingSubmissions
                .map(eid => combatState.entities.find(e => e.id === eid)?.playerId)
                .filter((pid): pid is string => pid !== undefined);
              for (const pid of remaining) {
                const view = combatManager.getViewForPlayer(combatExit.combatId, pid);
                if (!view) continue;
                emitToPlayer(pid, {
                  type: "combat_planning",
                  payload: { combatId: combatExit.combatId, round: combatState.round, state: view, pendingPlayerIds },
                });
              }
            }
          }
        }
      }
    }

    // A solo player's active quest would otherwise be orphaned forever under
    // their session id — hand it back to the board so others can take it.
    // (Party quests are handled by the disband path below.)
    if (!partyManager.getPartyId(currentPlayer.id)) {
      questManager.abandon(currentPlayer.id);
    }

    const partyIdBefore = partyManager.getPartyId(currentPlayer.id);
    const partyResult   = partyManager.handleDisconnect(currentPlayer.id);

    // Remove from socket map before deleting player
    if (currentPlayer.playerId) playerSockets.delete(currentPlayer.playerId);
    npcChat.clearHistory(currentPlayer.id);
    players.delete(socket);

    // Now that they're gone from the map, update the "Here:" panel of
    // everyone still standing in the room they left.
    if (currentPlayer.state === "active") {
      refreshRoomOccupants(currentPlayer.roomId);
    }

    if (partyResult.disbanded) {
      if (partyIdBefore) questManager.abandon(partyIdBefore);
      for (const id of partyResult.formerMembers) {
        if (id === currentPlayer.id) continue;
        const p = getPlayerById(id);
        if (p) {
          sendToPlayer(p.socket, { type: "party_update", payload: { party: null } });
          sendToPlayer(p.socket, { type: "system", payload: { message: "Your party has disbanded." } });
          sendQuestBoard(p, p.socket);
        }
      }
    } else if (partyResult.stillInParty.length > 0) {
      for (const id of partyResult.stillInParty) sendPartyUpdate(id);
    }
  });
});

// ─────────────────────────────────────────────
// STATE HANDLERS
// ─────────────────────────────────────────────

function handleIdentify(player: Player, socket: WebSocket, playerId: string): void {
  if (player.playerId) return;
  const trimmed = (playerId ?? "").trim();
  if (trimmed.length < 8 || trimmed.length > 64) {
    sendToPlayer(socket, { type: "system", payload: { message: "Invalid player identity." } });
    return;
  }
  player.playerId = trimmed;
  playerSockets.set(trimmed, socket);
  console.log(`[id] ${player.tempName} identified as ${trimmed}`);
  void sendSlotList(player, socket);
}

async function handleMenuMessage(
  player: Player,
  socket: WebSocket,
  msg: ClientMessage
): Promise<void> {
  if (!player.playerId) {
    sendToPlayer(socket, { type: "system", payload: { message: "Please wait — still connecting." } });
    return;
  }

  switch (msg.type) {
    case "request_slots":
      await sendSlotList(player, socket);
      return;

    case "new_game": {
      const slot = msg.payload.slot;
      if (!isValidSlot(slot)) {
        sendToPlayer(socket, { type: "system", payload: { message: "Invalid save slot." } });
        return;
      }
      player.activeSlot = slot;
      player.state      = "pending";
      player.draft      = {};
      sendToPlayer(socket, { type: "state_transition", payload: { newState: "pending" } });
      return;
    }

    case "load_game": {
      const slot = msg.payload.slot;
      if (!isValidSlot(slot)) {
        sendToPlayer(socket, { type: "system", payload: { message: "Invalid save slot." } });
        return;
      }
      const data = await saveStore.load(player.playerId, slot);
      if (!data) {
        sendToPlayer(socket, { type: "system", payload: { message: "That slot is empty." } });
        await sendSlotList(player, socket);
        return;
      }
      player.activeSlot  = slot;
      player.character   = data.character;
      // load() migrates v1 saves, so progression is always present; fall back
      // defensively just in case.
      player.progression = data.progression ?? newProgression(data.character.characterClass);
      player.social      = data.social ?? newSocialMemory();
      player.inventory   = data.inventory ?? newInventory();
      player.lore        = data.lore ?? [];
      player.roomId      = rooms[data.roomId] ? data.roomId : "tavern";
      player.state       = "active";

      sendToPlayer(socket, {
        type: "character_confirmed",
        payload: {
          name:           data.character.name,
          characterClass: data.character.characterClass,
          gender:         data.character.gender,
          hairColor:      data.character.hairColor,
          glasses:        data.character.glasses,
        },
      });
      sendToPlayer(socket, { type: "state_transition", payload: { newState: "active" } });
      sendRoomUpdate(player, socket);
      broadcastToRoom(player.roomId, {
        type: "player_presence",
        payload: { playerName: data.character.name, event: "entered" },
      }, player.id);
      refreshRoomOccupants(player.roomId, player.id);
      sendToPlayer(socket, { type: "system", payload: { message: `Welcome back, ${data.character.name}.` } });
      console.log(`[load] ${data.character.name} loaded from slot ${slot} into ${player.roomId}.`);
      return;
    }

    case "delete_slot": {
      const slot = msg.payload.slot;
      if (!isValidSlot(slot)) {
        sendToPlayer(socket, { type: "system", payload: { message: "Invalid save slot." } });
        return;
      }
      await saveStore.delete(player.playerId, slot);
      sendToPlayer(socket, { type: "save_result", payload: { success: true, slot, message: "Save deleted." } });
      await sendSlotList(player, socket);
      return;
    }

    default:
      sendToPlayer(socket, { type: "system", payload: { message: "Choose New Game or Load Game." } });
  }
}

async function sendSlotList(player: Player, socket: WebSocket): Promise<void> {
  if (!player.playerId) return;
  try {
    const slots = await saveStore.listSlots(player.playerId);
    sendToPlayer(socket, { type: "slot_list", payload: { slots } });
  } catch (err) {
    console.error("[save] Failed to list slots:", err);
    sendToPlayer(socket, { type: "system", payload: { message: "Could not load your saves." } });
  }
}

function isValidSlot(slot: number): boolean {
  return Number.isInteger(slot) && slot >= 1 && slot <= 5;
}

function handlePendingMessage(player: Player, socket: WebSocket, msg: ClientMessage): void {
  if (msg.type !== "intro_complete") {
    sendToPlayer(socket, { type: "system", payload: { message: "Please wait for the introduction to complete." } });
    return;
  }
  player.state = "character_creation";
  sendToPlayer(socket, { type: "state_transition", payload: { newState: "character_creation" } });
  const firstStep = getFirstStep();
  sendToPlayer(socket, getDialogueForStep(firstStep, player.draft));
}

function handleCreationMessage(player: Player, socket: WebSocket, msg: ClientMessage): void {
  if (msg.type !== "dialogue_choice") {
    sendToPlayer(socket, { type: "system", payload: { message: "Please complete character creation first." } });
    return;
  }

  const { step, value } = msg.payload;

  if (step === "confirm" && value === "restart") {
    player.draft = {};
    sendToPlayer(socket, { type: "system", payload: { message: "Very well — let's start again." } });
    sendToPlayer(socket, getDialogueForStep(getFirstStep(), player.draft));
    return;
  }

  const error = applyAnswer(step, value, player.draft);
  if (error) {
    sendToPlayer(socket, { type: "system", payload: { message: error } });
    sendToPlayer(socket, getDialogueForStep(step, player.draft));
    return;
  }

  if (step === "confirm" && value === "confirm") {
    try {
      const character  = finalizeDraft(player.draft);
      player.character = character;
      player.progression = newProgression(character.characterClass);
      player.social    = newSocialMemory();
      player.inventory = addItem(newInventory(STARTING_GOLD), "healing_potion", 2);
      player.lore      = [];
      player.state     = "active";
      player.roomId    = "tavern";

      sendToPlayer(socket, {
        type: "character_confirmed",
        payload: {
          name:           character.name,
          characterClass: character.characterClass,
          gender:         character.gender,
          hairColor:      character.hairColor,
          glasses:        character.glasses,
        },
      });
      sendToPlayer(socket, { type: "state_transition", payload: { newState: "active" } });
      sendRoomUpdate(player, socket);
      broadcastToRoom("tavern", {
        type: "player_presence",
        payload: { playerName: character.name, event: "entered" },
      }, player.id);
      refreshRoomOccupants("tavern", player.id);
      sendToPlayer(socket, {
        type: "dialogue",
        payload: {
          speaker: "Aldric the Barkeep",
          text: `Welcome to Mournvale, ${character.name}. Watch yourself out there. The fog's been thicker than usual.`,
        },
      });

      if (player.playerId && player.activeSlot) {
        const data = buildSaveData(character, player.roomId, player.progression, player.social, player.inventory, player.lore);
        const { playerId, activeSlot } = player;
        saveStore
          .save(playerId, activeSlot, data)
          .then(() => console.log(`[save] Initial save of ${character.name} to slot ${activeSlot}.`))
          .catch((err) => console.error(`[save] Initial save failed:`, err));
      }

      console.log(`[★] ${character.name} (${character.characterClass}) entered the world.`);
    } catch {
      sendToPlayer(socket, { type: "system", payload: { message: "Something went wrong creating your character. Please try again." } });
      player.draft = {};
      sendToPlayer(socket, getDialogueForStep(getFirstStep(), player.draft));
    }
    return;
  }

  const nextStep = getNextStep(step as CharacterCreationStep);
  if (nextStep) sendToPlayer(socket, getDialogueForStep(nextStep, player.draft));
}

function handleActiveMessage(player: Player, socket: WebSocket, msg: ClientMessage): void {
  switch (msg.type) {
    case "command": {
      // Character/skills screen commands need the Player + socket to emit a
      // typed SkillScreenMessage, which the string-returning handleCommand
      // can't do — intercept them here before falling through.
      if (handleSkillCommand(player, socket, msg.payload.input)) return;
      // `look`/`examine` is enriched with quest-aware clues, which need the
      // questManager — intercept before the plain string-returning pipeline.
      if (handleLookCommand(player, socket, msg.payload.input)) return;
      // `fight` starts combat in the player's room — also needs the Player.
      if (handleFightCommand(player, socket, msg.payload.input)) return;
      // `say`/`speak`/`ask`/`chat` is the one unified speech verb — routes to a
      // room broadcast or an NPC conversation depending on who's addressed.
      if (handleSpeakCommand(player, socket, msg.payload.input)) return;
      // `inventory`/`inv`/`i`/`bag` opens the pack (typed SkillScreen-style view).
      if (handleInventoryCommand(player, socket, msg.payload.input)) return;
      // `shop`/`trade`/`buy`/`sell` opens the room's vendor stall, if one's here.
      if (handleShopCommand(player, socket, msg.payload.input)) return;

      const roomBefore = player.roomId;
      const response = handleCommand(player.id, msg.payload.input);
      if (response) sendToPlayer(socket, { type: "system", payload: { message: response } });
      if (["north", "south", "east", "west", "up", "down"].includes(
        msg.payload.input.trim().split(" ")[0]?.toLowerCase() ?? ""
      )) {
        sendRoomUpdate(player, socket);
        // Keep everyone else's "Here:" panel live: the room left behind and
        // the room entered both changed occupants.
        if (player.roomId !== roomBefore) {
          refreshRoomOccupants(roomBefore, player.id);
          refreshRoomOccupants(player.roomId, player.id);
        }
        // Entering a room may satisfy a non-combat quest's field objective.
        maybeAdvanceFieldQuest(player);
        // A player moving is the town's heartbeat: advance gossip one hop so
        // word of deeds (and misdeeds) travels NPC→NPC over time.
        rumorMill.propagate();
      }
      return;
    }

    case "party_invite_send":
      handlePartyInviteSend(player, socket, msg.payload.targetName);
      return;

    case "party_invite_respond":
      handlePartyInviteRespond(player, socket, msg.payload.fromPlayerId, msg.payload.accept);
      return;

    case "party_leave":
      handlePartyLeave(player, socket);
      return;

    case "party_member_sheet_request":
      handlePartyMemberSheetRequest(player, socket, msg.payload.memberId);
      return;

    case "quest_board_request":
      sendQuestBoard(player, socket);
      return;

    case "quest_accept":
      handleQuestAccept(player, socket, msg.payload.questId);
      return;

    case "quest_abandon":
      handleQuestAbandon(player, socket);
      return;

    case "inventory_request":
      sendInventory(player, socket);
      return;

    case "inventory_action":
      handleInventoryAction(player, socket, msg.payload);
      return;

    case "shop_action":
      handleShopAction(player, socket, msg.payload);
      return;

    case "talk":
      handleTalk(player, socket, msg.payload.targetName, msg.payload.intent);
      return;

    case "combat_submit_action":
      handleCombatSubmitAction(player, socket, msg.payload.combatId, msg.payload.submission);
      return;

    default:
      sendToPlayer(socket, { type: "system", payload: { message: "Unknown message type." } });
  }
}

// ─────────────────────────────────────────────
// NPC INTERACTION (Phase 2)
// ─────────────────────────────────────────────

/**
 * Handles "talk <name> [intent]".
 *
 * With no intent (or an NPC without matching branches) the existing
 * default dialogue is returned. With an intent, a d20 skill check is
 * run and the NPC responds based on the outcome tier.
 */
function handleTalk(
  player: Player,
  socket: WebSocket,
  targetName: string,
  intent?: TalkIntent
): void {
  if (!player.roomId) return;

  const name = targetName.trim();
  if (!name) {
    sendToPlayer(socket, { type: "system", payload: { message: "Talk to whom?" } });
    return;
  }

  const npc = worldManager.findNpcInRoomByName(player.roomId, name);
  if (!npc) {
    sendToPlayer(socket, {
      type: "system",
      payload: { message: `There's no one named "${name}" here to talk to.` },
    });
    return;
  }

  // Hostile NPCs can't be talked to — trigger combat instead
  if (npc.role === "hostile") {
    sendToPlayer(socket, {
      type: "system",
      payload: { message: `${npc.name} is hostile — you'll need to fight!` },
    });
    return;
  }

  // Reporting back to a quest's turn-in NPC completes it (alongside the
  // NPC's normal dialogue, which still plays below).
  maybeTurnInQuest(player, npc);

  const charClass = player.character?.characterClass ?? "Warrior";
  const result    = worldManager.resolveTalk(charClass, npc, intent);

  sendToPlayer(socket, {
    type: "npc_interaction",
    payload: {
      ...result.view,
      ...(result.checkDisplay  ? { checkDisplay: result.checkDisplay }  : {}),
      ...(result.infoReveal    ? { infoReveal:   result.infoReveal   }  : {}),
    },
  });

  // Conversation moves the story: hearing this NPC at all may teach campaign
  // lore (meetLore), and a won skill check can teach its branch's loreKey —
  // either can open new quests on the board (announced by grantLore).
  maybeGrantMeetLore(player, npc);
  if (intent && result.checkDisplay) {
    const branchLore = npc.dialogueBranches
      ?.find((b) => b.intent === intent)
      ?.outcomes[result.checkDisplay.outcome]?.loreKey;
    if (branchLore) grantLore(player, [branchLore]);
  }

  // Conversation portraits: actor sees the NPC from the left; other room
  // players see the actor slide in from the right.
  sendToPlayer(socket, {
    type: "speaker_portrait",
    payload: { name: npc.name, role: npc.role, side: "left" },
  });
  broadcastToRoom(
    player.roomId,
    { type: "speaker_portrait", payload: { name: player.character?.name ?? "Adventurer", role: "player", side: "right" } },
    player.id
  );

  // Apply side effects from the outcome (quest unlocks handled by view questIds)
  // Future: handle standing changes (hostile NPC standing, etc.)
}

// ─────────────────────────────────────────────
// COMBAT (Phase 3)
// ─────────────────────────────────────────────

/**
 * Handles the `fight` command (from the ⚔ Fight button or typed). Starts
 * combat in the player's current room if it holds hostiles. The target name is
 * ignored — combat engages every hostile in the room. Returns true if the input
 * was a fight command (handled), so the caller skips the normal pipeline.
 */
/**
 * Handles `look` (aliases `l`/`examine`/`inspect`/`x`). Returns the enriched
 * room view (ambient detail + notable objects, see look()/roomDetails.ts) and,
 * when the player is standing in their active quest's objective room, appends
 * that quest's `lookClue` — letting close inspection advance the story.
 * Returns true if the input was a look command (handled).
 */
function handleLookCommand(player: Player, socket: WebSocket, input: string): boolean {
  const verb = input.trim().split(/\s+/)[0]?.toLowerCase() ?? "";
  if (!["look", "l", "examine", "inspect", "x"].includes(verb)) return false;

  let message = look(player.id);

  const ownerKey = questOwnerKey(player);
  const active = questManager.getActive(ownerKey);
  const kind = active?.quest.objectiveKind ?? "clear";
  const here = active && active.quest.objectiveRoomId === player.roomId;

  if (active && here && DISCOVERABLE_KINDS.has(kind)) {
    if (!active.objectiveMet) {
      // First inspection: this is the discovery — grab the item / find the clue.
      questManager.markObjectiveMet(ownerKey);
      message += `\n\n❖ ${active.quest.lookClue ?? FIELD_OBJECTIVE_FLAVOR[kind] ?? "You find what you came for."}`;

      if (active.quest.turnInNpcId) {
        const giver = worldManager.getNpcById(active.quest.turnInNpcId);
        const where = giver ? rooms[giver.roomId]?.name ?? giver.roomId : "the one who sent you";
        message += `\n\nNow report back to ${giver?.name ?? "your patron"}${giver ? ` at ${where}` : ""}.`;
        sendToPlayer(socket, { type: "system", payload: { message } });
      } else {
        // No turn-in step — finding it completes the quest.
        sendToPlayer(socket, { type: "system", payload: { message } });
        grantQuestCompletion(player, ownerKey);
      }
      return true;
    }
    // Already found it — nothing left to take here.
    message += `\n\n❖ You've already found what you came for here. There's nothing more to see.`;
  }

  sendToPlayer(socket, { type: "system", payload: { message } });
  return true;
}

function handleFightCommand(player: Player, socket: WebSocket, input: string): boolean {
  if (input.trim().split(/\s+/)[0]?.toLowerCase() !== "fight") return false;

  if (!player.roomId) {
    sendToPlayer(socket, { type: "system", payload: { message: "You are nowhere to fight." } });
    return true;
  }
  if (worldManager.getHostileNpcsInRoom(player.roomId).length === 0) {
    sendToPlayer(socket, { type: "system", payload: { message: "There's nothing here to fight." } });
    return true;
  }
  if (combatManager.hasCombatInRoom(player.roomId)) {
    sendToPlayer(socket, { type: "system", payload: { message: "The fight here is already underway." } });
    return true;
  }

  triggerCombat(player.roomId);
  return true;
}

/**
 * Unified speech command — `say` (aliases `speak`/`ask`/`chat`). One verb for
 * all conversation: if the first word names a (non-hostile) NPC in the room, it
 * becomes a free-text conversation with them (the d20 + NpcChatService path);
 * otherwise the whole line is broadcast to the room. Returns true if handled.
 */
function handleSpeakCommand(player: Player, socket: WebSocket, input: string): boolean {
  const parts = input.trim().split(/\s+/);
  const verb = parts[0]?.toLowerCase() ?? "";
  const explicitIntent = SPEAK_INTENT_VERBS[verb];
  const isSay = verb === "say" || verb === "speak" || verb === "ask" || verb === "chat";
  if (!isSay && !explicitIntent) return false;

  if (!player.roomId || !player.character) {
    sendToPlayer(socket, { type: "system", payload: { message: "You can't speak right now." } });
    return true;
  }

  const rest = parts.slice(1);

  // ── Explicit action verb: persuade/intimidate/inquire/deceive <npc> <words> ──
  if (explicitIntent) {
    const targetName = rest[0];
    if (!targetName) {
      sendToPlayer(socket, { type: "system", payload: { message: `${capitalize(verb)} whom? Try: ${verb} <name> <message>` } });
      return true;
    }
    const npc = worldManager.findNpcInRoomByName(player.roomId, targetName);
    if (!npc) {
      sendToPlayer(socket, { type: "system", payload: { message: `There's no one named "${targetName}" here to ${verb}.` } });
      return true;
    }
    if (npc.role === "hostile") {
      sendToPlayer(socket, { type: "system", payload: { message: `${npc.name} is in no mood to talk — you'll need to fight.` } });
      return true;
    }
    const message = rest.slice(npcNameTokenCount(rest, npc)).join(" ").trim();
    if (!message) {
      sendToPlayer(socket, { type: "system", payload: { message: `What do you say to ${npc.name}?` } });
      return true;
    }
    runNpcChat(player, socket, npc, message, explicitIntent);
    return true;
  }

  // ── Plain speech: address an NPC by name, else broadcast to the room ──
  if (rest.length === 0) {
    sendToPlayer(socket, {
      type: "system",
      payload: { message: "Say what? Try: say <message> — or say <name> <message> to address someone here." },
    });
    return true;
  }

  const npc = worldManager.findNpcInRoomByName(player.roomId, rest[0]!);
  if (npc) {
    if (npc.role === "hostile") {
      sendToPlayer(socket, { type: "system", payload: { message: `${npc.name} is in no mood to talk — you'll need to fight.` } });
      return true;
    }
    const message = rest.slice(npcNameTokenCount(rest, npc)).join(" ").trim();
    if (!message) {
      sendToPlayer(socket, { type: "system", payload: { message: `What would you like to say to ${npc.name}?` } });
      return true;
    }
    runNpcChat(player, socket, npc, message); // approach inferred from the words
    return true;
  }

  // Otherwise it's room/party chat — broadcast the whole line. Other players
  // in the room also see the speaker's portrait slide in from the left; the
  // speaker themselves sees no portrait (their own line isn't echoed back).
  const response = say(player.id, rest);
  broadcastToRoom(
    player.roomId,
    { type: "speaker_portrait", payload: { name: player.character.name, role: "player", side: "left" } },
    player.id
  );
  if (response) sendToPlayer(socket, { type: "system", payload: { message: response } });
  return true;
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * How many leading tokens of `rest` belong to the NPC's name. The intent
 * buttons prefill "persuade Captain Vey " — matching only rest[0] made the
 * rest of the name ("Vey") leak into the message the NPC was answering.
 * Greedy but safe: it only swallows tokens that are literally part of the
 * matched NPC's name, so real words are never eaten.
 */
function npcNameTokenCount(rest: string[], npc: NPC): number {
  const nameTokens = new Set(npc.name.toLowerCase().split(/\s+/));
  let i = 1; // rest[0] is the token that matched the NPC
  while (i < rest.length && nameTokens.has(rest[i]!.toLowerCase())) i++;
  return i;
}

/**
 * Turns a notable conversational moment into town gossip, seeded at the NPC the
 * player just spoke to. Only the memorable approaches travel: leaning on someone
 * (threat), getting caught in a lie (botched deceive), or charming them utterly
 * (a crit persuade). Ordinary talk leaves no rumor. Dedup lives in RumorMill, so
 * repeatedly threatening the same person doesn't flood the town.
 */
function maybeRecordConversationRumor(
  player: Player,
  npc: NPC,
  intent: TalkIntent,
  tier: CheckTier
): void {
  if (!player.playerId || !player.character) return;
  const base = {
    subjectPlayerId: player.playerId,
    subjectName: player.character.name,
    originNpcId: npc.id,
  };

  if (intent === "intimidate") {
    rumorMill.record({ ...base, kind: "threat", detail: `they put hard words to ${npc.name}` });
  } else if (intent === "deceive" && tier === "crit_fail") {
    rumorMill.record({ ...base, kind: "lie", detail: `${npc.name} caught them in a barefaced lie` });
  } else if (intent === "persuade" && tier === "crit_success") {
    rumorMill.record({ ...base, kind: "charm", detail: `they talked ${npc.name} round sweet as honey` });
  }
}

/**
 * Runs a free-text NPC conversation: rolls the d20 conversational check
 * (server-authoritative), then asks the NpcChatService to render the NPC's
 * words conditioned on the result tier. Acknowledges immediately and delivers
 * the dice reveal + spoken reply when the brain responds (async/detached).
 */
function runNpcChat(
  player: Player,
  socket: WebSocket,
  npc: NPC,
  message: string,
  explicitIntent?: TalkIntent
): void {
  const charClass = player.character!.characterClass;
  // An explicit action verb (persuade/intimidate/…) overrides inference;
  // otherwise the approach is read from the player's own words.
  const intent = explicitIntent ?? inferIntent(message);
  const skill = skillForIntent(intent) as Skill;

  // Drifting relationship: how this NPC already feels about the player both
  // bends the check's difficulty (warm NPCs are easier to sway) and, below,
  // shifts based on how this exchange lands — kindness compounds, a lean on
  // someone costs you rapport. Defensive default for pre-v3 sessions.
  if (!player.social) player.social = newSocialMemory();
  const priorScore = dispositionWith(player.social, npc.id);

  // Reputation that precedes them: rumors THIS npc has heard about the player
  // transiently color this conversation (a stranger whose deeds — or misdeeds —
  // outran them). Rumor influence is never baked into stored rapport; only
  // face-to-face dealings persist (applyTalkOutcome reads priorScore directly).
  const heardRumors = player.playerId ? rumorMill.knownBy(npc.id, player.playerId) : [];
  const effectiveScore = clampReputation(priorScore + rumorInfluence(heardRumors));
  const effectiveDc = Math.max(2, NPC_CHAT_DC + dispositionDcModifier(effectiveScore));
  const roll = rollSkillCheck(buildCharacterStats(charClass), skill, effectiveDc);

  // Fold the outcome into the relationship now (the tier is known immediately;
  // it doesn't depend on the LLM) and persist it. The shift is captured so the
  // .then() below can announce a relationship that visibly crossed a band.
  const shift = applyTalkOutcome(player.social, npc.id, intent, roll.tier);
  player.social = shift.memory;
  saveProgress(player);

  // This exchange itself becomes talk: leaning on someone, getting caught in a
  // lie, or charming them spreads from THIS npc out across the town graph.
  maybeRecordConversationRumor(player, npc, intent, roll.tier);

  const skillName = skill.charAt(0).toUpperCase() + skill.slice(1);
  const modSign = roll.roll.modifier >= 0 ? "+" : "";

  // Reporting back to a quest's turn-in NPC completes it before the chat plays.
  maybeTurnInQuest(player, npc);

  // Acknowledge immediately so the player isn't staring at a blank pause.
  sendToPlayer(socket, { type: "system", payload: { message: `${npc.name} considers your words…` } });

  // Conversation portraits: the speaker sees the NPC slide in from the left;
  // everyone else in the room sees the speaker slide in from the right.
  sendToPlayer(socket, {
    type: "speaker_portrait",
    payload: { name: npc.name, role: npc.role, side: "left" },
  });
  broadcastToRoom(
    player.roomId!,
    { type: "speaker_portrait", payload: { name: player.character!.name, role: "player", side: "right" } },
    player.id
  );

  const roomName = rooms[player.roomId!]?.name ?? "Mournvale";
  const playerName = player.character!.name;

  // Live, per-conversation knowledge: the quest the player has actually accepted,
  // whether they're in a party, and how seasoned they are. Lets the NPC react to
  // what the player is genuinely doing right now (the giver can ask after their job).
  const inParty = partyManager.getPartyId(player.id) !== null;
  const playerContext = buildPlayerContext({
    npc,
    activeQuest: questManager.getActive(questOwnerKey(player)),
    inParty,
    ...(player.progression ? { level: player.progression.level } : {}),
  });

  // The NPC's standing feeling toward the player coming into this conversation
  // (direct rapport tempered by what they've heard), so the LLM speaks with the
  // warmth or wariness the player has actually earned — by deed and by reputation.
  const dispositionContext = dispositionGuidance(effectiveScore);
  const rumorContext = buildRumorContext(heardRumors) ?? undefined;

  void npcChat
    .respond(player.id, { npc, playerName, playerClass: charClass, message, skill, intent, tier: roll.tier, roomName, worldContext: TOWN_CODEX, playerContext, dispositionContext, ...(rumorContext && { rumorContext }) })
    .then(({ reply }) => {
      // The dice reveal (so the d20 is visible), then the NPC's spoken line.
      sendToPlayer(socket, {
        type: "system",
        payload: {
          message: `${skillName} — ${roll.roll.result} ${modSign}${roll.roll.modifier} = ${roll.roll.total} vs DC ${effectiveDc} — ${TIER_LABEL[roll.tier]}`,
        },
      });
      sendToPlayer(socket, { type: "chat", payload: { speaker: npc.name, message: reply } });

      // If this exchange visibly moved the relationship into a new band, say so —
      // the player feels the NPC warming to them or souring across visits.
      const moodLine = bandChangeNotice(npc.name, shift);
      if (moodLine) {
        sendToPlayer(socket, { type: "system", payload: { message: moodLine } });
      }

      // Authored mechanical payoff: if this NPC has a branch for the approach
      // taken, the rolled tier can still reveal lore / nudge a quest — the dice
      // matter regardless of whether an LLM or the scripted brain wrote the words.
      const outcome = npc.dialogueBranches?.find((b) => b.intent === intent)?.outcomes[roll.tier];
      if (outcome?.infoReveal) {
        sendToPlayer(socket, { type: "system", payload: { message: `You glean something: ${outcome.infoReveal}` } });
      }
      if (outcome?.questUnlock) {
        sendToPlayer(socket, { type: "system", payload: { message: `${npc.name} has work for you — check the quest board.` } });
      }

      // Conversation moves the story: being heard at all can teach campaign
      // lore (meetLore), and a won check can teach the branch's loreKey —
      // either may open new quests on the board (announced by grantLore).
      maybeGrantMeetLore(player, npc);
      if (outcome?.loreKey) grantLore(player, [outcome.loreKey]);
    })
    .catch((err) => {
      console.error("[npc-chat] reply failed:", err);
      sendToPlayer(socket, { type: "system", payload: { message: `${npc.name} says nothing.` } });
    });
}

/**
 * When a fight breaks out, every online party member of anyone standing in the
 * room is pulled to the room first — a party fights together, wherever its
 * members happened to be standing. Each summoned member is moved with full
 * presence bookkeeping (their old room hears them leave, the fight room hears
 * them arrive, both rooms' "Here:" panels refresh).
 */
function pullPartyMembersIntoRoom(roomId: string): void {
  const alreadyHere = new Set(getActivePlayersInRoom(roomId).map((p) => p.id));

  for (const inRoomId of [...alreadyHere]) {
    for (const memberId of partyManager.getPartyMemberIds(inRoomId)) {
      if (alreadyHere.has(memberId)) continue;
      const member = getPlayerById(memberId);
      if (!member || member.state !== "active" || !member.playerId || !member.roomId) continue;
      // Never yank someone out of a fight they're already in elsewhere.
      if (combatManager.isPlayerInCombat(member.playerId)) continue;

      const fromRoomId = member.roomId;
      broadcastToRoom(fromRoomId, {
        type: "player_presence",
        payload: { playerName: getDisplayName(member), event: "left" },
      }, member.id);

      member.roomId = roomId;
      alreadyHere.add(member.id);

      sendToPlayer(member.socket, {
        type: "system",
        payload: { message: `Steel rings out — your party is under attack! You rush to ${rooms[roomId]?.name ?? "their side"}.` },
      });
      sendRoomUpdate(member, member.socket);
      broadcastToRoom(roomId, {
        type: "player_presence",
        payload: { playerName: getDisplayName(member), event: "entered" },
      }, member.id);
      refreshRoomOccupants(fromRoomId, member.id);
    }
  }
}

/**
 * Call this when players enter a room containing hostile NPCs.
 * Pulls in the room players' party members (a party fights as one), places
 * all players and the hostile NPCs on the grid, then sends a personalised
 * combat_start to every player.
 */
export function triggerCombat(roomId: string): void {
  const hostileNpcs = worldManager.getHostileNpcsInRoom(roomId);
  if (!hostileNpcs.length) return;

  // Never stack a second combat onto a room mid-fight — the same NPCs would
  // be fought (and looted) twice in parallel.
  if (combatManager.hasCombatInRoom(roomId)) return;

  // One member starting a fight commits the whole party to it.
  pullPartyMembersIntoRoom(roomId);

  // Only players with a persistent identity can take part — combat entities,
  // socket delivery (emitToPlayer), and the client's "my entity" check all key
  // off Player.playerId, so it must be the id stamped on each entity.
  const playersInRoom = getActivePlayersInRoom(roomId).filter((p) => p.playerId);
  if (!playersInRoom.length) return;

  // Place players along the bottom rows, enemies along the top rows
  const playerEntities = playersInRoom.map((p, i) =>
    buildPlayerCombatEntity({
      playerId:       p.playerId!,
      name:           p.character?.name ?? "Adventurer",
      characterClass: (p.character?.characterClass ?? "Warrior") as CharacterClass,
      hp:             30,
      position:       { x: i % 8, y: 7 - Math.floor(i / 8) },
      ...(p.progression && { progression: p.progression }),
      ...(p.inventory && { inventory: p.inventory }),
    })
  );

  const enemyEntities = hostileNpcs.map((npc, i) =>
    buildEnemyFromTemplate({
      id:          npc.id,
      templateKey: npc.enemyTemplate ?? "rat",
      name:        npc.name,
      position:    { x: 3 + (i % 5), y: Math.floor(i / 5) },
    })
  );

  const state = combatManager.createCombat(roomId, playerEntities, enemyEntities);

  // Notify each player individually (personalised myEntityId in the view)
  for (const p of playersInRoom) {
    if (!p.playerId) continue;
    sendToPlayer(p.socket, {
      type: "combat_start",
      payload: combatManager.getViewForPlayer(state.id, p.playerId)!,
    });
  }
}

/**
 * Handles a player submitting their planned action for the current round.
 * Once all players have submitted, the round resolves and results are
 * broadcast in initiative order.
 */
function handleCombatSubmitAction(
  player: Player,
  socket: WebSocket,
  combatId: string,
  submission: Parameters<typeof combatManager.submitAction>[1]
): void {
  const state = combatManager.getState(combatId);
  if (!state) {
    sendToPlayer(socket, { type: "system", payload: { message: "No active combat found." } });
    return;
  }

  const { allSubmitted, pendingPlayerIds } = combatManager.submitAction(combatId, submission);

  // Broadcast updated pending list so all clients can show "waiting on…"
  const playersInCombat = state.entities
    .filter(e => e.type === "player" && e.playerId)
    .map(e => e.playerId!);

  for (const pid of playersInCombat) {
    const view = combatManager.getViewForPlayer(combatId, pid);
    if (!view) continue;
    emitToPlayer(pid, {
      type: "combat_planning",
      payload: { combatId, round: state.round, state: view, pendingPlayerIds },
    });
  }

  if (!allSubmitted) return;
  resolveCombatRound(combatId);
}

/**
 * Resolves the current combat round and broadcasts the results (and, when the
 * fight ends, the spoils). Split out of handleCombatSubmitAction so the
 * disconnect path can also resolve a round — when the leaver was the last
 * player everyone else was waiting on, the fight must not hang forever.
 */
function resolveCombatRound(combatId: string): void {
  const state = combatManager.getState(combatId);
  if (!state) return;

  const playersInCombat = state.entities
    .filter(e => e.type === "player" && e.playerId)
    .map(e => e.playerId!);

  // ── Resolve ───────────────────────────────────────────────────────────────
  const { events, isOver, outcome } = combatManager.resolveRound(combatId);

  // Broadcast the resolution to everyone in the room
  const broadcastView = combatManager.getBroadcastView(combatId);
  if (broadcastView) {
    const currentState = combatManager.getState(combatId);
    for (const pid of playersInCombat) {
      const finalView = combatManager.getViewForPlayer(combatId, pid) ?? broadcastView;
      emitToPlayer(pid, {
        type: "combat_resolution",
        payload: { combatId, round: currentState?.round ?? 1, events, finalState: finalView },
      });
    }
  }

  if (isOver) {
    // XP is the sum of each defeated creature's authored value (enemy entity
    // ids are `enemy-<npcId>`; the npc id is not its template key, so we read
    // the template the npc was spawned from). Falls back to the rat's value.
    const enemyEntities = state.entities.filter(e => e.type === "enemy");
    const templatesDefeated = enemyEntities.map(e =>
      getEnemyTemplate(worldManager.getNpcById(e.id.replace(/^enemy-/, ""))?.enemyTemplate)
    );
    const xpReward = templatesDefeated.reduce((sum, t) => sum + t.xp, 0);
    // Gold scales with the danger faced (a share of the XP) plus a little luck.
    const goldReward = Math.floor(xpReward * 0.25) + 5 + Math.floor(Math.random() * 10);
    // Roll each defeated creature's loot table independently.
    const droppedItems: string[] = [];
    for (const t of templatesDefeated) {
      for (const drop of t.loot ?? []) {
        if (Math.random() < drop.chance) droppedItems.push(drop.itemId);
      }
    }

    // Award XP only on a win, and only to players who are still standing.
    const survivors = new Set(
      state.entities
        .filter(e => e.type === "player" && !e.isDead && e.playerId)
        .map(e => e.playerId!)
    );

    // On a win, the defeated hostiles leave the room — and respawn later, so
    // the encounter (and any quest built on it) stays available to everyone
    // on a long-running server.
    if (outcome === "players_win") {
      worldManager.clearHostiles(state.roomId);
      scheduleHostileRespawn(state.roomId);
    }

    for (const pid of playersInCombat) {
      emitToPlayer(pid, {
        type: "combat_end",
        payload: { combatId, outcome: outcome!, xpReward, goldReward },
      });

      if (outcome === "players_win" && survivors.has(pid)) {
        awardCombatXp(pid, xpReward);
        grantCombatLoot(pid, goldReward, droppedItems);
        const winner = getPlayerByPlayerId(pid);
        if (winner) maybeCompleteRoomQuest(winner, state.roomId);
      }
    }

    // Refresh the room for everyone present so cleared hostiles disappear
    // from the "Here" list once the combat overlay closes.
    if (outcome === "players_win") {
      for (const p of getActivePlayersInRoom(state.roomId)) {
        sendRoomUpdate(p, p.socket);
      }
    }

    combatManager.endCombat(combatId);
    return;
  }

  // Next planning round — send personalised states
  const nextState = combatManager.getState(combatId);
  if (!nextState) return;
  const nextPending = nextState.entities
    .filter(e => e.type === "player" && !e.isDead && e.playerId)
    .map(e => e.playerId!);

  for (const pid of playersInCombat) {
    const view = combatManager.getViewForPlayer(combatId, pid);
    if (!view) continue;
    emitToPlayer(pid, {
      type: "combat_planning",
      payload: { combatId, round: nextState.round, state: view, pendingPlayerIds: nextPending },
    });
  }
}

/** How long a cleared room stays quiet before its hostiles return. */
const HOSTILE_RESPAWN_MS = 3 * 60 * 1000;

/** Rooms with a respawn already ticking (dedup so wins don't stack timers). */
const pendingRespawns = new Set<string>();

/**
 * Brings a cleared room's hostiles back after HOSTILE_RESPAWN_MS, warning
 * anyone standing there and refreshing their "Here:" panel. Keeps combat
 * encounters — and the quests built on them — repeatable on a shared server.
 */
function scheduleHostileRespawn(roomId: string): void {
  if (pendingRespawns.has(roomId)) return;
  pendingRespawns.add(roomId);
  setTimeout(() => {
    pendingRespawns.delete(roomId);
    const returned = worldManager.respawnHostiles(roomId);
    if (returned.length === 0) return;
    broadcastToRoom(roomId, {
      type: "system",
      payload: { message: "Something stirs in the dark — danger has crept back into this place." },
    });
    refreshRoomOccupants(roomId);
    console.log(`[world] Respawned ${returned.length} hostile(s) in ${roomId}.`);
  }, HOSTILE_RESPAWN_MS);
}

/**
 * Awards combat XP to one player's persisted progression and notifies them.
 *
 * `playerId` is the combat entity's playerId — the player's persistent identity
 * (see triggerCombat) — so we resolve via getPlayerByPlayerId. Folds the XP in
 * with awardXp (which reconciles level + unspent points), reports any level-up,
 * and persists the updated progression to the active slot.
 */
/**
 * Grants combat spoils — gold and any rolled item drops — to a victorious
 * player's inventory, tells them what they found, and persists. Resolved via the
 * persistent playerId, like awardCombatXp.
 */
function grantCombatLoot(playerId: string, gold: number, itemIds: string[]): void {
  const player = getPlayerByPlayerId(playerId);
  if (!player) return;
  if (!player.inventory) player.inventory = newInventory();

  player.inventory = { ...player.inventory, gold: player.inventory.gold + gold };
  for (const id of itemIds) player.inventory = addItem(player.inventory, id);

  const spoils: string[] = [];
  if (gold > 0) spoils.push(`${gold} gold`);
  for (const id of itemIds) spoils.push(itemById(id)?.name ?? id);
  if (spoils.length) {
    sendToPlayer(player.socket, { type: "system", payload: { message: `Spoils: ${spoils.join(", ")}.` } });
  }
  saveProgress(player);
}

function awardCombatXp(playerId: string, xp: number): void {
  const player = getPlayerByPlayerId(playerId);
  if (!player || !player.progression) return;

  const before = player.progression.level;
  player.progression = awardXp(player.progression, xp);
  const after = player.progression.level;

  sendToPlayer(player.socket, {
    type: "system",
    payload: { message: `You gained ${xp} XP.` },
  });

  if (after > before) {
    sendToPlayer(player.socket, {
      type: "system",
      payload: {
        message:
          `You reached level ${after}! ` +
          `You have ${player.progression.unspentSkillPoints} skill point(s)` +
          (player.progression.unspentAttributePoints > 0
            ? ` and ${player.progression.unspentAttributePoints} attribute point(s)`
            : "") +
          ` to spend. (Open your character screen.)`,
      },
    });
    // Sanity: levelForXp agrees with the reconciled level.
    console.log(
      `[xp] ${player.character?.name} → L${after} (xp ${player.progression.xp}, ` +
      `levelForXp=${levelForXp(player.progression.xp)})`
    );
  }

  // Persist immediately so progress survives a crash before disconnect.
  saveProgress(player);
}

/**
 * Completes the player's active quest if its objective was clearing hostiles in
 * `roomId` (see Quest.objectiveRoomId). Grants the reward XP through awardXp
 * (folding into level/points), reports gold as flavor (no gold ledger yet),
 * persists, and refreshes the quest board. No-op when the active quest — if any
 * — has a different (or no) room objective.
 */
function maybeCompleteRoomQuest(player: Player, roomId: string): void {
  const ownerKey = questOwnerKey(player);
  const active = questManager.getActive(ownerKey);
  // Only "clear" (combat) quests complete by clearing a room. Field quests
  // complete via maybeAdvanceFieldQuest / maybeTurnInQuest instead.
  if (!active || active.quest.objectiveRoomId !== roomId) return;
  if ((active.quest.objectiveKind ?? "clear") !== "clear") return;

  grantQuestCompletion(player, ownerKey);
}

/**
 * Finalizes the owner's active quest: removes it from tracking, awards its
 * reward XP, reports the reward, and refreshes the board. Shared by every
 * completion path (combat clear, field turn-in, delivery).
 *
 * Co-op: when the quest was held by a party (ownerKey is a party id), every
 * online party member receives the full reward XP — not just the player who
 * struck the final blow or made the turn-in. Solo quests reward only the
 * acting player.
 */
function grantQuestCompletion(player: Player, ownerKey: string): void {
  const active = questManager.complete(ownerKey);
  if (!active) return;
  const reward = active.quest.reward;

  // Resolve the reward recipients: the whole party for a party quest, else
  // just the acting player. Party members are tracked by session id.
  const recipients = partyManager.getPartyId(player.id)
    ? partyManager
        .getPartyMemberIds(player.id)
        .map((id) => getPlayerById(id))
        .filter((p): p is Player => p !== undefined)
    : [player];

  const rewardLine =
    `Quest complete — ${active.quest.title}! ` +
    `Reward: ${reward.gold} gold, ${reward.xp} XP` +
    (reward.item ? `, ${reward.item}` : "") + ".";

  // Resolve the authored reward item (a display name) to a catalog entry, if any.
  const rewardItem = reward.item ? itemByName(reward.item) : undefined;

  // The giver's spoken resolution — the story beat that lands before the reward.
  // Spoken as NPC dialogue (with portrait) when the giver stands in the room;
  // otherwise delivered as aftermath narration so we never show a portrait for
  // someone who isn't present (deliveries, remote clears).
  const giverNpc = worldManager.getQuestGiverNpcId(active.quest.id)
    ? worldManager.getNpcById(worldManager.getQuestGiverNpcId(active.quest.id)!)
    : undefined;

  for (const member of recipients) {
    if (member.progression) {
      const before = member.progression.level;
      member.progression = awardXp(member.progression, reward.xp);
      if (member.progression.level > before) {
        sendToPlayer(member.socket, {
          type: "system",
          payload: { message: `You reached level ${member.progression.level}! Open your character screen to spend your points.` },
        });
      }
    }
    // Purse the quest gold and the reward item.
    if (!member.inventory) member.inventory = newInventory();
    member.inventory = { ...member.inventory, gold: member.inventory.gold + reward.gold };
    if (rewardItem) member.inventory = addItem(member.inventory, rewardItem.id);
    saveProgress(member);

    // Spoken resolution — the payoff beat, delivered just before the reward.
    if (active.quest.resolution) {
      const coLocated = !!giverNpc && giverNpc.roomId === member.roomId;
      if (coLocated) {
        sendToPlayer(member.socket, {
          type: "speaker_portrait",
          payload: { name: giverNpc!.name, role: giverNpc!.role, side: "left" },
        });
        sendToPlayer(member.socket, {
          type: "chat",
          payload: { speaker: giverNpc!.name, message: active.quest.resolution },
        });
      } else {
        // Giver isn't present — deliver as aftermath narration (no portrait).
        sendToPlayer(member.socket, {
          type: "system",
          payload: { message: active.quest.resolution },
        });
      }
    }

    sendToPlayer(member.socket, { type: "system", payload: { message: rewardLine } });

    // A finished job can itself be the knowledge that opens the next chapter
    // (the bell's grey knot points at the fog's heart). Announced by grantLore.
    if (active.quest.grantsLore?.length) {
      grantLore(member, active.quest.grantsLore);
    }

    sendQuestBoard(member, member.socket);

    // Finishing the work becomes good talk: seed a "deed" rumor at the NPC who
    // posted it, so word of a reliable hand spreads warmth across the town.
    const giverNpcId = worldManager.getQuestGiverNpcId(active.quest.id);
    if (giverNpcId && member.playerId && member.character) {
      rumorMill.record({
        subjectPlayerId: member.playerId,
        subjectName: member.character.name,
        originNpcId: giverNpcId,
        kind: "deed",
        detail: `saw "${active.quest.title}" through`,
      });
    }

    // The ending. Defeating the Fogmother is the campaign's climax — play the
    // epilogue cinematic for everyone who shared in the victory.
    if (active.quest.id === "authored-fog-boss") {
      sendToPlayer(member.socket, {
        type: "epilogue",
        payload: { scenes: EPILOGUE_SCENES },
      });
    }
  }
}

/**
 * Field-objective kinds the player discovers by *looking* in the room, rather
 * than just by walking in. These reveal their `lookClue` and complete on `look`
 * (see handleLookCommand). "deliver" is the exception — it finishes on arrival.
 */
const DISCOVERABLE_KINDS = new Set(["gather", "scout", "investigate"]);

/** Fallback discovery line when a discoverable quest has no authored lookClue. */
const FIELD_OBJECTIVE_FLAVOR: Record<string, string> = {
  gather:      "You gather what you came for, pale and cold in the grey light.",
  scout:       "You scout the fog line, marking every shape that moves within the Greyfall.",
  investigate: "You search the place over and find what's been wrong all along.",
  deliver:     "You press the package into grateful, trembling hands. It's done.",
};

/**
 * Reacts to entering a non-combat quest's objective room. Delivery finishes on
 * arrival; the discoverable kinds (gather/scout/investigate) are NOT completed
 * here — they're found by inspecting the room (handleLookCommand). On entry we
 * just nudge the player to take a closer look. No-op for combat quests and for
 * rooms that aren't the active objective.
 */
function maybeAdvanceFieldQuest(player: Player): void {
  if (!player.roomId) return;
  const ownerKey = questOwnerKey(player);
  const active = questManager.getActive(ownerKey);
  if (!active) return;

  const kind = active.quest.objectiveKind ?? "clear";
  if (kind === "clear") return;                                   // combat path
  if (active.quest.objectiveRoomId !== player.roomId) return;     // wrong room

  // Delivery: arriving IS the completion.
  if (kind === "deliver") {
    if (!questManager.markObjectiveMet(ownerKey)) return;
    sendToPlayer(player.socket, {
      type: "system",
      payload: { message: FIELD_OBJECTIVE_FLAVOR.deliver! },
    });
    grantQuestCompletion(player, ownerKey);
    return;
  }

  // Discoverable: don't complete on entry — point the player at `look`.
  if (DISCOVERABLE_KINDS.has(kind) && !active.objectiveMet) {
    sendToPlayer(player.socket, {
      type: "system",
      payload: { message: "Something here is worth a closer look. (Try: look)" },
    });
  }
}

/**
 * Completes a field quest when the player speaks to its turn-in NPC after the
 * objective has been met. Returns true if a turn-in happened (so the caller can
 * still show the NPC's normal dialogue alongside the reward). No-op otherwise.
 */
function maybeTurnInQuest(player: Player, npc: { id: string }): boolean {
  const ownerKey = questOwnerKey(player);
  const active = questManager.getActive(ownerKey);
  if (!active || active.quest.turnInNpcId !== npc.id || !active.objectiveMet) return false;

  grantQuestCompletion(player, ownerKey);
  return true;
}

/**
 * Persists a player's current character + progression to their active slot,
 * if they have one. Fire-and-forget; logs on failure. Shared by the XP award
 * and the skills-screen mutations so saves stay consistent.
 */
function saveProgress(player: Player): void {
  if (!player.playerId || !player.activeSlot || !player.character || !player.roomId) return;
  const data = buildSaveData(player.character, player.roomId, player.progression, player.social, player.inventory, player.lore);
  const { playerId, activeSlot } = player;
  saveStore
    .save(playerId, activeSlot, data)
    .catch((err) => console.error(`[save] Progression save failed for ${playerId}:`, err));
}

// ─────────────────────────────────────────────
// CHARACTER / SKILLS SCREEN
// ─────────────────────────────────────────────

/** Emits the current character/skills snapshot to one player. */
function sendSkillScreen(player: Player, socket: WebSocket): void {
  if (!player.character || !player.progression) return;
  sendToPlayer(socket, {
    type: "skill_screen",
    payload: buildSkillScreenView(player.character, player.progression),
  });
}

/**
 * Intercepts the character-screen commands (open, spend a talent, re-slot an
 * ability). Returns true if the input was one of them and was handled, so the
 * caller skips the normal command pipeline.
 *
 * Commands:
 *   skills | character           — open the screen (emit the view)
 *   spend [talent] <nodeId>      — rank up a talent node
 *   equip <abilityId> <slot>     — slot a known ability (slot is 1-based)
 *   unequip <slot>               — clear a slot (1-based)
 *
 * Every mutation is validated by the pure progression helpers (which return the
 * same state by reference on rejection), then the updated view is re-emitted and
 * the save is written.
 */
// ─────────────────────────────────────────────
// INVENTORY
// ─────────────────────────────────────────────

/** Send the player their current inventory snapshot (defaulting an empty pack). */
function sendInventory(player: Player, socket: WebSocket): void {
  if (!player.inventory) player.inventory = newInventory();
  sendToPlayer(socket, { type: "inventory_screen", payload: buildInventoryView(player.inventory) });
}

/** Opens the pack on `inventory`/`inv`/`i`/`bag`/`items`. Returns true if handled. */
function handleInventoryCommand(player: Player, socket: WebSocket, input: string): boolean {
  const cmd = input.trim().split(/\s+/)[0]?.toLowerCase() ?? "";
  if (!["inventory", "inv", "i", "bag", "items"].includes(cmd)) return false;
  if (!player.character) {
    sendToPlayer(socket, { type: "system", payload: { message: "No character loaded." } });
    return true;
  }
  sendInventory(player, socket);
  return true;
}

/**
 * Apply an inventory action (equip / unequip / sell), validated through the pure
 * items.ts helpers, then persist and re-send the fresh view. Using a consumable
 * is deferred to the in-combat item-use path (not yet built), so `use` outside
 * combat just nudges the player to save it for a fight.
 */
function handleInventoryAction(
  player: Player,
  socket: WebSocket,
  payload: { action: "equip" | "unequip" | "use" | "sell"; itemId?: string; slot?: ItemSlot }
): void {
  if (!player.inventory) player.inventory = newInventory();
  const before = player.inventory;
  let message = "";

  switch (payload.action) {
    case "equip":
      if (payload.itemId) {
        player.inventory = equip(before, payload.itemId);
        message = player.inventory === before
          ? "You can't equip that right now."
          : `Equipped ${itemById(payload.itemId)?.name ?? payload.itemId}.`;
      }
      break;
    case "unequip":
      if (payload.slot) {
        player.inventory = unequip(before, payload.slot);
        message = player.inventory === before ? "Nothing to remove there." : `Removed your ${payload.slot}.`;
      }
      break;
    case "sell":
      if (payload.itemId) {
        const sold = sell(before, payload.itemId);
        const def = itemById(payload.itemId);
        if (!sold || !def) message = "You don't have that to sell.";
        else { player.inventory = sold; message = `Sold ${def.name} for ${sellValue(def)} gold.`; }
      }
      break;
    case "use":
      message = "Best saved for the thick of a fight.";
      break;
  }

  if (message) sendToPlayer(socket, { type: "system", payload: { message } });
  if (player.inventory !== before) saveProgress(player);
  sendInventory(player, socket);
}

// ─────────────────────────────────────────────
// SHOP (vendor buy / sell)
// ─────────────────────────────────────────────

/** The vendor (if any) standing in the player's current room. */
function vendorInRoom(player: Player): NPC | undefined {
  if (!player.roomId) return undefined;
  return worldManager.getNpcsInRoom(player.roomId).find(n => n.role === "vendor");
}

/** Opens the room's shop on `shop`/`trade`/`buy`/`sell`/`store`/`wares`. */
function handleShopCommand(player: Player, socket: WebSocket, input: string): boolean {
  const cmd = input.trim().split(/\s+/)[0]?.toLowerCase() ?? "";
  if (!["shop", "trade", "buy", "sell", "store", "wares"].includes(cmd)) return false;

  const vendor = vendorInRoom(player);
  if (!vendor) {
    sendToPlayer(socket, { type: "system", payload: { message: "There's no one here to trade with." } });
    return true;
  }
  if (!player.inventory) player.inventory = newInventory();
  sendToPlayer(socket, { type: "shop_screen", payload: buildShopView(vendor, player.inventory) });
  return true;
}

/**
 * Buy from / sell to a vendor, validated through the pure items.ts helpers. Buy
 * price comes from the vendor's authored stock; sell credits sellValue. Requires
 * the player to still be standing with the vendor. Persists and re-sends the
 * shop so gold and stock stay in sync.
 */
function handleShopAction(
  player: Player,
  socket: WebSocket,
  payload: { action: "buy" | "sell"; vendorId: string; itemId: string }
): void {
  const vendor = worldManager.getNpcById(payload.vendorId);
  if (!vendor || vendor.role !== "vendor" || player.roomId !== vendor.roomId) {
    sendToPlayer(socket, { type: "system", payload: { message: "You've wandered off from the stall." } });
    return;
  }
  if (!player.inventory) player.inventory = newInventory();
  const before = player.inventory;
  let message = "";

  if (payload.action === "buy") {
    const price = vendorPrice(vendor, payload.itemId);
    const def = itemById(payload.itemId);
    if (price === null || !def) message = "They don't sell that.";
    else {
      const bought = buy(before, payload.itemId, price);
      if (!bought) message = `You can't afford ${def.name} (${price} gold).`;
      else { player.inventory = bought; message = `Bought ${def.name} for ${price} gold.`; }
    }
  } else {
    const def = itemById(payload.itemId);
    const sold = sell(before, payload.itemId);
    if (!sold || !def) message = "You don't have that to sell.";
    else { player.inventory = sold; message = `Sold ${def.name} for ${sellValue(def)} gold.`; }
  }

  if (message) sendToPlayer(socket, { type: "system", payload: { message } });
  if (player.inventory !== before) saveProgress(player);
  sendToPlayer(socket, { type: "shop_screen", payload: buildShopView(vendor, player.inventory) });
}

function handleSkillCommand(player: Player, socket: WebSocket, input: string): boolean {
  const parts = input.trim().split(/\s+/);
  const cmd = parts[0]?.toLowerCase();

  if (cmd !== "skills" && cmd !== "character" && cmd !== "spend" &&
      cmd !== "equip" && cmd !== "unequip") {
    return false;
  }

  if (!player.character || !player.progression) {
    sendToPlayer(socket, { type: "system", payload: { message: "No character loaded." } });
    return true;
  }

  const tree = CLASS_TALENT_TREES[player.character.characterClass];

  switch (cmd) {
    case "skills":
    case "character":
      sendSkillScreen(player, socket);
      return true;

    case "spend": {
      // Attribute points: "spend attr <stat>".
      if (parts[1]?.toLowerCase() === "attr") {
        const stat = parts[2]?.toLowerCase() as AbilityScore | undefined;
        if (!stat || !ABILITY_SCORE_NAMES.includes(stat)) {
          sendToPlayer(socket, { type: "system", payload: { message: `Usage: spend attr <${ABILITY_SCORE_NAMES.join("|")}>` } });
          return true;
        }
        const next = spendAttributePoint(player.progression, stat);
        if (next === player.progression) {
          sendToPlayer(socket, { type: "system", payload: { message: "You have no attribute points to spend." } });
          return true;
        }
        player.progression = next;
        saveProgress(player);
        sendSkillScreen(player, socket);
        return true;
      }

      // Talents: "spend <nodeId>" or "spend talent <nodeId>".
      const nodeId = parts[1]?.toLowerCase() === "talent" ? parts[2] : parts[1];
      const node = nodeId ? tree.nodes.find((n) => n.id === nodeId) : undefined;
      if (!node) {
        sendToPlayer(socket, { type: "system", payload: { message: `Unknown talent: "${nodeId ?? ""}".` } });
        return true;
      }
      const next = spendTalentPoint(player.progression, node);
      if (next === player.progression) {
        sendToPlayer(socket, { type: "system", payload: { message: `You can't rank up ${node.name} right now.` } });
        return true;
      }
      player.progression = next;
      saveProgress(player);
      sendSkillScreen(player, socket);
      return true;
    }

    case "equip": {
      const abilityId = parts[1];
      const slot = Number(parts[2]) - 1; // player-facing slots are 1-based
      if (!abilityId || !Number.isInteger(slot) || slot < 0 || slot >= ABILITY_SLOTS) {
        sendToPlayer(socket, { type: "system", payload: { message: `Usage: equip <abilityId> <slot 1–${ABILITY_SLOTS}>` } });
        return true;
      }
      const next = equipAbility(player.progression, tree, abilityId, slot);
      if (next === player.progression) {
        sendToPlayer(socket, { type: "system", payload: { message: `Can't equip "${abilityId}" — not learned, or invalid slot.` } });
        return true;
      }
      player.progression = next;
      saveProgress(player);
      sendSkillScreen(player, socket);
      return true;
    }

    case "unequip": {
      const slot = Number(parts[1]) - 1;
      if (!Number.isInteger(slot) || slot < 0 || slot >= ABILITY_SLOTS) {
        sendToPlayer(socket, { type: "system", payload: { message: `Usage: unequip <slot 1–${ABILITY_SLOTS}>` } });
        return true;
      }
      const next = unequipSlot(player.progression, slot);
      if (next === player.progression) {
        sendToPlayer(socket, { type: "system", payload: { message: "That slot is already empty." } });
        return true;
      }
      player.progression = next;
      saveProgress(player);
      sendSkillScreen(player, socket);
      return true;
    }
  }

  return false;
}

// ─────────────────────────────────────────────
// PARTY HANDLERS
// ─────────────────────────────────────────────

function resolvePartyInfo(playerId: string): { name: string; characterClass: string } | null {
  const p = getPlayerById(playerId);
  if (!p || !p.character) return null;
  return { name: p.character.name, characterClass: p.character.characterClass };
}

function sendPartyUpdate(playerId: string): void {
  const p = getPlayerById(playerId);
  if (!p) return;
  const partyId = partyManager.getPartyId(playerId);
  const party   = partyId ? partyManager.buildView(partyId, resolvePartyInfo) : null;
  sendToPlayer(p.socket, { type: "party_update", payload: { party } });
}

function refreshPartyFor(playerIds: string[]): void {
  for (const id of playerIds) sendPartyUpdate(id);
}

function handlePartyInviteSend(player: Player, socket: WebSocket, targetName: string): void {
  if (!player.character || !player.roomId) return;
  const target = getActivePlayersInRoom(player.roomId).find(
    p => p.id !== player.id &&
         (p.character?.name?.toLowerCase() ?? "") === targetName.trim().toLowerCase()
  );
  if (!target) {
    sendToPlayer(socket, { type: "system", payload: { message: `No one named "${targetName}" is here.` } });
    return;
  }
  const error = partyManager.createInvite(player, target);
  if (error) { sendToPlayer(socket, { type: "system", payload: { message: error } }); return; }

  sendToPlayer(target.socket, {
    type: "party_invite",
    payload: {
      partyId:      partyManager.getPartyId(player.id) ?? `pending-${player.id}`,
      fromName:     player.character.name,
      fromPlayerId: player.id,
    },
  });
  sendToPlayer(socket, { type: "system", payload: { message: `You invited ${target.character?.name} to your party.` } });
}

function handlePartyInviteRespond(
  player: Player,
  socket: WebSocket,
  fromPlayerId: string,
  accept: boolean
): void {
  if (!accept) {
    const inviter = getPlayerById(fromPlayerId);
    if (inviter) {
      sendToPlayer(inviter.socket, {
        type: "system",
        payload: { message: `${player.character?.name ?? "Someone"} declined your invitation.` },
      });
    }
    return;
  }

  const result = partyManager.acceptInvite(player, fromPlayerId, (id) => getPlayerById(id));
  if (result.error) {
    sendToPlayer(socket, { type: "system", payload: { message: result.error } });
    return;
  }

  refreshPartyFor(result.affected);

  const newPartyId = partyManager.getPartyId(player.id);
  if (newPartyId) {
    for (const id of result.affected) {
      if (id === newPartyId) continue;
      questManager.transferOwner(id, newPartyId);
    }
    for (const id of result.affected) {
      const p = getPlayerById(id);
      if (p) sendQuestBoard(p, p.socket);
    }
  }

  for (const id of result.affected) {
    const p = getPlayerById(id);
    if (p) {
      sendToPlayer(p.socket, {
        type: "system",
        payload: { message: `${player.character?.name ?? "A new member"} joined the party.` },
      });
    }
  }
}

function handlePartyLeave(player: Player, socket: WebSocket): void {
  const partyIdBefore = partyManager.getPartyId(player.id);
  const result        = partyManager.leaveParty(player.id);

  if (result.formerMembers.length === 0) {
    sendToPlayer(socket, { type: "system", payload: { message: "You are not in a party." } });
    return;
  }

  sendToPlayer(socket, { type: "party_update", payload: { party: null } });
  sendToPlayer(socket, {
    type: "system",
    payload: { message: result.disbanded ? "The party has disbanded." : "You left the party." },
  });

  if (result.disbanded) {
    if (partyIdBefore) questManager.abandon(partyIdBefore);
    for (const id of result.formerMembers) {
      if (id === player.id) continue;
      const p = getPlayerById(id);
      if (p) {
        sendToPlayer(p.socket, { type: "party_update", payload: { party: null } });
        sendToPlayer(p.socket, { type: "system", payload: { message: "The party has disbanded." } });
        sendQuestBoard(p, p.socket);
      }
    }
    sendQuestBoard(player, socket);
  } else {
    refreshPartyFor(result.stillInParty);
  }
}

/**
 * Sends a fellow party member's character sheet, view-only. Guarded: you can
 * only inspect someone in YOUR party (the sheet reuses the same server-built
 * SkillScreenView the skills screen uses, so nothing here can drift).
 */
function handlePartyMemberSheetRequest(player: Player, socket: WebSocket, memberId: string): void {
  const memberIds = partyManager.getPartyMemberIds(player.id);
  if (!memberIds.includes(memberId)) {
    sendToPlayer(socket, { type: "system", payload: { message: "They're not in your party." } });
    return;
  }
  const member = getPlayerById(memberId);
  if (!member || !member.character || !member.progression) {
    sendToPlayer(socket, { type: "system", payload: { message: "That party member isn't available right now." } });
    return;
  }
  const gearSummary = buildInventoryView(member.inventory ?? newInventory()).bonusSummary;
  sendToPlayer(socket, {
    type: "party_member_sheet",
    payload: {
      sheet: buildSkillScreenView(member.character, member.progression),
      gearSummary,
    },
  });
}

// ─────────────────────────────────────────────
// QUEST HANDLERS
// ─────────────────────────────────────────────

function questOwnerKey(player: Player): string {
  return partyManager.getPartyId(player.id) ?? player.id;
}

/** The lore this character has learned, as a set for the quest-gating checks. */
function knownLoreOf(player: Player): ReadonlySet<string> {
  return new Set(player.lore ?? []);
}

/**
 * Teaches a character campaign lore. New keys are noted to the player,
 * persisted, and — the payoff — any story quest the knowledge just unlocked is
 * announced by name, so a conversation visibly moves the campaign forward.
 * Already-known keys are ignored. Returns true if anything new was learned.
 */
function grantLore(player: Player, keys: string[], note?: string): boolean {
  if (!player.lore) player.lore = [];
  const fresh = keys.filter((k) => !player.lore!.includes(k));
  if (fresh.length === 0) return false;

  const before = new Set(player.lore);
  player.lore.push(...fresh);
  const after = new Set(player.lore);

  if (note) {
    sendToPlayer(player.socket, {
      type: "system",
      payload: { message: `✦ You note it down: ${note}` },
    });
  }

  for (const quest of questManager.unlockedBetween(before, after)) {
    sendToPlayer(player.socket, {
      type: "system",
      payload: { message: `❖ New work has opened on the quest board: "${quest.title}".` },
    });
  }

  saveProgress(player);
  return true;
}

/**
 * First meeting's gift: some townsfolk teach you something just by being
 * heard (NPC.meetLore) — the cheapest way conversation advances the story.
 * Runs on every talk path; grantLore dedups, so it fires once per character.
 */
function maybeGrantMeetLore(player: Player, npc: NPC): void {
  if (!npc.meetLore) return;
  grantLore(player, [npc.meetLore.key], npc.meetLore.note);
}

function sendQuestBoard(player: Player, socket: WebSocket): void {
  const view = questManager.buildView(questOwnerKey(player), knownLoreOf(player));
  sendToPlayer(socket, { type: "quest_board", payload: view });
}

function handleQuestAccept(player: Player, socket: WebSocket, questId: string): void {
  const partyId  = partyManager.getPartyId(player.id);
  const ownerKey = partyId ?? player.id;
  const error    = questManager.accept(ownerKey, questId, partyId !== null, partyId, knownLoreOf(player));

  if (error) {
    sendToPlayer(socket, { type: "system", payload: { message: error } });
    sendQuestBoard(player, socket);
    return;
  }

  const affected = partyId ? partyManager.getPartyMemberIds(player.id) : [player.id];
  for (const id of affected) {
    const p = getPlayerById(id);
    if (!p) continue;
    sendQuestBoard(p, p.socket);
    sendToPlayer(p.socket, {
      type: "system",
      payload: { message: `Quest accepted: ${questManager.getActive(ownerKey)?.quest.title ?? ""}` },
    });
  }
}

function handleQuestAbandon(player: Player, socket: WebSocket): void {
  const partyId  = partyManager.getPartyId(player.id);
  const ownerKey = partyId ?? player.id;
  const error    = questManager.abandon(ownerKey);

  if (error) {
    sendToPlayer(socket, { type: "system", payload: { message: error } });
    return;
  }

  const affected = partyId ? partyManager.getPartyMemberIds(player.id) : [player.id];
  for (const id of affected) {
    const p = getPlayerById(id);
    if (!p) continue;
    sendQuestBoard(p, p.socket);
    sendToPlayer(p.socket, { type: "system", payload: { message: "Quest abandoned." } });
  }
}

// ─────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────

function sendRoomUpdate(player: Player, socket: WebSocket): void {
  if (!player.roomId) return;
  const room = rooms[player.roomId];
  if (!room) return;

  const occupants = getActivePlayersInRoom(room.id)
    .filter(p => p.id !== player.id)
    .map(p => getDisplayName(p));

  const npcs = worldManager.getNpcViewsInRoom(room.id);

  sendToPlayer(socket, {
    type: "room",
    payload: {
      name:        room.name,
      description: room.description,
      exits:       Object.keys(room.exits),
      players:     occupants,
      npcs,
      ...(room.artKey ? { artKey: room.artKey } : {}),
    },
  });
}
