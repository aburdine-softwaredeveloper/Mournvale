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
import { MainMenuScreen } from "./screens/MainMenuScreen";
import { IntroScreen } from "./screens/IntroScreen";
import { CharacterCreationScreen } from "./screens/CharacterCreationScreen";
import { GameScreen } from "./screens/GameScreen";
import { QuestBoard } from "./components/QuestBoard";
import { InvitePrompt } from "./components/InvitePrompt";
import type { PortraitSpec } from "../engine/assets/PortraitCompositor";
import type {
  ServerMessage,
  ClientMessage,
  CharacterCreationStep,
} from "../types/network";

const SERVER_URL = "ws://localhost:3000";

/** localStorage key under which we persist the player's stable identity */
const PLAYER_ID_KEY = "mournvale.playerId";

class MournvaleClient {
  private socket: WebSocket | null = null;

  private readonly screens = new ScreenManager();
  private readonly menu = new MainMenuScreen();
  private readonly intro = new IntroScreen();
  private readonly creation = new CharacterCreationScreen();
  private readonly game = new GameScreen();
  private readonly questBoard = new QuestBoard();
  private readonly invitePrompt = new InvitePrompt();

  /** Buffers character draft locally for the final character_create send */
  private draft: Record<string, string> = {};

  /**
   * The confirmed portrait spec, cached from character_confirmed and used
   * to render the header portrait when the game screen activates.
   */
  private portraitSpec: PortraitSpec | null = null;

  /** This browser's persistent player identity (from localStorage) */
  private playerId: string = "";

  public start(): void {
    // Establish a persistent player identity for this browser
    this.playerId = this.loadOrCreatePlayerId();

    // Begin on the main menu
    this.screens.show("menu");

    this.connect();

    // Wire the menu's New Game / Load Game / Delete handlers
    this.menu.setHandlers({
      onNewGame: (slot) => this.send({ type: "new_game", payload: { slot } }),
      onLoadGame: (slot) => this.send({ type: "load_game", payload: { slot } }),
      onDeleteSlot: (slot) =>
        this.send({ type: "delete_slot", payload: { slot } }),
    });

    // Wire the creation screen's choice handler
    this.creation.setChoiceHandler((step, value) => {
      this.handleCreationChoice(step, value);
    });

    // Wire the party panel's Leave button
    this.game.setPartyLeaveHandler(() => {
      this.send({ type: "party_leave", payload: {} });
    });

    // Wire the quest board's accept / abandon / close
    this.questBoard.setHandlers({
      onAccept: (questId) =>
        this.send({ type: "quest_accept", payload: { questId } }),
      onAbandon: () => this.send({ type: "quest_abandon", payload: {} }),
      onClose: () => {
        /* board just hides; no server message needed */
      },
    });

    // Wire the invite prompt's Accept / Decline
    this.invitePrompt.setRespondHandler((invite, accept) => {
      this.send({
        type: "party_invite_respond",
        payload: {
          partyId: invite.partyId,
          fromPlayerId: invite.fromPlayerId,
          accept,
        },
      });
    });
  }

  /**
   * Reads the persistent playerId from localStorage, generating and
   * storing a fresh one on first visit. This ID scopes the player's
   * save slots on the server.
   */
  private loadOrCreatePlayerId(): string {
    try {
      const existing = window.localStorage.getItem(PLAYER_ID_KEY);
      if (existing && existing.length >= 8) return existing;

      const generated = this.generateId();
      window.localStorage.setItem(PLAYER_ID_KEY, generated);
      return generated;
    } catch {
      // localStorage unavailable (private mode, etc.) — fall back to a
      // session-only id. Saves won't persist across reloads in this case.
      return this.generateId();
    }
  }

