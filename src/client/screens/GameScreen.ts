/**
 * GameScreen.ts — The main game interface for active players
 *
 * Responsibilities:
 *   - Render the room panel (name, description, exits, occupants)
 *   - Append messages to the scrolling log (system/chat/presence/error)
 *   - Host the CommandMenu (clickable command buttons)
 *   - Handle the text input for custom/typed commands
 *
 * Phase 2 additions:
 *   - NPC rows now expand on click to reveal intent buttons rather than
 *     immediately sending a bare "talk <name>". The four intents
 *     (Inquire / Persuade / Intimidate / Deceive) each send a targeted
 *     "talk <name> <intent>" command. Hostile NPCs show a Fight button
 *     instead, which will hook into combat when Phase 3 is integrated.
 *
 * All outgoing commands flow through a single onCommand callback that
 * the app forwards to the server.
 */

import { CommandMenu, DEFAULT_COMMANDS } from "../components/CommandMenu";
import { PartyPanel } from "../components/PartyPanel";
import { assetRegistry } from "../../engine/assets/AssetRegistry";
import {
  portraitCompositor,
  type PortraitSpec,
} from "../../engine/assets/PortraitCompositor";
import type { RoomMessage } from "../../types/network";
import type { PartyView } from "../../types/party";
import type { NpcView, NpcRole, TalkIntent } from "../../types/npc";

export type LogKind = "system" | "chat" | "error" | "presence" | "default";

// ── Intent config ─────────────────────────────────────────────────────────────

interface IntentOption {
  intent: TalkIntent;
  label: string;
  title: string;
}

const INTENT_OPTIONS: IntentOption[] = [
  { intent: "inquire",   label: "Inquire",    title: "Ask a direct question (Insight)" },
  { intent: "persuade",  label: "Persuade",   title: "Appeal to reason or emotion (Persuasion)" },
  { intent: "intimidate",label: "Intimidate", title: "Use force of personality (Intimidation)" },
  { intent: "deceive",   label: "Deceive",    title: "Mislead or misdirect (Deception)" },
];

// ─────────────────────────────────────────────
// GameScreen
// ─────────────────────────────────────────────

export class GameScreen {
  private readonly headerName: HTMLElement;
  private readonly headerClass: HTMLElement;
  private readonly roomName: HTMLElement;
  private readonly roomDesc: HTMLElement;
  private readonly roomExits: HTMLElement;
  private readonly roomPlayers: HTMLElement;
  private readonly roomNpcs: HTMLElement;
  private readonly messageLog: HTMLElement;
  private readonly commandInput: HTMLInputElement;
  private readonly commandSend: HTMLButtonElement;
  private readonly headerPortrait: HTMLElement;
  private readonly roomImage: HTMLElement;

  private readonly commandMenu: CommandMenu;
  private readonly partyPanel: PartyPanel;
  private onCommand: ((input: string) => void) | null = null;

  /** Tracks the last room art key so we don't re-fetch on every update */
  private currentArtKey: string | null = null;

  /**
   * Id of the NPC row currently expanded to show intent buttons.
   * Null when no row is open. Clicking a different row closes the current one.
   */
  private expandedNpcId: string | null = null;

  constructor() {
    this.headerName    = this.requireEl("player-name-display");
    this.headerClass   = this.requireEl("player-class-display");
    this.roomName      = this.requireEl("room-name");
    this.roomDesc      = this.requireEl("room-description");
    this.roomExits     = this.requireEl("room-exits");
    this.roomPlayers   = this.requireEl("room-players");
    this.roomNpcs      = this.requireEl("room-npcs");
    this.messageLog    = this.requireEl("message-log");
    this.commandInput  = this.requireEl("command-input") as HTMLInputElement;
    this.commandSend   = this.requireEl("command-send") as HTMLButtonElement;
    this.headerPortrait= this.requireEl("header-portrait");
    this.roomImage     = this.requireEl("room-image");

    this.commandMenu = new CommandMenu("command-buttons");
    this.partyPanel  = new PartyPanel();
    this.wireInput();
  }

