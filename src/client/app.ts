/**
 * app.ts — Mournvale client entry point
 *
 * Owns the single WebSocket connection and orchestrates screens.
 * This is the only file that touches the socket — screens communicate
 * via injected callbacks, keeping them decoupled from the network layer.
 *
 * Flow:
 *   connect → intro cinematic (client-only)
 *           → intro_complete sent
 *           → server drives character_creation dialogue
 *           → character_create confirmed
 *           → server transitions to active, sends room
 *           → game screen
 *
 * Phase 2: npc_interaction handler shows skill-check roll reveal and
 *          info reveals. talk command now parses an optional intent word:
 *          "talk Mira persuade" → { targetName: "Mira", intent: "persuade" }
 *
 * Phase 3: Handles all combat_* messages via a CombatScreen mounted
 *          in a fixed overlay that sits on top of the game screen.
 *
 * All messages conform to the ClientMessage / ServerMessage unions
 * in src/types/network.ts.
 */

import { ScreenManager } from "./screens/ScreenManager";
import { BootSplashScreen } from "./screens/BootSplashScreen";
import { MainMenuScreen } from "./screens/MainMenuScreen";
import { IntroScreen } from "./screens/IntroScreen";
import { CharacterCreationScreen } from "./screens/CharacterCreationScreen";
import { GameScreen } from "./screens/GameScreen";
import { CombatScreen } from "./screens/CombatScreen";
import { QuestBoard } from "./components/QuestBoard";
import { InvitePrompt } from "./components/InvitePrompt";
import type { PortraitSpec } from "../engine/assets/PortraitCompositor";
import type {
  ServerMessage,
  ClientMessage,
  CharacterCreationStep,
} from "../types/network";
import type { TalkIntent } from "../types/npc";

/**
 * Resolves the game-server WebSocket URL:
 *   1. VITE_SERVER_URL override (set it for a custom dev/host target), else
 *   2. in dev (Vite), the local server on :3000, else
 *   3. the same origin that served this page — so a deployed build "just works"
 *      against whatever host/domain it's running on, with wss:// under HTTPS.
 */
