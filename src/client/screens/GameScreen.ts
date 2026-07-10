/**
 * GameScreen.ts — The main game interface for active players
 *
 * Left panel layout (stacked, always visible):
 *   ┌─────────────────┐
 *   │ HERE:           │  ← NPCs at the current location only
 *   │  Merchant       │     "No one is here." if empty
 *   │  Guard          │
 *   ├─────────────────┤  ← thin divider
 *   │ PARTY:          │  ← party members (blank section if solo)
 *   │  Aelric  HP ██  │
 *   └─────────────────┘
 *
 * Players / party members are never listed in the Here: section.
 * Party state comes exclusively from updateParty(); the players[]
 * field on RoomMessage is intentionally ignored.
 *
 * Phase 2 NPC intent buttons are preserved unchanged.
 * All outgoing commands flow through the onCommand callback.
 */

import { CommandMenu, DEFAULT_COMMANDS, VERTICAL_COMMANDS, TRADE_COMMAND, type CommandDefinition } from "../components/CommandMenu";
import { PartyPanel } from "../components/PartyPanel";
import { CharacterPanel } from "../components/CharacterPanel";
import { TalentTreePanel } from "../components/TalentTreePanel";
import { AbilityListPanel } from "../components/AbilityListPanel";
import { DialoguePortrait } from "../components/DialoguePortrait";
import { assetRegistry } from "../../engine/assets/AssetRegistry";
import {
  portraitCompositor,
  type PortraitSpec,
} from "../../engine/assets/PortraitCompositor";
import { composeNpcPortrait, composePlayerPortrait } from "../../engine/assets/NpcPortrait";
import type { RoomMessage, SkillScreenView } from "../../types/network";
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
  { intent: "inquire",    label: "Inquire",    title: "Ask a direct question (Insight)" },
  { intent: "persuade",   label: "Persuade",   title: "Appeal to reason or emotion (Persuasion)" },
  { intent: "intimidate", label: "Intimidate", title: "Use force of personality (Intimidation)" },
  { intent: "deceive",    label: "Deceive",    title: "Mislead or misdirect (Deception)" },
];

// ─────────────────────────────────────────────
// GameScreen
// ─────────────────────────────────────────────

export class GameScreen {
  // Header
  private readonly headerName: HTMLElement;
  private readonly headerClass: HTMLElement;
  private readonly headerPortrait: HTMLElement;

  // Room panel
  private readonly roomName: HTMLElement;
  private readonly roomDesc: HTMLElement;
  private readonly roomExits: HTMLElement;
  private readonly roomNpcs: HTMLElement;
  private readonly roomImage: HTMLElement;
  /** Child of roomImage that holds the actual art (kept separate from the
   * dialogue-portrait overlay so art swaps don't wipe the portraits). */
  private readonly roomImageArt: HTMLElement;

  // Log + input
  private readonly messageLog: HTMLElement;
  private readonly commandInput: HTMLInputElement;
  private readonly commandSend: HTMLButtonElement;

  // Sub-components
  private readonly commandMenu: CommandMenu;
  private readonly partyPanel: PartyPanel;
  private readonly dialoguePortrait: DialoguePortrait;
  /**
   * Names of speakers whose conversation portraits are currently on screen.
   * A shown portrait is "sticky": it persists through the whole exchange (the
   * "considers your words…", the dice line, the reply) and is dismissed only
   * when the log shows something unrelated — a different speaker, or someone
   * entering/leaving the room. Empty when no portrait is up. See log().
   */
  private conversationSpeakers = new Set<string>();
  private onCommand: ((input: string) => void) | null = null;

  /** The local player's identity, used to label their own dialogue portrait. */
  private playerName = "You";

  // Character/skills screen — repurposes the three panels in place
  private readonly characterPanel: CharacterPanel;
  private readonly talentTreePanel: TalentTreePanel;
  private readonly abilityListPanel: AbilityListPanel;
  /** The three panel elements toggled into "skills" mode together. */
  private readonly skillPanels: HTMLElement[];
  private skillScreenOpen = false;
  /** Cached portrait spec, reused for the talent panel preview. */
  private portraitSpec: PortraitSpec | null = null;