  /** Generates a random identifier (crypto.randomUUID when available) */
  private generateId(): string {
    if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
      return crypto.randomUUID();
    }
    // Fallback for older browsers
    return (
      "p-" +
      Math.random().toString(36).slice(2) +
      Date.now().toString(36)
    );
  }

  // ─────────────────────────────────────────────
  // WEBSOCKET
  // ─────────────────────────────────────────────

  private connect(): void {
    this.socket = new WebSocket(SERVER_URL);

    this.socket.addEventListener("open", () => {
      console.log("[net] connected");
      // Identify ourselves so the server can scope our save slots
      this.send({ type: "identify", payload: { playerId: this.playerId } });
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
        // Cache identity + appearance for the game header portrait
        this.draft.name = msg.payload.name;
        this.draft.characterClass = msg.payload.characterClass;
        this.portraitSpec = {
          gender: msg.payload.gender,
          characterClass: msg.payload.characterClass,
          hairColor: msg.payload.hairColor,
          glasses: msg.payload.glasses,
        };
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

      case "slot_list":
        // Feed the menu its save-slot summaries
        this.menu.setSlots(msg.payload.slots);
        break;

      case "save_result":
        // Log the result; the subsequent slot_list refreshes the menu
        this.game.log(msg.payload.message, "system");
        break;

      case "party_update":
        // Refresh the party roster (null hides it)
        this.game.updateParty(msg.payload.party);
        break;

      case "party_invite":
        // Show the accept/decline prompt
        this.invitePrompt.show(msg.payload);
        break;

      case "quest_board":
        // Render the board and open it if it isn't already showing
        this.questBoard.render(msg.payload);
        this.questBoard.show();
        break;

      case "npc_interaction": {
        const npc = msg.payload;
        // Print the NPC's dialogue lines as chat-style log entries
        this.game.log(`— ${npc.name}, ${npc.title} —`, "presence");
        for (const line of npc.dialogue) {
          this.game.log(`${npc.name}: ${line.text}`, "chat");
        }
        // Quest-givers: nudge the player to the board
        if (npc.questIds.length > 0) {
          this.game.log(
            `${npc.name} has work for you. Open Quests to see their offers.`,
            "system"
          );
        }
        // Vendors: list stock (purchase flow comes later)
        if (npc.stock.length > 0) {
          this.game.log(`${npc.name} is selling:`, "system");
          for (const item of npc.stock) {
            this.game.log(`  ${item.name} — ${item.price}g · ${item.description}`, "default");
          }
        }
        break;
      }
    }
  }

  // ─────────────────────────────────────────────
  // STATE TRANSITIONS
  // ─────────────────────────────────────────────

  private handleStateTransition(
    newState: "menu" | "pending" | "character_creation" | "active"
  ): void {
    switch (newState) {
      case "menu":
        this.menu.reset();
        this.screens.show("menu");
        // Refresh slot data when returning to the menu
        this.send({ type: "request_slots", payload: {} });
        break;

      case "pending":
        // New Game chosen — show the intro and start the cinematic.
        // When it finishes, tell the server we're ready for creation.
        this.screens.show("intro");
        this.intro.start(() => {
          this.send({ type: "intro_complete", payload: {} });
        });
        break;

      case "character_creation":
        this.screens.show("creation");
        break;

      case "active":
        // Initialize the game screen with the player's identity + portrait
        this.game.init(
          this.draft.name ?? "Adventurer",
          this.draft.characterClass ?? "",
          this.portraitSpec,
          (input) => this.handleGameCommand(input)
        );
        this.screens.show("game");
        break;
    }
  }

  /**
   * Dispatches a command typed (or clicked) in the game screen. Most
   * commands are sent to the server as a raw `command` string, but the
   * party/quest verbs translate into structured messages instead, since
   * those drive dedicated client UI. Everything else falls through to the
   * server's command handler (look, move, say, help, etc.).
   */
  private handleGameCommand(input: string): void {
    const trimmed = input.trim();
    const [verb, ...rest] = trimmed.split(" ");
    const arg = rest.join(" ").trim();

    switch (verb?.toLowerCase()) {
      case "party":
        // No structured "show party" message — the roster is already live
        // via party_update. Just log a hint if not in a party.
        this.game.log("Your party roster is shown in the LOCATION panel.", "system");
        return;

      case "leave":
        this.send({ type: "party_leave", payload: {} });
        return;

      case "invite":
        if (!arg) {
          this.game.log("Invite whom? Try: invite <name>", "system");
          return;
        }
        this.send({ type: "party_invite_send", payload: { targetName: arg } });
        return;

      case "quests":
      case "quest":
        // Request the board; the response opens the overlay
        this.send({ type: "quest_board_request", payload: {} });
        return;

      case "talk":
        if (!arg) {
          this.game.log("Talk to whom? Try: talk <name>", "system");
          return;
        }
        this.send({ type: "talk", payload: { targetName: arg } });
        return;

      default:
        this.send({ type: "command", payload: { input: trimmed } });
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