function resolveServerUrl(): string {
  const override = import.meta.env.VITE_SERVER_URL;
  if (override) return override;
  if (import.meta.env.DEV) return "ws://localhost:3000";
  const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${window.location.host}`;
}

const SERVER_URL = resolveServerUrl();
const PLAYER_ID_KEY = "mournvale.playerId";

/** The four valid talk intents — used to parse the optional second word. */
const VALID_INTENTS: TalkIntent[] = ["persuade", "intimidate", "inquire", "deceive"];

class MournvaleClient {
  private socket: WebSocket | null = null;

  private readonly screens = new ScreenManager();
  private readonly boot = new BootSplashScreen();
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

  // ── Phase 3 — Combat ──────────────────────────────────────────────────────

  /** Fixed overlay element that hosts the CombatScreen while in combat. */
  private combatContainer: HTMLElement | null = null;

  /** The active CombatScreen instance, present only during a fight. */
  private combatScreen: CombatScreen | null = null;

  /** The combat id currently in progress, used for submit_action messages. */
  private activeCombatId: string | null = null;

  // ─────────────────────────────────────────────
  // BOOTSTRAP
  // ─────────────────────────────────────────────

  public start(): void {
    this.playerId = this.loadOrCreatePlayerId();

    // Game Boy Color style boot splash plays first, then reveals the title
    // menu. The socket connects underneath so slots are ready by the time
    // the player finishes the splash.
    this.screens.show("boot");
    this.boot.start(() => this.enterMenu());

    this.connect();
    this.buildCombatContainer();

    // Wire the menu's New Game / Load Game / Delete handlers
    this.menu.setHandlers({
      onNewGame:    (slot) => this.send({ type: "new_game",    payload: { slot } }),
      onLoadGame:   (slot) => this.send({ type: "load_game",   payload: { slot } }),
      onDeleteSlot: (slot) => this.send({ type: "delete_slot", payload: { slot } }),
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
      onAccept:  (questId) => this.send({ type: "quest_accept",   payload: { questId } }),
      onAbandon: ()        => this.send({ type: "quest_abandon",  payload: {} }),
      onClose:   ()        => { /* board just hides */ },
    });

    // Wire the invite prompt's Accept / Decline
    this.invitePrompt.setRespondHandler((invite, accept) => {
      this.send({
        type: "party_invite_respond",
        payload: {
          partyId:      invite.partyId,
          fromPlayerId: invite.fromPlayerId,
          accept,
        },
      });
    });
  }

  /**
   * Reveals the title menu after the boot splash finishes. Defers the fog
   * start one frame so #screen-menu has its full painted dimensions.
   */
  private enterMenu(): void {
    this.screens.show("menu");
    requestAnimationFrame(() => this.menu.startFog());
  }

  // ─────────────────────────────────────────────
  // COMBAT OVERLAY
  // ─────────────────────────────────────────────

  /**
   * Creates the fixed overlay div used to host CombatScreen.
   * Hidden until combat begins. Appended to <body> so it floats above
   * all screen elements without requiring HTML changes.
   */
  private buildCombatContainer(): void {
    const div = document.createElement("div");
    div.id = "combat-overlay";
    Object.assign(div.style, {
      position:    "fixed",
      inset:       "0",
      zIndex:      "100",
      display:     "none",
      background:  "#241f1a",
    });
    document.body.appendChild(div);
    this.combatContainer = div;
  }

  private showCombatOverlay(): void {
    if (this.combatContainer) this.combatContainer.style.display = "block";
  }

  private hideCombatOverlay(): void {
    if (this.combatContainer) this.combatContainer.style.display = "none";
  }

  // ─────────────────────────────────────────────
  // IDENTITY
  // ─────────────────────────────────────────────

  private loadOrCreatePlayerId(): string {
    try {
      const existing = window.localStorage.getItem(PLAYER_ID_KEY);
      if (existing && existing.length >= 8) return existing;
      const generated = this.generateId();
      window.localStorage.setItem(PLAYER_ID_KEY, generated);
      return generated;
    } catch {
      return this.generateId();
    }
  }

  private generateId(): string {
    if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
      return crypto.randomUUID();
    }
    return "p-" + Math.random().toString(36).slice(2) + Date.now().toString(36);
  }

  // ─────────────────────────────────────────────
  // WEBSOCKET
  // ─────────────────────────────────────────────

  private connect(): void {
    this.socket = new WebSocket(SERVER_URL);

    this.socket.addEventListener("open", () => {
      console.log("[net] connected");
      this.send({ type: "identify", payload: { playerId: this.playerId } });
      // Request slots immediately on connect so menu is populated on first load
      this.send({ type: "request_slots", payload: {} });
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
        this.game.log(msg.payload.message, "system");
        break;

      case "state_transition":
        this.handleStateTransition(msg.payload.newState);
        break;

      case "dialogue":
        this.creation.showDialogue(msg);
        break;

      case "character_confirmed":
        this.draft.name           = msg.payload.name;
        this.draft.characterClass = msg.payload.characterClass;
        this.portraitSpec = {
          gender:         msg.payload.gender,
          characterClass: msg.payload.characterClass,
          hairColor:      msg.payload.hairColor,
          glasses:        msg.payload.glasses,
        };
        break;

      case "room":
        this.game.updateRoom(msg);
        break;

      case "chat":
        this.game.log(`${msg.payload.speaker}: ${msg.payload.message}`, "chat");
        break;

      case "speaker_portrait":
        this.game.showSpeakerPortrait(
          msg.payload.name,
          msg.payload.role,
          msg.payload.side
        );
        break;

      case "player_presence": {
        const verb = msg.payload.event === "entered" ? "enters" : "leaves";
        this.game.log(`${msg.payload.playerName} ${verb} the room.`, "presence");
        break;
      }

      case "slot_list":
        this.menu.setSlots(msg.payload.slots);
        break;

      case "save_result":
        this.game.log(msg.payload.message, "system");
        break;

      case "party_update":
        this.game.updateParty(msg.payload.party);
        break;

      case "party_invite":
        this.invitePrompt.show(msg.payload);
        break;

      case "quest_board":
        this.questBoard.render(msg.payload);
        this.questBoard.show();
        break;

      case "skill_screen":
        this.game.openSkillScreen(msg.payload);
        break;

      // ── Phase 2: NPC interaction with optional skill check display ─────────
      case "npc_interaction": {
        const npc = msg.payload;

        // Conversation portraits are driven by the server's speaker_portrait
        // message (so they're multiplayer-correct), not from here.

        // Roll reveal — shown when the player used a talk intent
        if (npc.checkDisplay) {
          const cd        = npc.checkDisplay;
          const skillName = cd.skill.charAt(0).toUpperCase() + cd.skill.slice(1);
          const modSign   = cd.modifier >= 0 ? "+" : "";
          const profMark  = cd.wasProficient ? "●" : "○";
          const outcomeLabel: Record<string, string> = {
            crit_success: "Critical Success!",
            success:      "Success",
            fail:         "Failure",
            crit_fail:    "Critical Failure!",
          };
          this.game.log(
            `${skillName} ${profMark} — ${cd.d20Result} ${modSign}${cd.modifier} = ${cd.total} vs DC ${cd.dc} — ${outcomeLabel[cd.outcome] ?? cd.outcome}`,
            "system"
          );
        }

        // NPC's dialogue lines
        this.game.log(`— ${npc.name}, ${npc.title} —`, "presence");
        for (const line of npc.dialogue) {
          this.game.log(`${npc.name}: ${line.text}`, "chat");
        }

        // World lore revealed by a successful check
        if (npc.infoReveal) {
          this.game.log(`You learned: ${npc.infoReveal}`, "system");
        }

        // Quest-givers: nudge the player to the board
        if (npc.questIds.length > 0) {
          this.game.log(
            `${npc.name} has work for you. Open Quests to see their offers.`,
            "system"
          );
        }

        // Vendors: list stock
        if (npc.stock.length > 0) {
          this.game.log(`${npc.name} is selling:`, "system");
          for (const item of npc.stock) {
            this.game.log(`  ${item.name} — ${item.price}g · ${item.description}`, "default");
          }
        }
        break;
      }

      // ── Phase 3: Combat messages ───────────────────────────────────────────
      case "combat_start": {
        this.activeCombatId = msg.payload.id;
        this.combatScreen   = new CombatScreen(
          this.combatContainer!,
          this.playerId,
          // onSubmitAction — forward the player's submission to the server
          (submission) => {
            if (!this.activeCombatId) return;
            this.send({
              type: "combat_submit_action",
              payload: { combatId: this.activeCombatId, submission },
            });
          },
          // onCombatEnd — hide overlay and return to the game screen
          (outcome) => {
            const label = outcome === "players_win" ? "victorious" : "defeated";
            this.game.log(`Combat ended — you were ${label}.`, "system");
            this.combatScreen?.unmount();
            this.combatScreen   = null;
            this.activeCombatId = null;
            this.hideCombatOverlay();
          }
        );
        this.combatScreen.mount();
        this.showCombatOverlay();
        this.combatScreen.handleCombatStart(msg);
        break;
      }

      case "combat_planning":
        this.combatScreen?.handleCombatPlanning(msg);
        break;

      case "combat_resolution":
        this.combatScreen?.handleCombatResolution(msg);
        break;

      case "combat_end":
        this.combatScreen?.handleCombatEnd(msg);
        break;
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
        this.menu.startFog();
        this.screens.show("menu");
        this.send({ type: "request_slots", payload: {} });
        break;

      case "pending":
        this.menu.stopFog();
        this.screens.show("intro");
        this.intro.start(() => {
          this.send({ type: "intro_complete", payload: {} });
        });
        break;

      case "character_creation":
        this.screens.show("creation");
        break;

      case "active":
        this.game.init(
          this.draft.name           ?? "Adventurer",
          this.draft.characterClass ?? "",
          this.portraitSpec,
          (input) => this.handleGameCommand(input)
        );
        this.screens.show("game");
        break;
    }
  }

  // ─────────────────────────────────────────────
  // COMMAND ROUTING
  // ─────────────────────────────────────────────

  /**
   * Dispatches a command typed (or clicked) in the game screen.
   *
   * Phase 2: The `talk` verb now parses an optional second word as a
   * talk intent. "talk Mira" → inquire by default; "talk Mira persuade"
   * → explicit persuasion check.
   *
   * Examples:
   *   talk Mira              → { targetName: "Mira" }
   *   talk Mira persuade     → { targetName: "Mira", intent: "persuade" }
   *   talk Bandit intimidate → { targetName: "Bandit", intent: "intimidate" }
   */
  private handleGameCommand(input: string): void {
    const trimmed = input.trim();
    const [verb, ...rest] = trimmed.split(" ");
    const arg = rest.join(" ").trim();

    switch (verb?.toLowerCase()) {
      case "party":
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
        this.send({ type: "quest_board_request", payload: {} });
        return;

      case "skills":
      case "character":
        // Toggle locally: the screen is opened by the server's skill_screen
        // message, but closing is a pure client action.
        if (this.game.isSkillScreenOpen()) {
          this.game.closeSkillScreen();
        } else {
          this.send({ type: "command", payload: { input: "skills" } });
        }
        return;

      case "talk": {
        if (!arg) {
          this.game.log("Talk to whom? Try: talk <name> [persuade|intimidate|inquire|deceive]", "system");
          return;
        }
        // Split "Mira persuade" → targetName = "Mira", possibleIntent = "persuade"
        const parts          = arg.split(/\s+/);
        const targetName     = parts[0] ?? "";
        const possibleIntent = parts[1]?.toLowerCase() as TalkIntent | undefined;
        const intent: TalkIntent | undefined =
          possibleIntent && VALID_INTENTS.includes(possibleIntent)
            ? possibleIntent
            : undefined;

        this.send({
          type: "talk",
          payload: {
            targetName,
            ...(intent ? { intent } : {}),
          },
        });
        return;
      }

      default:
        // `say` and everything else flow to the server. Conversation
        // portraits come back via speaker_portrait — the speaker never sees
        // their own, only the other players in the room do.
        this.send({ type: "command", payload: { input: trimmed } });
    }
  }

  // ─────────────────────────────────────────────
  // CHARACTER CREATION
  // ─────────────────────────────────────────────

  private handleCreationChoice(step: CharacterCreationStep, value: string): void {
    this.draft[step] = value;
    this.send({ type: "dialogue_choice", payload: { step, value } });
  }
}

// ─────────────────────────────────────────────
// BOOTSTRAP
// ─────────────────────────────────────────────

window.addEventListener("DOMContentLoaded", () => {
  const client = new MournvaleClient();
  client.start();
});