  /** Tracks the last room art key so we don't re-fetch on every update */
  private currentArtKey: string | null = null;

  /**
   * Id of the NPC row currently expanded to show intent buttons.
   * Null when no row is open.
   */
  private expandedNpcId: string | null = null;

  // Mobile swipe layout: the book-spread scrolls horizontally between the
  // room view (page 0) and the log (page 1); the dots reflect the position.
  private readonly bookSpread: HTMLElement;
  private readonly spreadDots: HTMLElement[];

  constructor() {
    this.headerName     = this.requireEl("player-name-display");
    this.headerClass    = this.requireEl("player-class-display");
    this.headerPortrait = this.requireEl("header-portrait");

    this.roomName  = this.requireEl("room-name");
    this.roomDesc  = this.requireEl("room-description");
    this.roomExits = this.requireEl("room-exits");
    this.roomNpcs  = this.requireEl("room-npcs");
    this.roomImage = this.requireEl("room-image");

    this.messageLog   = this.requireEl("message-log");
    this.commandInput = this.requireEl("command-input") as HTMLInputElement;
    this.commandSend  = this.requireEl("command-send")  as HTMLButtonElement;

    this.commandMenu = new CommandMenu("command-buttons");
    this.partyPanel  = new PartyPanel();

    // Room art renders into its own child so it can be replaced freely
    // (innerHTML swaps) without destroying the portrait layer that overlays it.
    this.roomImageArt = document.createElement("div");
    this.roomImageArt.className = "room-image-art";
    this.roomImage.appendChild(this.roomImageArt);
    this.dialoguePortrait = new DialoguePortrait(this.roomImage);

    // Character/skills panels (hidden until openSkillScreen)
    this.characterPanel   = new CharacterPanel("character-panel");
    this.talentTreePanel  = new TalentTreePanel("talent-panel");
    this.abilityListPanel = new AbilityListPanel("ability-panel");
    this.skillPanels = [
      this.requireEl("details-panel"),
      this.requireEl("room-image-panel"),
      this.requireEl("log-panel"),
    ];

    this.characterPanel.setCloseHandler(() => this.closeSkillScreen());
    this.characterPanel.setCommandHandler((cmd) => this.send(cmd));
    this.talentTreePanel.setCommandHandler((cmd) => this.send(cmd));
    this.abilityListPanel.setCommandHandler((cmd) => this.send(cmd));

    this.bookSpread = this.requireEl("book-spread");
    this.spreadDots = Array.from(
      document.querySelectorAll<HTMLElement>("#spread-dots .spread-dot")
    );

    this.wireInput();
    this.wireCommandToggle();
    this.wireSpreadSwipe();
  }

  // ─────────────────────────────────────────────
  // PUBLIC API
  // ─────────────────────────────────────────────

  public setPartyLeaveHandler(handler: () => void): void {
    this.partyPanel.setLeaveHandler(handler);
  }

  public setPartyInviteHandler(handler: (name: string) => void): void {
    this.partyPanel.setInviteHandler(handler);
  }

  public setPartyMemberViewHandler(handler: (playerId: string) => void): void {
    this.partyPanel.setMemberViewHandler(handler);
  }

  public updateParty(party: PartyView | null): void {
    this.partyPanel.update(party);
  }

  // ─────────────────────────────────────────────
  // CHARACTER / SKILLS SCREEN
  // ─────────────────────────────────────────────

