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
import { randomUUID } from "crypto";
import { handleCommand } from "./commands";
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
import { worldManager } from "./world/WorldManager";
import { combatManager, buildPlayerCombatEntity, buildEnemyCombatEntity } from "./combat/CombatManager";
import type {
  ClientMessage,
  ServerMessage,
  CharacterCreationStep,
} from "../types/network";
import type { TalkIntent } from "../types/npc";
import type { Player } from "../types/game";
import type { CharacterClass, Skill } from "../types/character";
import { buildCharacterStats } from "../types/character";
import { rollSkillCheck } from "./skills/SkillEngine";
import { NpcChatService } from "./dialogue/NpcChatService";
import { OllamaBrain } from "./dialogue/OllamaBrain";
import { ScriptedBrain } from "./dialogue/ScriptedBrain";
import { inferIntent, skillForIntent, TIER_LABEL } from "./dialogue/NpcBrain";
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

const PORT = 3000;
const server = new WebSocketServer({ port: PORT });

const saveStore: SaveStore = new JsonFileSaveStore();
const partyManager = new PartyManager();
const questManager = new QuestManager();

/**
 * Free-text NPC dialogue. Prefers a local Ollama LLM (free, no key — see
 * OllamaBrain) and falls back to the authored scripted dialogue when Ollama
 * isn't running. ScriptedBrain must stay last (it's the guaranteed floor).
 */
const npcChat = new NpcChatService([new OllamaBrain(), new ScriptedBrain()]);

/** DC for a free-text conversational skill check (moderate). */
const NPC_CHAT_DC = 12;

/**
 * Maps playerId → WebSocket so we can send targeted messages during
 * combat (each player gets a personalised CombatStateView).
 */
const playerSockets = new Map<string, WebSocket>();

console.log(`🏰 Mournvale running on ws://localhost:${PORT}`);

// ─────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────

