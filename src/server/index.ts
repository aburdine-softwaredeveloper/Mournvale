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
 */

import { WebSocketServer, WebSocket, RawData } from "ws";
import { randomUUID } from "crypto";
import { handleCommand } from "./commands";
import { broadcastToRoom, sendToPlayer } from "./roomUtils";
import { players, rooms, getDisplayName, getActivePlayersInRoom } from "./gameState";
import {
  getDialogueForStep,
  getNextStep,
  getFirstStep,
  applyAnswer,
  finalizeDraft,
} from "./character/CharacterManager";
import { JsonFileSaveStore, buildSaveData } from "./persistence/SaveStore";
import type { SaveStore } from "./persistence/SaveStore";
import type {
  ClientMessage,
  ServerMessage,
  CharacterCreationStep,
} from "../types/network";
import type { Player } from "../types/game";

// ─────────────────────────────────────────────
// SERVER SETUP
// ─────────────────────────────────────────────

const PORT = 3000;
const server = new WebSocketServer({ port: PORT });

/**
 * The persistence backend. Swap JsonFileSaveStore for a database-backed
 * implementation later without changing any calling code.
 */
const saveStore: SaveStore = new JsonFileSaveStore();

console.log(`🏰 Mournvale running on ws://localhost:${PORT}`);

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
    // playerId, activeSlot, character, and roomId are intentionally
    // omitted — they are optional and exactOptionalPropertyTypes forbids
    // assigning explicit `undefined`. They are populated as the player
    // identifies, picks a slot, and reaches the "active" state.
  };

  players.set(socket, player);

  console.log(`[+] ${player.tempName} connected (${player.id})`);

  // Welcome — client will identify, then show the main menu
  sendToPlayer(socket, {
    type: "system",
    payload: {
      message: "Connected to Mournvale.",
    },
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
      sendToPlayer(socket, {
        type: "system",
        payload: { message: "Invalid message format." },
      });
      return;
    }

    console.log(`[${currentPlayer.tempName}] state:${currentPlayer.state} type:${msg.type}`);

    // `identify` is valid in any state — it establishes the persistent
    // playerId used to scope saves. Handle it before the state switch.
    if (msg.type === "identify") {
      handleIdentify(currentPlayer, socket, msg.payload.playerId);
      return;
    }

    switch (currentPlayer.state) {
      case "menu":
        // Menu handlers touch disk (async); fire and forget. Errors are
        // caught inside each handler and reported to the player.
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

    // Auto-save on disconnect: persist if the player is active and has
    // everything needed to save. This runs async; we remove the player
    // from the live map immediately but let the write complete in the
    // background. Errors are logged, not surfaced (the socket is gone).
    if (
      currentPlayer.state === "active" &&
      currentPlayer.character &&
      currentPlayer.roomId &&
      currentPlayer.playerId &&
      currentPlayer.activeSlot
    ) {
      const data = buildSaveData(currentPlayer.character, currentPlayer.roomId);
      const { playerId, activeSlot } = currentPlayer;
      saveStore
        .save(playerId, activeSlot, data)
        .then(() =>
          console.log(
            `[save] Auto-saved ${data.character.name} to slot ${activeSlot} on disconnect.`
          )
        )
        .catch((err) =>
          console.error(`[save] Auto-save failed for ${playerId}:`, err)
        );
    }

    // Only announce departure if player was active in a room
    if (currentPlayer.state === "active" && currentPlayer.roomId) {
      broadcastToRoom(
        currentPlayer.roomId,
        {
          type: "player_presence",
          payload: {
            playerName: getDisplayName(currentPlayer),
            event: "left",
          },
        },
        currentPlayer.id
      );
    }

    players.delete(socket);
  });
});

// ─────────────────────────────────────────────
// STATE HANDLERS
// ─────────────────────────────────────────────

/**
 * Handles the `identify` message (valid in any state).
 * Establishes the persistent playerId, then — if the player is still
 * at the menu — sends them their save-slot list so the menu can render.
 */
function handleIdentify(
  player: Player,
  socket: WebSocket,
  playerId: string
): void {
  // Only accept identify once, and only a sane-looking id
  if (player.playerId) return;

  const trimmed = (playerId ?? "").trim();
  if (trimmed.length < 8 || trimmed.length > 64) {
    sendToPlayer(socket, {
      type: "system",
      payload: { message: "Invalid player identity." },
    });
    return;
  }

  player.playerId = trimmed;
  console.log(`[id] ${player.tempName} identified as ${trimmed}`);

  // Send the initial slot list for the main menu
  void sendSlotList(player, socket);
}