  /**
   * Opens (or refreshes) the character/skills screen by swapping the three
   * panels into "skills" mode and rendering them from the server view. Safe to
   * call repeatedly: the server re-emits the view after every mutation, and
   * each call just re-renders while the screen stays open. The underlying room
   * and party DOM is only hidden (via CSS), so closing restores it as-is —
   * no caching or re-render of room state needed.
   */
  public openSkillScreen(view: SkillScreenView): void {
    this.characterPanel.update(view);
    this.talentTreePanel.update(view);
    this.abilityListPanel.update(view);

    if (!this.skillScreenOpen) {
      for (const panel of this.skillPanels) panel.classList.add("skills-active");
      this.skillScreenOpen = true;
    }
  }

  public closeSkillScreen(): void {
    if (!this.skillScreenOpen) return;
    for (const panel of this.skillPanels) panel.classList.remove("skills-active");
    this.skillScreenOpen = false;
  }

  public isSkillScreenOpen(): boolean {
    return this.skillScreenOpen;
  }

  public init(
    playerName: string,
    playerClass: string,
    portraitSpec: PortraitSpec | null,
    onCommand: (input: string) => void
  ): void {
    this.onCommand = onCommand;
    this.playerName = playerName;
    this.headerName.textContent  = playerName;
    this.headerClass.textContent = playerClass.toUpperCase();
    this.portraitSpec = portraitSpec;
    this.talentTreePanel.setPortraitSpec(portraitSpec);

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
    const { name, description, exits, npcs, players, artKey } = msg.payload;

    this.roomName.textContent  = name;
    this.roomDesc.textContent  = description;
    this.roomExits.textContent = exits.length > 0 ? exits.join(", ") : "none";

    this.updateContextualCommands(exits, npcs);
    this.expandedNpcId = null;
    this.renderHere(npcs, players);
    this.updateRoomImage(artKey);

    // Leaving a room ends any in-progress conversation portraits.
    this.dismissConversationPortraits();
  }

  // ─────────────────────────────────────────────
  // DIALOGUE PORTRAITS
  // ─────────────────────────────────────────────

  /**
   * Slides a conversation portrait in, as directed by the server's
   * `speaker_portrait` message. The server decides who sees what — a speaker
   * never gets their own portrait, only the other room players do:
   *   • an NPC you address                → role = its NpcRole, side "left"
   *   • a fellow player addressing an NPC  → role "player", side "right"
   *   • a fellow player speaking to the room → role "player", side "left"
   */
  public showSpeakerPortrait(
    name: string,
    role: NpcRole | "player",
    side: "left" | "right"
  ): void {
    const svg = role === "player"
      ? composePlayerPortrait(name)
      : composeNpcPortrait(name, role);
    this.dialoguePortrait.show(side, svg, name);
    this.conversationSpeakers.add(name);
  }

  /** Slides all conversation portraits out and forgets their speakers. */
  private dismissConversationPortraits(): void {
    this.dialoguePortrait.hideAll();
    this.conversationSpeakers.clear();
  }

  /**
   * Shows Up/Down buttons only when the current room has that vertical exit.
   * Horizontal movement stays always-on (the N/S/E/W buttons), matching the
   * existing UX; only vertical movement is gated on availability.
   */
  private updateContextualCommands(exits: string[], npcs: NpcView[]): void {
    const contextual: CommandDefinition[] = [];
    if (exits.includes("up"))   contextual.push(VERTICAL_COMMANDS.up);
    if (exits.includes("down")) contextual.push(VERTICAL_COMMANDS.down);
    // A Trade button appears only where there's a vendor to trade with.
    if (npcs.some(n => n.role === "vendor")) contextual.push(TRADE_COMMAND);
    this.commandMenu.setContextual(contextual);
  }

  public log(text: string, kind: LogKind = "default"): void {
    const entry = document.createElement("div");
    entry.className   = `log-entry log-${kind}`;
    entry.textContent = text;
    this.messageLog.appendChild(entry);
    this.messageLog.scrollTop = this.messageLog.scrollHeight;

    this.markLogUnread();
    this.maybeDismissPortraitsForLog(text, kind);
  }

  // ─────────────────────────────────────────────
  // MOBILE CHROME — command toggle + swipe pages
  // ─────────────────────────────────────────────

