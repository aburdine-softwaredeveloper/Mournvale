/**
 * QuestBoard.ts — The quest board overlay
 *
 * Renders available quests as cards (accept button each) and the player's
 * active quest (abandon button). Opened/closed by the app. Pure view +
 * input collector; the app injects accept/abandon callbacks and feeds it
 * QuestBoardView snapshots.
 */

import type { QuestBoardView, Quest, ActiveQuest } from "../../types/quest";

export class QuestBoard {
  private readonly overlay: HTMLElement;
  private readonly listEl: HTMLElement;
  private readonly activeEl: HTMLElement;
  private readonly closeBtn: HTMLButtonElement;

  private onAccept: ((questId: string) => void) | null = null;
  private onAbandon: (() => void) | null = null;
  private onClose: (() => void) | null = null;

  constructor() {
    this.overlay = this.requireEl("quest-overlay");
    this.listEl = this.requireEl("quest-list");
    this.activeEl = this.requireEl("quest-active");
    this.closeBtn = this.requireEl("quest-close-btn") as HTMLButtonElement;

    this.closeBtn.addEventListener("click", () => {
      this.hide();
      this.onClose?.();
    });
  }

  /** Registers callbacks for accept/abandon/close. */
  public setHandlers(handlers: {
    onAccept: (questId: string) => void;
    onAbandon: () => void;
    onClose: () => void;
  }): void {
    this.onAccept = handlers.onAccept;
    this.onAbandon = handlers.onAbandon;
    this.onClose = handlers.onClose;
  }

  public show(): void {
    this.overlay.classList.remove("hidden");
  }

  public hide(): void {
    this.overlay.classList.add("hidden");
  }

  public isOpen(): boolean {
    return !this.overlay.classList.contains("hidden");
  }

  /** Renders the board from a snapshot. */
  public render(view: QuestBoardView): void {
    this.renderActive(view.active);
    this.renderAvailable(view.available, view.active !== null);
  }

  /** Renders the active-quest banner (or hides it). */
  private renderActive(active: ActiveQuest | null): void {
    if (!active) {
      this.activeEl.classList.add("hidden");
      this.activeEl.innerHTML = "";
      return;
    }

    this.activeEl.innerHTML = "";

    const label = document.createElement("div");
    label.className = "quest-active-label";
    label.textContent = active.partyId ? "ACTIVE (PARTY)" : "ACTIVE";
    this.activeEl.appendChild(label);

    const title = document.createElement("div");
    title.className = "quest-card-title";
    title.textContent = active.quest.title;
    this.activeEl.appendChild(title);

    const desc = document.createElement("div");
    desc.className = "quest-card-desc";
    desc.textContent = active.quest.description;
    this.activeEl.appendChild(desc);

    const abandon = document.createElement("button");
    abandon.className = "snes-btn";
    abandon.textContent = "ABANDON";
    abandon.addEventListener("click", () => this.onAbandon?.());
    this.activeEl.appendChild(abandon);

    this.activeEl.classList.remove("hidden");
  }

  /** Renders the available quest cards. */
  private renderAvailable(quests: Quest[], hasActive: boolean): void {
    this.listEl.innerHTML = "";

    if (quests.length === 0) {
      const empty = document.createElement("div");
      empty.className = "quest-card-desc";
      empty.textContent = "The board is empty. Check back later.";
      this.listEl.appendChild(empty);
      return;
    }

    for (const quest of quests) {
      this.listEl.appendChild(this.buildCard(quest, hasActive));
    }
  }

  /** Builds a single quest card element. */
  private buildCard(quest: Quest, hasActive: boolean): HTMLElement {
    const card = document.createElement("div");
    card.className = "quest-card";

    const title = document.createElement("div");
    title.className = "quest-card-title";
    title.textContent = quest.title;
    card.appendChild(title);

    const desc = document.createElement("div");
    desc.className = "quest-card-desc";
    desc.textContent = quest.description;
    card.appendChild(desc);

    // Meta row: giver, difficulty, participation, recommended size
    const meta = document.createElement("div");
    meta.className = "quest-card-meta";
    meta.appendChild(this.tag(`From: ${quest.giver}`));
    meta.appendChild(this.tag(quest.difficulty));
    meta.appendChild(
      this.tag(
        quest.participation === "party"
          ? "PARTY"
          : quest.participation === "solo"
          ? "SOLO"
          : "SOLO/PARTY",
        quest.participation
      )
    );
    meta.appendChild(this.tag(`Rec. ${quest.recommendedSize}`));
    card.appendChild(meta);

    // Reward line
    const reward = document.createElement("div");
    reward.className = "quest-card-reward";
    reward.textContent =
      `Reward: ${quest.reward.gold}g · ${quest.reward.xp}xp` +
      (quest.reward.item ? ` · ${quest.reward.item}` : "");
    card.appendChild(reward);

    // Accept button — disabled if the player already has an active quest
    const accept = document.createElement("button");
    accept.className = "snes-btn";
    accept.textContent = "ACCEPT";
    accept.disabled = hasActive;
    if (hasActive) accept.classList.add("btn-disabled");
    accept.addEventListener("click", () => {
      if (!hasActive) this.onAccept?.(quest.id);
    });
    card.appendChild(accept);

    return card;
  }

  /** Builds a small meta tag span. */
  private tag(text: string, participation?: string): HTMLElement {
    const span = document.createElement("span");
    span.className = "quest-tag";
    if (participation === "party") span.classList.add("quest-tag-party");
    if (participation === "solo") span.classList.add("quest-tag-solo");
    span.textContent = text;
    return span;
  }

  private requireEl(id: string): HTMLElement {
    const el = document.getElementById(id);
    if (!el) throw new Error(`QuestBoard: missing element #${id}`);
    return el;
  }
}