  // ─────────────────────────────────────────────
  // PUBLIC API
  // ─────────────────────────────────────────────

  public setPartyLeaveHandler(handler: () => void): void {
    this.partyPanel.setLeaveHandler(handler);
  }

  public updateParty(party: PartyView | null): void {
    this.partyPanel.update(party);
  }

  public init(
    playerName: string,
    playerClass: string,
    portraitSpec: PortraitSpec | null,
    onCommand: (input: string) => void
  ): void {
    this.onCommand = onCommand;
    this.headerName.textContent  = playerName;
    this.headerClass.textContent = playerClass.toUpperCase();

    if (portraitSpec) {
      this.headerPortrait.innerHTML = portraitCompositor.compose(portraitSpec);
    }

    this.commandMenu.render(
      DEFAULT_COMMANDS,
      (command) => this.send(command),
      (prefix)  => this.focusInputWith(prefix)
    );
  }

  public updateRoom(msg: RoomMessage): void {
    const { name, description, exits, players, npcs, artKey } = msg.payload;

    this.roomName.textContent = name;
    this.roomDesc.textContent = description;
    this.roomExits.textContent = exits.length > 0 ? exits.join(", ") : "none";
    this.roomPlayers.textContent =
      players.length > 0 ? players.join("\n") : "You are alone.";

    // Reset expanded state when the room changes
    this.expandedNpcId = null;
    this.renderNpcs(npcs);
    this.updateRoomImage(artKey);
  }

  public log(text: string, kind: LogKind = "default"): void {
    const entry = document.createElement("div");
    entry.className = `log-entry log-${kind}`;
    entry.textContent = text;
    this.messageLog.appendChild(entry);
    this.messageLog.scrollTop = this.messageLog.scrollHeight;
  }

  // ─────────────────────────────────────────────
  // NPC RENDERING (Phase 2)
  // ─────────────────────────────────────────────

  /**
   * Renders the NPC list in the room panel.
   *
   * Each NPC row is a two-part element:
   *   - Header row: name + title, clickable to toggle the intent group
   *   - Intent group: 4 intent buttons (or Fight for hostile), revealed on click
   *
   * Clicking an intent sends "talk <npc.name> <intent>" through the normal
   * command path, which the app parses into a structured TalkMessage.
   *
   * Hostile NPCs skip the intent buttons and show a single "Fight" button,
   * which sends "fight <npc.name>" (server routes to combat trigger).
   */
  private renderNpcs(npcs: NpcView[]): void {
    this.roomNpcs.innerHTML = "";
    if (npcs.length === 0) return;

    for (const npc of npcs) {
      const wrapper = document.createElement("div");
      wrapper.className = "npc-wrapper";
      wrapper.dataset["npcId"] = npc.id;

      // ── Header row (always visible) ─────────────────────────────────────
      const header = document.createElement("div");
      header.className = "npc-row";
      header.title     = npc.role === "hostile"
        ? `${npc.name} is hostile`
        : `Talk to ${npc.name}`;

      const nameSpan = document.createElement("span");
      nameSpan.className   = "npc-name";
      nameSpan.textContent = `${npc.name} — ${npc.title}`;

      const roleTag = document.createElement("span");
      roleTag.className   = `npc-role-tag npc-role-${npc.role}`;
      roleTag.textContent = this.roleLabel(npc.role);

      header.appendChild(nameSpan);
      header.appendChild(roleTag);

      // ── Intent group (shown on click) ────────────────────────────────────
      const intentGroup = document.createElement("div");
      intentGroup.className = "npc-intent-group";
      intentGroup.style.display = "none";

      if (npc.role === "hostile") {
        // Hostile NPCs: single Fight button
        const fightBtn = document.createElement("button");
        fightBtn.className   = "npc-intent-btn npc-intent-fight";
        fightBtn.textContent = "⚔ Fight";
        fightBtn.title       = "Engage in combat";
        fightBtn.addEventListener("click", (e) => {
          e.stopPropagation();
          this.send(`fight ${npc.name}`);
          this.collapseNpcRow(wrapper, intentGroup);
        });
        intentGroup.appendChild(fightBtn);
      } else {
        // Non-hostile NPCs: four intent buttons
        for (const option of INTENT_OPTIONS) {
          const btn = document.createElement("button");
          btn.className   = "npc-intent-btn";
          btn.textContent = option.label;
          btn.title       = option.title;
          btn.addEventListener("click", (e) => {
            e.stopPropagation();
            this.send(`talk ${npc.name} ${option.intent}`);
            this.collapseNpcRow(wrapper, intentGroup);
          });
          intentGroup.appendChild(btn);
        }
      }

      // ── Toggle logic ─────────────────────────────────────────────────────
      header.addEventListener("click", () => {
        const isOpen = intentGroup.style.display !== "none";

        // Close any previously open row first
        if (this.expandedNpcId && this.expandedNpcId !== npc.id) {
          const prev = this.roomNpcs.querySelector<HTMLElement>(
            `[data-npc-id="${this.expandedNpcId}"] .npc-intent-group`
          );
          const prevWrapper = this.roomNpcs.querySelector<HTMLElement>(
            `[data-npc-id="${this.expandedNpcId}"]`
          );
          if (prev) prev.style.display = "none";
          if (prevWrapper) prevWrapper.classList.remove("npc-wrapper-open");
        }

        if (isOpen) {
          intentGroup.style.display = "none";
          wrapper.classList.remove("npc-wrapper-open");
          this.expandedNpcId = null;
        } else {
          intentGroup.style.display = "flex";
          wrapper.classList.add("npc-wrapper-open");
          this.expandedNpcId = npc.id;
        }
      });

      wrapper.appendChild(header);
      wrapper.appendChild(intentGroup);
      this.roomNpcs.appendChild(wrapper);
    }
  }