/**
 * Handles messages while the player is at the main menu.
 * Valid messages: request_slots, new_game, load_game, delete_slot.
 */
async function handleMenuMessage(
  player: Player,
  socket: WebSocket,
  msg: ClientMessage
): Promise<void> {
  if (!player.playerId) {
    sendToPlayer(socket, {
      type: "system",
      payload: { message: "Please wait — still connecting." },
    });
    return;
  }

  switch (msg.type) {
    case "request_slots":
      await sendSlotList(player, socket);
      return;

    case "new_game": {
      const slot = msg.payload.slot;
      if (!isValidSlot(slot)) {
        sendToPlayer(socket, {
          type: "system",
          payload: { message: "Invalid save slot." },
        });
        return;
      }

      // Bind this session to the chosen slot, then begin the intro.
      player.activeSlot = slot;
      player.state = "pending";
      player.draft = {};

      sendToPlayer(socket, {
        type: "state_transition",
        payload: { newState: "pending" },
      });
      return;
    }

    case "load_game": {
      const slot = msg.payload.slot;
      if (!isValidSlot(slot)) {
        sendToPlayer(socket, {
          type: "system",
          payload: { message: "Invalid save slot." },
        });
        return;
      }

      const data = await saveStore.load(player.playerId, slot);
      if (!data) {
        sendToPlayer(socket, {
          type: "system",
          payload: { message: "That slot is empty." },
        });
        await sendSlotList(player, socket);
        return;
      }

      // Restore the character directly into the active state.
      player.activeSlot = slot;
      player.character = data.character;
      // Restore position if the room still exists; else fall back to tavern.
      player.roomId = rooms[data.roomId] ? data.roomId : "tavern";
      player.state = "active";

      sendToPlayer(socket, {
        type: "character_confirmed",
        payload: {
          name: data.character.name,
          characterClass: data.character.characterClass,
          gender: data.character.gender,
        },
      });

      sendToPlayer(socket, {
        type: "state_transition",
        payload: { newState: "active" },
      });

      sendRoomUpdate(player, socket);

      broadcastToRoom(
        player.roomId,
        {
          type: "player_presence",
          payload: { playerName: data.character.name, event: "entered" },
        },
        player.id
      );

      sendToPlayer(socket, {
        type: "system",
        payload: {
          message: `Welcome back, ${data.character.name}.`,
        },
      });

      console.log(
        `[load] ${data.character.name} loaded from slot ${slot} into ${player.roomId}.`
      );
      return;
    }

    case "delete_slot": {
      const slot = msg.payload.slot;
      if (!isValidSlot(slot)) {
        sendToPlayer(socket, {
          type: "system",
          payload: { message: "Invalid save slot." },
        });
        return;
      }
      await saveStore.delete(player.playerId, slot);
      sendToPlayer(socket, {
        type: "save_result",
        payload: { success: true, slot, message: "Save deleted." },
      });
      await sendSlotList(player, socket);
      return;
    }

    default:
      sendToPlayer(socket, {
        type: "system",
        payload: { message: "Choose New Game or Load Game." },
      });
  }
}

/** Loads and sends the player's slot summaries for the menu. */
async function sendSlotList(player: Player, socket: WebSocket): Promise<void> {
  if (!player.playerId) return;
  try {
    const slots = await saveStore.listSlots(player.playerId);
    sendToPlayer(socket, {
      type: "slot_list",
      payload: { slots },
    });
  } catch (err) {
    console.error("[save] Failed to list slots:", err);
    sendToPlayer(socket, {
      type: "system",
      payload: { message: "Could not load your saves." },
    });
  }
}

/** Validates a slot number is an integer in range. */
function isValidSlot(slot: number): boolean {
  return Number.isInteger(slot) && slot >= 1 && slot <= 5;
}

/**
 * Handles messages from players in "pending" state.
 * The only valid message here is intro_complete.
 */
function handlePendingMessage(
  player: Player,
  socket: WebSocket,
  msg: ClientMessage
): void {
  if (msg.type !== "intro_complete") {
    sendToPlayer(socket, {
      type: "system",
      payload: { message: "Please wait for the introduction to complete." },
    });
    return;
  }

  // Transition to character_creation
  player.state = "character_creation";

  sendToPlayer(socket, {
    type: "state_transition",
    payload: { newState: "character_creation" },
  });

  // Begin the tavern keeper dialogue
  const firstStep = getFirstStep();
  sendToPlayer(socket, getDialogueForStep(firstStep, player.draft));
}

/**
 * Handles messages from players in "character_creation" state.
 * Accepts dialogue_choice messages and advances the creation flow.
 */