  /**
   * Collapses the command grid behind the small toggle strip on phones so the
   * room illustration keeps the screen. Desktop never collapses (the toggle is
   * display:none there and the collapsed rule lives inside the media query).
   */
  private wireCommandToggle(): void {
    const menu   = document.getElementById("command-menu");
    const toggle = document.getElementById("command-toggle");
    if (!menu || !toggle) return;

    if (window.matchMedia("(max-width: 700px)").matches) {
      menu.classList.add("cmd-collapsed");
    }

    const paint = () => {
      const collapsed = menu.classList.contains("cmd-collapsed");
      toggle.textContent = collapsed ? "COMMANDS ▴" : "COMMANDS ▾";
      toggle.setAttribute("aria-expanded", String(!collapsed));
    };
    toggle.addEventListener("click", () => {
      menu.classList.toggle("cmd-collapsed");
      paint();
    });
    paint();
  }

  /** True when the spread is in the horizontal swipe layout (phone widths). */
  private spreadIsSwipeable(): boolean {
    return this.bookSpread.scrollWidth > this.bookSpread.clientWidth + 10;
  }

  private spreadPage(): number {
    return Math.round(this.bookSpread.scrollLeft / this.bookSpread.clientWidth);
  }

  /** Keeps the page dots in sync with swipes and makes them tappable. */
  private wireSpreadSwipe(): void {
    if (this.spreadDots.length === 0) return;

    const paint = () => {
      const page = this.spreadPage();
      this.spreadDots.forEach((dot, i) => {
        dot.classList.toggle("spread-dot-active", i === page);
        if (i === page) dot.classList.remove("spread-dot-unread");
      });
    };

    this.bookSpread.addEventListener("scroll", paint, { passive: true });
    this.spreadDots.forEach((dot, i) => {
      dot.addEventListener("click", () => {
        this.bookSpread.scrollTo({
          left: i * this.bookSpread.clientWidth,
          behavior: "smooth",
        });
      });
    });
  }

  /** Pulses the log dot when a line arrives while the log page is off-screen. */
  private markLogUnread(): void {
    const logDot = this.spreadDots[1];
    if (!logDot || !this.spreadIsSwipeable()) return;
    if (this.spreadPage() === 0) logDot.classList.add("spread-dot-unread");
  }

  /**
   * Keeps a shown conversation portrait alive through its whole exchange and
   * dismisses it when the log turns to something unrelated. The exchange is
   * everything tied to the speaker: the "considers your words…" beat, the dice
   * line, the spoken reply, vendor stock — all `system`/`default` lines and any
   * `chat` from a speaker whose portrait is up. It is dismissed by:
   *   • a `presence` line (someone entered/left) or an `error`, and
   *   • a `chat` line from a speaker with no portrait up (a new exchange).
   * Room changes clear it separately (see changeRoom → dismissConversationPortraits).
   */
  private maybeDismissPortraitsForLog(text: string, kind: LogKind): void {
    if (this.conversationSpeakers.size === 0) return;

    if (kind === "presence" || kind === "error") {
      this.dismissConversationPortraits();
      return;
    }
    if (kind === "chat") {
      const speaker = text.slice(0, text.indexOf(":"));
      if (!this.conversationSpeakers.has(speaker)) {
        this.dismissConversationPortraits();
      }
    }
    // system / default lines are part of the active exchange — keep the portrait.
  }

  // ─────────────────────────────────────────────
  // NPC RENDERING
  // ─────────────────────────────────────────────

