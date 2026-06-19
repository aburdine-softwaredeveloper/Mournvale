/**
 * app.ts — Mournvale client entry point
 *
 * Owns the single WebSocket connection and orchestrates the three
 * screens. This is the only file that touches the socket — screens
 * communicate via injected callbacks, keeping them decoupled from
 * the network layer.
 *
 * Flow:
 *   connect → intro cinematic (client-only)
 *           → intro_complete sent
 *           → server drives character_creation dialogue
 *           → character_create confirmed
 *           → server transitions to active, sends room
 *           → game screen
 *
 * All messages conform to the ClientMessage / ServerMessage unions
 * in src/types/network.ts.
 */

import { ScreenManager } from "./screens/ScreenManager";
import { IntroScreen } from "./screens/IntroScreen";
import { CharacterCreationScreen } from "./screens/CharacterCreationScreen";
import { GameScreen } from "./screens/GameScreen";
import type {
  ServerMessage,
  ClientMessage,
  CharacterCreationStep,
} from "../types/network";

const SERVER_URL = "ws://localhost:3000";

class MournvaleClient {
  private socket: WebSocket | null = null;

  private readonly screens = new ScreenManager();
  private readonly intro = new IntroScreen();
  private readonly creation = new CharacterCreationScreen();
  private readonly game = new GameScreen();

  /** Buffers character draft locally for the final character_create send */
  private draft: Record<string, string> = {};

  public start(): void {
    // Begin on the intro screen immediately — no socket needed to watch it
    this.screens.show("intro");

    this.connect();

    // Start the cinematic. When done, tell the server we're ready.
    this.intro.start(() => {
      this.send({ type: "intro_complete", payload: {} });
    });

    // Wire the creation screen's choice handler
    this.creation.setChoiceHandler((step, value) => {
      this.handleCreationChoice(step, value);
    });
  }

  // ─────────────────────────────────────────────
  // WEBSOCKET
  // ─────────────────────────────────────────────

  private connect(): void {
    this.socket = new WebSocket(SERVER_URL);

    this.socket.addEventListener("open", () => {
      console.log("[net] connected");
    });

    this.socket.addEventListener("message", (event) => {
      let msg: ServerMessage;
      try {
        msg = JSON.parse(event.data) as ServerMessage;
      } catch {
        console.warn("[net] received malformed message", event.data);
        return;
      }
      this.handleServerMessage(msg);
    });

    this.socket.addEventListener("close", () => {
      console.log("[net] disconnected");
      this.game.log("Disconnected from server.", "error");
    });

    this.socket.addEventListener("error", () => {
      this.game.log("Connection error.", "error");
    });
  }

  private send(msg: ClientMessage): void {
    if (this.socket && this.socket.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify(msg));
    } else {
      console.warn("[net] cannot send — socket not open", msg);
    }
  }

  // ─────────────────────────────────────────────
  // SERVER MESSAGE ROUTING
  // ─────────────────────────────────────────────

  private handleServerMessage(msg: ServerMessage): void {
    switch (msg.type) {
      case "system":
        // System messages are relevant during creation and gameplay
        this.game.log(msg.payload.message, "system");
        break;

      case "state_transition":
        this.handleStateTransition(msg.payload.newState);
        break;

      case "dialogue":
        // Tavern keeper speaking — only meaningful on the creation screen
        this.creation.showDialogue(msg);
        break;

      case "character_confirmed":
        // Cache identity for the game header
        this.draft.name = msg.payload.name;
        this.draft.characterClass = msg.payload.characterClass;
        break;

      case "room":
        this.game.updateRoom(msg);
        break;

      case "chat":
        this.game.log(
          `${msg.payload.speaker}: ${msg.payload.message}`,
          "chat"
        );
        break;

      case "player_presence": {
        const verb = msg.payload.event === "entered" ? "enters" : "leaves";
        this.game.log(`${msg.payload.playerName} ${verb} the room.`, "presence");
        break;
      }
    }
  }

  // ─────────────────────────────────────────────
  // STATE TRANSITIONS
  // ─────────────────────────────────────────────

  private handleStateTransition(
    newState: "pending" | "character_creation" | "active"
  ): void {
    switch (newState) {
      case "character_creation":
        this.screens.show("creation");
        break;

      case "active":
        // Initialize the game screen with the player's identity
        this.game.init(
          this.draft.name ?? "Adventurer",
          this.draft.characterClass ?? "",
          (input) => this.send({ type: "command", payload: { input } })
        );
        this.screens.show("game");
        break;

      case "pending":
        this.screens.show("intro");
        break;
    }
  }

  // ─────────────────────────────────────────────
  // CHARACTER CREATION
  // ─────────────────────────────────────────────

  /**
   * Reports a creation choice to the server. The server is authoritative
   * and decides the next dialogue step. We also locally cache the draft
   * for display purposes.
   */
  private handleCreationChoice(
    step: CharacterCreationStep,
    value: string
  ): void {
    this.draft[step] = value;
    this.send({
      type: "dialogue_choice",
      payload: { step, value },
    });
  }
}

// ─────────────────────────────────────────────
// BOOTSTRAP
// ─────────────────────────────────────────────

window.addEventListener("DOMContentLoaded", () => {
  const client = new MournvaleClient();
  client.start();
});