  private collapseNpcRow(wrapper: HTMLElement, intentGroup: HTMLElement): void {
    intentGroup.style.display = "none";
    wrapper.classList.remove("npc-wrapper-open");
    this.expandedNpcId = null;
  }

  /** Short role label shown as a tag on each NPC row. */
  private roleLabel(role: NpcRole): string {
    const labels: Record<NpcRole, string> = {
      dialogue:   "",
      friendly:   "",
      questgiver: "quest",
      vendor:     "shop",
      hostile:    "hostile",
    };
    return labels[role] ?? "";
  }

  // ─────────────────────────────────────────────
  // ROOM IMAGE
  // ─────────────────────────────────────────────

  private updateRoomImage(artKey: string | undefined): void {
    if (artKey === this.currentArtKey) return;
    this.currentArtKey = artKey ?? null;

    if (!artKey) {
      this.roomImage.innerHTML = '<div class="room-image-empty">— no view —</div>';
      return;
    }

    const key    = `tiles/${artKey}` as const;
    const cached = assetRegistry.get(key);

    if (cached) {
      this.roomImage.innerHTML = cached;
      return;
    }

    void assetRegistry
      .load(key)
      .then((svg) => {
        if (this.currentArtKey === artKey) this.roomImage.innerHTML = svg;
      })
      .catch(() => {
        if (this.currentArtKey === artKey) {
          this.roomImage.innerHTML = '<div class="room-image-empty">— no view —</div>';
        }
      });
  }

  // ─────────────────────────────────────────────
  // INPUT
  // ─────────────────────────────────────────────

  private wireInput(): void {
    const submit = () => {
      const value = this.commandInput.value.trim();
      if (!value) return;
      this.send(value);
      this.commandInput.value = "";
    };

    this.commandSend.addEventListener("click", submit);
    this.commandInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") { e.preventDefault(); submit(); }
    });
  }

  private focusInputWith(prefix: string): void {
    this.commandInput.value = `${prefix} `;
    this.commandInput.focus();
    const len = this.commandInput.value.length;
    this.commandInput.setSelectionRange(len, len);
  }

  private send(input: string): void {
    this.onCommand?.(input);
  }

  private requireEl(id: string): HTMLElement {
    const el = document.getElementById(id);
    if (!el) throw new Error(`GameScreen: missing element #${id}`);
    return el;
  }
}