/** Send a message to a specific player by their persistent playerId. */
function emitToPlayer(playerId: string, msg: ServerMessage): void {
  const socket = playerSockets.get(playerId);
  if (socket) sendToPlayer(socket, msg);
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
      const data = buildSaveData(currentPlayer.character, currentPlayer.roomId, currentPlayer.progression);
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

    const partyIdBefore = partyManager.getPartyId(currentPlayer.id);
    const partyResult   = partyManager.handleDisconnect(currentPlayer.id);

    // Remove from socket map before deleting player
    if (currentPlayer.playerId) playerSockets.delete(currentPlayer.playerId);
    npcChat.clearHistory(currentPlayer.id);
    players.delete(socket);

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
      sendToPlayer(socket, {
        type: "dialogue",
        payload: {
          speaker: "Aldric the Barkeep",
          text: `Welcome to Mournvale, ${character.name}. Watch yourself out there. The fog's been thicker than usual.`,
        },
      });

      if (player.playerId && player.activeSlot) {
        const data = buildSaveData(character, player.roomId, player.progression);
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
      // `fight` starts combat in the player's room — also needs the Player.
      if (handleFightCommand(player, socket, msg.payload.input)) return;
      // `ask`/`chat` is free-text NPC conversation — async (LLM call), so it
      // kicks off and returns; the reply arrives via sendToPlayer when ready.
      if (handleNpcChatCommand(player, socket, msg.payload.input)) return;

      const response = handleCommand(player.id, msg.payload.input);
      if (response) sendToPlayer(socket, { type: "system", payload: { message: response } });
      if (["north", "south", "east", "west", "up", "down"].includes(
        msg.payload.input.trim().split(" ")[0]?.toLowerCase() ?? ""
      )) {
        sendRoomUpdate(player, socket);
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

    case "quest_board_request":
      sendQuestBoard(player, socket);
      return;

    case "quest_accept":
      handleQuestAccept(player, socket, msg.payload.questId);
      return;

    case "quest_abandon":
      handleQuestAbandon(player, socket);
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

  triggerCombat(player.roomId);
  return true;
}

/**
 * Handles `ask <npc> <message>` (alias `chat`): free-text conversation with an
 * NPC. The d20 conversational check is rolled here (server-authoritative); the
 * NpcChatService only renders the NPC's words, conditioned on the resulting
 * tier. Returns true if the input was an ask/chat command (handled).
 *
 * Async work runs detached: we acknowledge immediately ("considers your
 * words…"), then deliver the reply via sendToPlayer when the brain responds.
 */
function handleNpcChatCommand(player: Player, socket: WebSocket, input: string): boolean {
  const parts = input.trim().split(/\s+/);
  const verb = parts[0]?.toLowerCase();
  if (verb !== "ask" && verb !== "chat") return false;

  if (!player.roomId || !player.character) {
    sendToPlayer(socket, { type: "system", payload: { message: "You can't speak to anyone right now." } });
    return true;
  }

  const targetName = parts[1];
  const message = parts.slice(2).join(" ").trim();
  if (!targetName || !message) {
    sendToPlayer(socket, { type: "system", payload: { message: "Say what, to whom? Try: ask <name> <message>" } });
    return true;
  }

  const npc = worldManager.findNpcInRoomByName(player.roomId, targetName);
  if (!npc) {
    sendToPlayer(socket, { type: "system", payload: { message: `There's no one named "${targetName}" here.` } });
    return true;
  }
  if (npc.role === "hostile") {
    sendToPlayer(socket, { type: "system", payload: { message: `${npc.name} is in no mood to talk — you'll need to fight.` } });
    return true;
  }

  // ── Roll the conversational check (authoritative) ──
  const charClass = player.character.characterClass;
  const intent = inferIntent(message);
  const skill = skillForIntent(intent) as Skill;
  const roll = rollSkillCheck(buildCharacterStats(charClass), skill, NPC_CHAT_DC);

  const skillName = skill.charAt(0).toUpperCase() + skill.slice(1);
  const modSign = roll.roll.modifier >= 0 ? "+" : "";

  // Acknowledge immediately so the player isn't staring at a blank pause.
  sendToPlayer(socket, { type: "system", payload: { message: `${npc.name} considers your words…` } });

  const roomName = rooms[player.roomId]?.name ?? "Mournvale";
  const playerName = player.character.name;

  void npcChat
    .respond(player.id, {
      npc,
      playerName,
      playerClass: charClass,
      message,
      skill,
      intent,
      tier: roll.tier,
      roomName,
    })
    .then(({ reply }) => {
      // The dice reveal (so the d20 is visible), then the NPC's spoken line.
      sendToPlayer(socket, {
        type: "system",
        payload: {
          message: `${skillName} — ${roll.roll.result} ${modSign}${roll.roll.modifier} = ${roll.roll.total} vs DC ${NPC_CHAT_DC} — ${TIER_LABEL[roll.tier]}`,
        },
      });
      sendToPlayer(socket, { type: "chat", payload: { speaker: npc.name, message: reply } });
    })
    .catch((err) => {
      console.error("[npc-chat] reply failed:", err);
      sendToPlayer(socket, { type: "system", payload: { message: `${npc.name} says nothing.` } });
    });

  return true;
}

/**
 * Call this when players enter a room containing hostile NPCs.
 * Places all players in the room and the hostile NPCs on the grid,
 * then sends a personalised combat_start to every player.
 */
export function triggerCombat(roomId: string): void {
  // Only players with a persistent identity can take part — combat entities,
  // socket delivery (emitToPlayer), and the client's "my entity" check all key
  // off Player.playerId, so it must be the id stamped on each entity.
  const playersInRoom = getActivePlayersInRoom(roomId).filter((p) => p.playerId);
  const hostileNpcs   = worldManager.getHostileNpcsInRoom(roomId);
  if (!playersInRoom.length || !hostileNpcs.length) return;

  // Place players along the bottom rows, enemies along the top rows
  const playerEntities = playersInRoom.map((p, i) =>
    buildPlayerCombatEntity({
      playerId:       p.playerId!,
      name:           p.character?.name ?? "Adventurer",
      characterClass: (p.character?.characterClass ?? "Warrior") as CharacterClass,
      hp:             30,
      position:       { x: i % 8, y: 7 - Math.floor(i / 8) },
      ...(p.progression && { progression: p.progression }),
    })
  );

  const enemyEntities = hostileNpcs.map((npc, i) =>
    buildEnemyCombatEntity({
      id:       npc.id,
      name:     npc.name,
      position: { x: 3 + (i % 5), y: Math.floor(i / 5) },
      hp:       20,
      ac:       13,
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

  // ── All players submitted → resolve ───────────────────────────────────────
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
    const enemyCount = state.entities.filter(e => e.type === "enemy").length;
    const xpReward   = enemyCount * 50;
    const goldReward = Math.floor(Math.random() * 15) + 5;

    // Award XP only on a win, and only to players who are still standing.
    const survivors = new Set(
      state.entities
        .filter(e => e.type === "player" && !e.isDead && e.playerId)
        .map(e => e.playerId!)
    );

    // On a win, the defeated hostiles leave the room for good (this session).
    if (outcome === "players_win") {
      worldManager.clearHostiles(state.roomId);
    }

    for (const pid of playersInCombat) {
      emitToPlayer(pid, {
        type: "combat_end",
        payload: { combatId, outcome: outcome!, xpReward, goldReward },
      });

      if (outcome === "players_win" && survivors.has(pid)) {
        awardCombatXp(pid, xpReward);
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

/**
 * Awards combat XP to one player's persisted progression and notifies them.
 *
 * `playerId` is the combat entity's playerId — the player's persistent identity
 * (see triggerCombat) — so we resolve via getPlayerByPlayerId. Folds the XP in
 * with awardXp (which reconciles level + unspent points), reports any level-up,
 * and persists the updated progression to the active slot.
 */
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
  if (!active || active.quest.objectiveRoomId !== roomId) return;

  questManager.complete(ownerKey);
  const reward = active.quest.reward;

  if (player.progression) {
    player.progression = awardXp(player.progression, reward.xp);
    saveProgress(player);
  }

  sendToPlayer(player.socket, {
    type: "system",
    payload: {
      message:
        `Quest complete — ${active.quest.title}! ` +
        `Reward: ${reward.gold} gold, ${reward.xp} XP` +
        (reward.item ? `, ${reward.item}` : "") + ".",
    },
  });
  sendQuestBoard(player, player.socket);
}

/**
 * Persists a player's current character + progression to their active slot,
 * if they have one. Fire-and-forget; logs on failure. Shared by the XP award
 * and the skills-screen mutations so saves stay consistent.
 */
function saveProgress(player: Player): void {
  if (!player.playerId || !player.activeSlot || !player.character || !player.roomId) return;
  const data = buildSaveData(player.character, player.roomId, player.progression);
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

// ─────────────────────────────────────────────
// QUEST HANDLERS
// ─────────────────────────────────────────────

function questOwnerKey(player: Player): string {
  return partyManager.getPartyId(player.id) ?? player.id;
}

function sendQuestBoard(player: Player, socket: WebSocket): void {
  const view = questManager.buildView(questOwnerKey(player));
  sendToPlayer(socket, { type: "quest_board", payload: view });
}

function handleQuestAccept(player: Player, socket: WebSocket, questId: string): void {
  const partyId  = partyManager.getPartyId(player.id);
  const ownerKey = partyId ?? player.id;
  const error    = questManager.accept(ownerKey, questId, partyId !== null, partyId);

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