  /**
   * Renders the Here: section — the room's NPCs plus every other player
   * standing in the room. The server re-sends the room snapshot to all
   * occupants whenever someone enters or leaves, so this list stays live.
   * Shows "No one is here." when both lists are empty.
   */
  private renderHere(npcs: NpcView[], playerNames: string[]): void {
    this.roomNpcs.innerHTML = "";

    if (npcs.length === 0 && playerNames.length === 0) {
      const empty = document.createElement("span");
      empty.className   = "room-npcs-empty";
      empty.textContent = "No one is here.";
      this.roomNpcs.appendChild(empty);
      return;
    }

    // Fellow players first — simple presence rows (no intent buttons).
    for (const playerName of playerNames) {
      const row = document.createElement("div");
      row.className = "npc-row here-player-row";
      row.title     = `${playerName} is here`;

      const nameSpan = document.createElement("span");
      nameSpan.className   = "npc-name";
      nameSpan.textContent = playerName;

      const tag = document.createElement("span");
      tag.className   = "npc-role-tag here-player-tag";
      tag.textContent = "traveler";

      row.appendChild(nameSpan);
      row.appendChild(tag);
      this.roomNpcs.appendChild(row);
    }

    for (const npc of npcs) {
      const wrapper = document.createElement("div");
      wrapper.className        = "npc-wrapper";
      wrapper.dataset["npcId"] = npc.id;

      // ── Header row ──────────────────────────────────────────────────────
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

      // ── Intent group ─────────────────────────────────────────────────────
      const intentGroup = document.createElement("div");
      intentGroup.className     = "npc-intent-group";
      intentGroup.style.display = "none";

      if (npc.role === "hostile") {
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
        for (const option of INTENT_OPTIONS) {
          const btn = document.createElement("button");
          btn.className   = "npc-intent-btn";
          btn.textContent = option.label;
          btn.title       = `${option.title} — then type what you say`;
          btn.addEventListener("click", (e) => {
            e.stopPropagation();
            // Prefill the action verb + target; the player types their words,
            // routing through the unified chat with that intent forced.
            this.focusInputWith(`${option.intent} ${npc.name}`);
            this.collapseNpcRow(wrapper, intentGroup);
          });
          intentGroup.appendChild(btn);
        }
      }

      // ── Toggle logic ─────────────────────────────────────────────────────
      header.addEventListener("click", () => {
        const isOpen = intentGroup.style.display !== "none";

        if (this.expandedNpcId && this.expandedNpcId !== npc.id) {
          const prevGroup = this.roomNpcs.querySelector<HTMLElement>(
            `[data-npc-id="${this.expandedNpcId}"] .npc-intent-group`
          );
          const prevWrap = this.roomNpcs.querySelector<HTMLElement>(
            `[data-npc-id="${this.expandedNpcId}"]`
          );
          if (prevGroup) prevGroup.style.display = "none";
          if (prevWrap)  prevWrap.classList.remove("npc-wrapper-open");
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
      this.roomImageArt.innerHTML = '<div class="room-image-empty">— no view —</div>';
      return;
    }

    const key = `tiles/${artKey}` as const;

    // Raster art (PNG/JPG/…) loads lazily via <img src>; no text fetch.
    if (assetRegistry.isRaster(key)) {
      this.setRoomImagePng(artKey, assetRegistry.resolveUrl(key));
      return;
    }

    // SVG art is fetched as text and injected inline (themeable).
    const cached = assetRegistry.get(key);
    if (cached) {
      this.roomImageArt.innerHTML = cached;
      return;
    }

    void assetRegistry
      .load(key)
      .then((content) => {
        if (this.currentArtKey === artKey) this.roomImageArt.innerHTML = content;
      })
      .catch(() => {
        if (this.currentArtKey === artKey) {
          this.roomImageArt.innerHTML = '<div class="room-image-empty">— no view —</div>';
        }
      });
  }

  /** Renders a raster room image as an <img>, replacing any prior content. */
  private setRoomImagePng(artKey: string, url: string): void {
    const img     = document.createElement("img");
    img.src       = url;
    img.alt       = artKey;
    img.className = "room-image-png";
    img.onerror   = () => {
      if (this.currentArtKey === artKey) {
        this.roomImageArt.innerHTML = '<div class="room-image-empty">— no view —</div>';
      }
    };
    this.roomImageArt.innerHTML = "";
    this.roomImageArt.appendChild(img);
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
