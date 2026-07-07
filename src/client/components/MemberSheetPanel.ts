/**
 * MemberSheetPanel.ts — Read-only character sheet for a fellow party member.
 *
 * Opened by clicking a member card in the PARTY roster. Renders the server's
 * party_member_sheet payload (the same SkillScreenView the skills screen uses,
 * plus a gear summary) as a spellbook-page card — name, class, level, ability
 * scores, and equipped abilities. Strictly a view: no spend/equip controls,
 * so a player can size up a companion but never edit them.
 *
 * Self-contained like InventoryPanel/SettingsPanel: builds its own DOM +
 * styles and appends to <body>; no markup needed in index.html.
 */

import type { SkillScreenView } from "../../types/network";

export class MemberSheetPanel {
  private readonly overlay: HTMLElement;

  private readonly boundKey = (e: KeyboardEvent): void => {
    if (e.key === "Escape") this.hide();
  };

  constructor() {
    this.injectStyles();
    this.overlay = document.createElement("div");
    this.overlay.id = "msheet-overlay";
    this.overlay.style.display = "none";
    document.body.appendChild(this.overlay);

    // Click the dim backdrop (outside the card) to close.
    this.overlay.addEventListener("click", (e) => {
      if (e.target === this.overlay) this.hide();
    });
  }

  public show(sheet: SkillScreenView, gearSummary: string): void {
    this.overlay.innerHTML = this.buildCard(sheet, gearSummary);
    this.overlay.querySelector("#msheet-close")?.addEventListener("click", () => this.hide());
    this.overlay.style.display = "flex";
    document.addEventListener("keydown", this.boundKey);
  }

  public hide(): void {
    this.overlay.style.display = "none";
    document.removeEventListener("keydown", this.boundKey);
  }

  public isOpen(): boolean {
    return this.overlay.style.display !== "none";
  }

  private buildCard(sheet: SkillScreenView, gearSummary: string): string {
    const scores = Object.entries(sheet.abilityScores)
      .map(([stat, value]) => `
        <div class="msheet-score">
          <span class="msheet-score-name">${this.esc(stat).toUpperCase()}</span>
          <span class="msheet-score-val">${value}</span>
        </div>`)
      .join("");

    const equipped = sheet.knownAbilities.filter((a) => a.equipped);
    const abilities = equipped.length
      ? equipped
          .map((a) => `
            <div class="msheet-ability">
              <span class="msheet-ability-name">${this.esc(a.name)}</span>
              <span class="msheet-ability-desc">${this.esc(a.description)}</span>
            </div>`)
          .join("")
      : `<div class="msheet-empty">No abilities slotted.</div>`;

    const xpLine = sheet.xpToNext > 0
      ? `${sheet.xp} XP — ${sheet.xpToNext} to next level`
      : `${sheet.xp} XP — max level`;

    return `
      <div id="msheet-card">
        <div class="msheet-head">
          <div>
            <div class="msheet-name">${this.esc(sheet.characterName)}</div>
            <div class="msheet-sub">Level ${sheet.level} ${this.esc(sheet.characterClass)} · ${xpLine}</div>
          </div>
          <button id="msheet-close" class="msheet-close" type="button">✕</button>
        </div>
        <div class="msheet-section-title">Ability Scores</div>
        <div class="msheet-scores">${scores}</div>
        <div class="msheet-section-title">Gear</div>
        <div class="msheet-gear">${this.esc(gearSummary)}</div>
        <div class="msheet-section-title">Slotted Abilities</div>
        <div class="msheet-abilities">${abilities}</div>
        <div class="msheet-footnote">A companion's sheet — yours to read, theirs to write.</div>
      </div>`;
  }

  private esc(s: string): string {
    const div = document.createElement("div");
    div.textContent = s;
    return div.innerHTML;
  }

  private injectStyles(): void {
    if (document.getElementById("mournvale-msheet-styles")) return;
    const s = document.createElement("style");
    s.id = "mournvale-msheet-styles";
    s.textContent = `
      #msheet-overlay { position:fixed; inset:0; z-index:260;
        background:rgba(16,11,6,.7); display:flex; align-items:center; justify-content:center;
        padding:16px; }
      #msheet-card { width:min(460px, 94vw); max-height:88dvh; overflow-y:auto;
        padding:18px 20px 20px;
        background:
          radial-gradient(ellipse at 28% 18%, rgba(255,255,250,.5), transparent 58%),
          #ece4cf;
        border:2px solid #7a6344; border-radius:6px;
        box-shadow: inset 0 0 22px rgba(95,62,30,.18), 0 10px 30px rgba(0,0,0,.6);
        font-family:'Press Start 2P', monospace; color:#3b2f20; }
      .msheet-head { display:flex; justify-content:space-between; align-items:flex-start;
        gap:10px; margin-bottom:14px; border-bottom:1px solid #c7b994; padding-bottom:10px; }
      .msheet-name { font-size:11px; letter-spacing:2px; color:#5a3a1c; margin-bottom:6px; }
      .msheet-sub { font-size:7px; line-height:1.7; color:#6e5c42; }
      .msheet-close { background:#c8b485; border:2px solid #7a6344; color:#3b2f20;
        font-family:inherit; font-size:9px; padding:6px 9px; cursor:pointer; flex-shrink:0; }
      .msheet-close:hover { background:#bda36f; }
      .msheet-section-title { font-size:8px; letter-spacing:1px; color:#5a3a1c;
        margin:12px 0 6px; border-bottom:1px dotted #c7b994; padding-bottom:4px; }
      .msheet-scores { display:grid; grid-template-columns:repeat(3, 1fr); gap:6px; }
      .msheet-score { display:flex; justify-content:space-between; align-items:center;
        padding:7px 8px; background:#ddd2b6; border:1px solid #c7b994; }
      .msheet-score-name { font-size:7px; color:#6e5c42; }
      .msheet-score-val { font-size:9px; color:#3b2f20; }
      .msheet-gear { font-size:7px; line-height:1.8; color:#5b4a34;
        padding:8px 10px; background:#ddd2b6; border:1px solid #c7b994; }
      .msheet-ability { display:flex; flex-direction:column; gap:4px;
        padding:8px 10px; background:#ddd2b6; border:1px solid #c7b994; margin-bottom:6px; }
      .msheet-ability-name { font-size:8px; color:#3b2f20; }
      .msheet-ability-desc { font-size:7px; line-height:1.7; color:#6e5c42; }
      .msheet-empty { font-size:7px; color:#6e5c42; padding:8px 2px; }
      .msheet-footnote { margin-top:14px; font-size:6px; color:#8a7a5c;
        text-align:center; font-style:italic; }
      @media (max-width: 700px) {
        .msheet-scores { grid-template-columns:repeat(2, 1fr); }
      }
    `;
    document.head.appendChild(s);
  }
}
