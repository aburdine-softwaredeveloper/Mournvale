/**
 * CharacterPanel.ts — Left-panel content for the character/skills screen.
 *
 * Repurposes the LOCATION column while the skills screen is open: shows core
 * progression (level, XP, unspent points), ability scores, and an editable
 * background/notes area. Mirrors PartyPanel/CommandMenu: constructed with a
 * container id, re-rendered from a server view via update().
 *
 * The editable background is intentionally CLIENT-LOCAL — it is persisted to
 * localStorage keyed by character name and never sent to the server, matching
 * the feature spec (progression is authoritative server-side; flavor text is not).
 */

import type { SkillScreenView } from "../../types/network";

const ABILITY_LABELS: Record<string, string> = {
  str: "STR", dex: "DEX", con: "CON", int: "INT", wis: "WIS", cha: "CHA",
};

function bgStorageKey(characterName: string): string {
  return `mournvale.background.${characterName}`;
}

export class CharacterPanel {
  private readonly container: HTMLElement;
  /** Invoked when the player clicks Close. */
  private onClose: (() => void) | null = null;
  /** Sends a raw command string (routed to the server). */
  private onCommand: ((command: string) => void) | null = null;

  constructor(containerId: string) {
    const el = document.getElementById(containerId);
    if (!el) throw new Error(`CharacterPanel: missing container #${containerId}`);
    this.container = el;
  }

  public setCloseHandler(handler: () => void): void {
    this.onClose = handler;
  }

  public setCommandHandler(handler: (command: string) => void): void {
    this.onCommand = handler;
  }

  public update(view: SkillScreenView): void {
    this.container.innerHTML = "";

    // ── Header: title + close ──
    const header = document.createElement("div");
    header.className = "skill-header";
    const title = document.createElement("span");
    title.className = "panel-title";
    title.textContent = "◆ CHARACTER";
    const close = document.createElement("button");
    close.className = "skill-close-btn";
    close.textContent = "✕";
    close.setAttribute("aria-label", "Close character screen");
    close.title = "Close character screen";
    close.addEventListener("click", () => this.onClose?.());
    header.append(title, close);
    this.container.appendChild(header);

    // ── Identity ──
    const identity = document.createElement("div");
    identity.className = "char-identity";
    identity.textContent = `${view.characterName} — ${view.characterClass} · Lv ${view.level}`;
    this.container.appendChild(identity);

    // ── XP bar ──
    const xpTotalForRow = view.xp + view.xpToNext;
    const pct = xpTotalForRow > 0 ? Math.round((view.xp / xpTotalForRow) * 100) : 100;
    const xpWrap = document.createElement("div");
    xpWrap.className = "char-xp";
    const xpBar = document.createElement("div");
    xpBar.className = "char-xp-bar";
    const xpFill = document.createElement("div");
    xpFill.className = "char-xp-fill";
    xpFill.style.width = `${view.xpToNext === 0 ? 100 : pct}%`;
    xpBar.appendChild(xpFill);
    const xpLabel = document.createElement("div");
    xpLabel.className = "char-xp-label";
    xpLabel.textContent = view.xpToNext === 0
      ? `XP ${view.xp} — MAX`
      : `XP ${view.xp} · ${view.xpToNext} to next`;
    xpWrap.append(xpBar, xpLabel);
    this.container.appendChild(xpWrap);

    // ── Unspent points ──
    const points = document.createElement("div");
    points.className = "char-points";
    points.innerHTML =
      `<span class="char-point-chip">Skill pts: <b>${view.unspentSkillPoints}</b></span>` +
      `<span class="char-point-chip">Attr pts: <b>${view.unspentAttributePoints}</b></span>`;
    this.container.appendChild(points);

    // ── Ability scores ──
    const divider1 = document.createElement("div");
    divider1.className = "panel-divider";
    this.container.appendChild(divider1);

    const scoresTitle = document.createElement("div");
    scoresTitle.className = "panel-title";
    scoresTitle.textContent = "◆ ABILITY SCORES";
    this.container.appendChild(scoresTitle);

    const canRaise = view.unspentAttributePoints > 0;
    const scores = document.createElement("div");
    scores.className = "char-scores";
    for (const key of Object.keys(ABILITY_LABELS)) {
      const score = view.abilityScores[key as keyof typeof view.abilityScores];
      const mod = Math.floor((score - 10) / 2);
      const cell = document.createElement("div");
      cell.className = "char-score-cell";
      cell.innerHTML =
        `<span class="char-score-name">${ABILITY_LABELS[key]}</span>` +
        `<span class="char-score-val">${score}</span>` +
        `<span class="char-score-mod">${mod >= 0 ? "+" : ""}${mod}</span>`;

      // Spend an attribute point on this stat (only when points are available).
      if (canRaise) {
        const raise = document.createElement("button");
        raise.className = "char-score-raise";
        raise.textContent = "+";
        raise.title = `Raise ${ABILITY_LABELS[key]} (spend 1 attribute point)`;
        raise.addEventListener("click", () => this.onCommand?.(`spend attr ${key}`));
        cell.appendChild(raise);
      }
      scores.appendChild(cell);
    }
    this.container.appendChild(scores);

    // ── Editable background (client-local) ──
    const divider2 = document.createElement("div");
    divider2.className = "panel-divider";
    this.container.appendChild(divider2);

    const bgTitle = document.createElement("div");
    bgTitle.className = "panel-title";
    bgTitle.textContent = "◆ BACKGROUND & NOTES";
    this.container.appendChild(bgTitle);

    const bg = document.createElement("textarea");
    bg.className = "char-background";
    bg.placeholder = "Jot your backstory, notes, or goals…";
    bg.value = this.loadBackground(view.characterName);
    bg.addEventListener("input", () => this.saveBackground(view.characterName, bg.value));
    this.container.appendChild(bg);
  }

  private loadBackground(characterName: string): string {
    try {
      return window.localStorage.getItem(bgStorageKey(characterName)) ?? "";
    } catch {
      return "";
    }
  }

  private saveBackground(characterName: string, text: string): void {
    try {
      window.localStorage.setItem(bgStorageKey(characterName), text);
    } catch {
      /* storage unavailable — notes simply won't persist */
    }
  }
}
