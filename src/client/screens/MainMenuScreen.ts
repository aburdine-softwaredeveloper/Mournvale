/**
 * MainMenuScreen.ts — The entry menu: New Game / Load Game
 *
 * Flow:
 *   1. Two top-level buttons: NEW GAME and LOAD GAME
 *   2. Either choice reveals the 5-slot picker
 *   3. In NEW GAME mode, clicking a slot starts a new character there
 *      (occupied slots ask for overwrite confirmation)
 *   4. In LOAD GAME mode, clicking an occupied slot loads it
 *      (empty slots are disabled)
 *
 * The slot summaries come from the server (slot_list message). This
 * screen is a pure view + input collector — it reports the player's
 * choice via callbacks and never touches the socket directly.
 */

import type { SaveSlotSummary } from "../../types/network";

type MenuMode = "root" | "new" | "load";

export class MainMenuScreen {
  private readonly root: HTMLElement;
  private readonly rootButtons: HTMLElement;
  private readonly slotPanel: HTMLElement;
  private readonly slotList: HTMLElement;
  private readonly slotTitle: HTMLElement;
  private readonly backButton: HTMLButtonElement;
  private readonly newGameBtn: HTMLButtonElement;
  private readonly loadGameBtn: HTMLButtonElement;

  private slots: SaveSlotSummary[] = [];
  private mode: MenuMode = "root";

  private onNewGame: ((slot: number) => void) | null = null;
  private onLoadGame: ((slot: number) => void) | null = null;
  private onDeleteSlot: ((slot: number) => void) | null = null;

  constructor() {
    this.root = this.requireEl("screen-menu");
    this.rootButtons = this.requireEl("menu-root-buttons");
    this.slotPanel = this.requireEl("menu-slot-panel");
    this.slotList = this.requireEl("menu-slot-list");
    this.slotTitle = this.requireEl("menu-slot-title");
    this.backButton = this.requireEl("menu-back-btn") as HTMLButtonElement;
    this.newGameBtn = this.requireEl("menu-new-game") as HTMLButtonElement;
    this.loadGameBtn = this.requireEl("menu-load-game") as HTMLButtonElement;

    this.wireButtons();
  }

  /** Registers the callbacks the app uses to talk to the server */
  public setHandlers(handlers: {
    onNewGame: (slot: number) => void;
    onLoadGame: (slot: number) => void;
    onDeleteSlot: (slot: number) => void;
  }): void {
    this.onNewGame = handlers.onNewGame;
    this.onLoadGame = handlers.onLoadGame;
    this.onDeleteSlot = handlers.onDeleteSlot;
  }

  /** Updates the slot data and re-renders if the picker is visible */
  public setSlots(slots: SaveSlotSummary[]): void {
    this.slots = slots;
    if (this.mode !== "root") this.renderSlots();
  }

  /** Resets the menu to its root (two-button) view */
  public reset(): void {
    this.mode = "root";
    this.slotPanel.classList.add("hidden");
    this.rootButtons.classList.remove("hidden");
  }

  private wireButtons(): void {
    this.newGameBtn.addEventListener("click", () => this.enterMode("new"));
    this.loadGameBtn.addEventListener("click", () => this.enterMode("load"));
    this.backButton.addEventListener("click", () => this.reset());
  }

  private enterMode(mode: MenuMode): void {
    this.mode = mode;
    this.slotTitle.textContent =
      mode === "new" ? "NEW GAME — CHOOSE A SLOT" : "LOAD GAME — CHOOSE A SLOT";
    this.rootButtons.classList.add("hidden");
    this.slotPanel.classList.remove("hidden");
    this.renderSlots();
  }

  /** Renders the 5 slots according to the current mode */
  private renderSlots(): void {
    this.slotList.innerHTML = "";

    for (const summary of this.slots) {
      this.slotList.appendChild(this.buildSlotRow(summary));
    }
  }

  /** Builds a single slot row element */
  private buildSlotRow(summary: SaveSlotSummary): HTMLElement {
    const row = document.createElement("div");
    row.className = "slot-row";

    // Label area
    const label = document.createElement("div");
    label.className = "slot-label";

    const slotNum = document.createElement("span");
    slotNum.className = "slot-num";
    slotNum.textContent = `SLOT ${summary.slot}`;
    label.appendChild(slotNum);

    const detail = document.createElement("span");
    detail.className = "slot-detail";
    if (summary.occupied) {
      detail.textContent =
        `${summary.characterName} — ${summary.characterClass}\n` +
        `${summary.roomName ?? ""}  ·  ${this.formatDate(summary.savedAt)}`;
    } else {
      detail.textContent = "— Empty —";
      detail.classList.add("slot-empty");
    }
    label.appendChild(detail);

    row.appendChild(label);

    // Action area depends on mode
    const actions = document.createElement("div");
    actions.className = "slot-actions";

    if (this.mode === "new") {
      const btn = document.createElement("button");
      btn.className = "snes-btn";
      btn.textContent = summary.occupied ? "OVERWRITE" : "START";
      btn.addEventListener("click", () => this.chooseNew(summary));
      actions.appendChild(btn);
    } else if (this.mode === "load") {
      const btn = document.createElement("button");
      btn.className = "snes-btn";
      btn.textContent = "LOAD";
      btn.disabled = !summary.occupied;
      if (!summary.occupied) btn.classList.add("btn-disabled");
      btn.addEventListener("click", () => {
        if (summary.occupied) this.onLoadGame?.(summary.slot);
      });
      actions.appendChild(btn);
    }

    // Delete is available for occupied slots in both modes
    if (summary.occupied) {
      const del = document.createElement("button");
      del.className = "snes-btn snes-btn-danger";
      del.textContent = "✕";
      del.title = "Delete this save";
      del.addEventListener("click", () => this.confirmDelete(summary.slot));
      actions.appendChild(del);
    }

    row.appendChild(actions);
    return row;
  }

  /** Handles choosing a slot in NEW GAME mode, with overwrite confirm */
  private chooseNew(summary: SaveSlotSummary): void {
    if (summary.occupied) {
      const ok = window.confirm(
        `Slot ${summary.slot} already holds ${summary.characterName}. ` +
          `Overwrite with a new character?`
      );
      if (!ok) return;
    }
    this.onNewGame?.(summary.slot);
  }

  /** Confirms then requests deletion of a slot */
  private confirmDelete(slot: number): void {
    const ok = window.confirm(`Delete the save in slot ${slot}? This cannot be undone.`);
    if (ok) this.onDeleteSlot?.(slot);
  }

  /** Formats a save timestamp for display */
  private formatDate(ts?: number): string {
    if (!ts) return "";
    const d = new Date(ts);
    return d.toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
    }) + " " + d.toLocaleTimeString(undefined, {
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  private requireEl(id: string): HTMLElement {
    const el = document.getElementById(id);
    if (!el) throw new Error(`MainMenuScreen: missing element #${id}`);
    return el;
  }
}
