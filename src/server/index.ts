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

console.log(`🏰 Mournvale running on ws://localhost:${PORT}`);

// ─────────────────────────────────────────────
// CONNECTION HANDLER
// ─────────────────────────────────────────────

server.on("connection", (socket: WebSocket) => {
  const player: Player = {
    id: randomUUID(),
    socket,
    state: "pending",
    tempName: `Traveler-${Math.floor(Math.random() * 9999)}`,
    draft: {},
    // character and roomId are intentionally omitted — they are optional
    // and exactOptionalPropertyTypes forbids assigning explicit `undefined`.
    // They are populated when the player reaches the "active" state.
  };

  players.set(socket, player);

  console.log(`[+] ${player.tempName} connected (${player.id})`);

  // Welcome — client will play the intro cinematic, then send intro_complete
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

    switch (currentPlayer.state) {
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