function handleCreationMessage(
  player: Player,
  socket: WebSocket,
  msg: ClientMessage
): void {
  if (msg.type !== "dialogue_choice") {
    sendToPlayer(socket, {
      type: "system",
      payload: { message: "Please complete character creation first." },
    });
    return;
  }

  const { step, value } = msg.payload;

  // Handle restart at confirm step
  if (step === "confirm" && value === "restart") {
    player.draft = {};
    sendToPlayer(socket, {
      type: "system",
      payload: { message: "Very well — let's start again." },
    });
    sendToPlayer(socket, getDialogueForStep(getFirstStep(), player.draft));
    return;
  }

  // Validate and apply the answer
  const error = applyAnswer(step, value, player.draft);

  if (error) {
    sendToPlayer(socket, {
      type: "system",
      payload: { message: error },
    });
    // Re-send the same step's dialogue so the player can try again
    sendToPlayer(socket, getDialogueForStep(step, player.draft));
    return;
  }

  // If confirmed, finalize and transition to active
  if (step === "confirm" && value === "confirm") {
    try {
      const character = finalizeDraft(player.draft);
      player.character = character;
      player.state = "active";
      player.roomId = "tavern";

      // Confirm to the client
      sendToPlayer(socket, {
        type: "character_confirmed",
        payload: {
          name: character.name,
          characterClass: character.characterClass,
          gender: character.gender,
        },
      });

      sendToPlayer(socket, {
        type: "state_transition",
        payload: { newState: "active" },
      });

      // Send the starting room
      sendRoomUpdate(player, socket);

      // Announce arrival to the room
      broadcastToRoom(
        "tavern",
        {
          type: "player_presence",
          payload: {
            playerName: character.name,
            event: "entered",
          },
        },
        player.id
      );

      // Final barkeep send-off
      sendToPlayer(socket, {
        type: "dialogue",
        payload: {
          speaker: "Aldric the Barkeep",
          text:
            `Welcome to Mournvale, ${character.name}. ` +
            "Watch yourself out there. The fog's been thicker than usual.",
        },
      });

      // Initial save: persist the brand-new character immediately so it
      // survives even if the player closes the tab before moving (our
      // auto-save is on disconnect, but writing now guarantees the slot
      // is populated the moment creation finishes).
      if (player.playerId && player.activeSlot) {
        const data = buildSaveData(character, player.roomId);
        const { playerId, activeSlot } = player;
        saveStore
          .save(playerId, activeSlot, data)
          .then(() =>
            console.log(
              `[save] Initial save of ${character.name} to slot ${activeSlot}.`
            )
          )
          .catch((err) =>
            console.error(`[save] Initial save failed:`, err)
          );
      }

      console.log(
        `[★] ${character.name} (${character.characterClass}) entered the world.`
      );
    } catch (err) {
      sendToPlayer(socket, {
        type: "system",
        payload: { message: "Something went wrong creating your character. Please try again." },
      });
      player.draft = {};
      sendToPlayer(socket, getDialogueForStep(getFirstStep(), player.draft));
    }
    return;
  }

  // Advance to the next step
  const nextStep = getNextStep(step as CharacterCreationStep);
  if (nextStep) {
    sendToPlayer(socket, getDialogueForStep(nextStep, player.draft));
  }
}

/**
 * Handles messages from fully active players.
 * Accepts command messages and routes them to the command handler.
 */
function handleActiveMessage(
  player: Player,
  socket: WebSocket,
  msg: ClientMessage
): void {
  if (msg.type !== "command") {
    sendToPlayer(socket, {
      type: "system",
      payload: { message: "Unknown message type." },
    });
    return;
  }

  const response = handleCommand(player.id, msg.payload.input);

  if (response) {
    sendToPlayer(socket, {
      type: "system",
      payload: { message: response },
    });
  }

  // If the player moved, update the room panel
  if (["north", "south", "east", "west"].includes(
    msg.payload.input.trim().split(" ")[0]?.toLowerCase() ?? ""
  )) {
    sendRoomUpdate(player, socket);
  }
}

// ─────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────

/**
 * Sends a full room update to the client — used on spawn and movement.
 */
function sendRoomUpdate(player: Player, socket: WebSocket): void {
  if (!player.roomId) return;

  const room = rooms[player.roomId];
  if (!room) return;

  const occupants = getActivePlayersInRoom(room.id)
    .filter((p) => p.id !== player.id)
    .map((p) => getDisplayName(p));

  sendToPlayer(socket, {
    type: "room",
    payload: {
      name: room.name,
      description: room.description,
      exits: Object.keys(room.exits),
      players: occupants,
    },
  });
}
