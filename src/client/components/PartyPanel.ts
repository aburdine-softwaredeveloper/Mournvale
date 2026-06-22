/**
 * PartyPanel.ts — The PARTY roster shown beneath the HERE: section
 *
 * Design:
 *   This panel renders directly under the "◆ PARTY" title in the left
 *   game panel. It shows one card per party member when a party exists,
 *   and renders NOTHING when the player is solo (party === null, or a
 *   party that has collapsed to a single member). The "◆ PARTY" header
 *   itself lives in index.html and is always visible; only the content
 *   below it appears/disappears.
 *
 * Resilience:
 *   The panel mounts into the single container #party-panel-container and
 *   builds every child element itself. It does NOT depend on any
 *   hand-authored child nodes in index.html, so the HTML and this
 *   component can't drift out of sync (which is what caused the original
 *   "missing element #party-roster" crash).
 *
 * Data:
 *   PartyMemberView currently carries name / characterClass / isLeader.
 *   The stylesheet also defines richer card styles (HP bars, stats,
 *   status tags) for a future expanded PartyMemberView — those simply
 *   stay dormant until that data is added to the type.
 *
 * Networking:
 *   This is a pure view + the Leave button. It reports the leave intent
 *   via a callback and never touches the socket.
 */

import type { PartyView, PartyMemberView } from "../../types/party";

export class PartyPanel {
  /** The mount point from index.html (#party-panel-container). */
  private readonly root: HTMLElement;

  /** Callback fired when the player clicks LEAVE PARTY. */
  private onLeave: (() => void) | null = null;

  constructor() {
    this.root = this.requireEl("party-panel-container");
    // Start blank — a solo player sees an empty section beneath ◆ PARTY.
    this.root.innerHTML = "";
  }

  // ─────────────────────────────────────────────
  // PUBLIC API  (matches GameScreen / app.ts usage)
  // ─────────────────────────────────────────────

  /** Registers the handler invoked when LEAVE PARTY is clicked. */
  public setLeaveHandler(handler: () => void): void {
    this.onLeave = handler;
  }

  /**
   * Re-renders the roster.
   *   - null, or a party of one  → render nothing (solo).
   *   - 2+ members               → render a card per member + Leave button.
   */
  public update(party: PartyView | null): void {
    this.root.innerHTML = "";

    // Solo: PartyManager disbands a party of one, and the server sends
    // null in that case — treat both as "no party".
    if (!party || party.members.length <= 1) {
      return;
    }

    for (const member of party.members) {
      this.root.appendChild(this.buildMemberCard(member));
    }

    this.root.appendChild(this.buildLeaveButton());
  }

  // ─────────────────────────────────────────────
  // RENDERING
  // ─────────────────────────────────────────────

  private buildMemberCard(member: PartyMemberView): HTMLElement {
    const card = document.createElement("div");
    card.className = "party-member-card";

    const header = document.createElement("div");
    header.className = "party-member-header";

    const name = document.createElement("span");
    name.className = "party-member-name";
    name.textContent = member.isLeader ? `★ ${member.name}` : member.name;
    if (member.isLeader) name.classList.add("party-member-leader");

    const cls = document.createElement("span");
    cls.className = "party-member-class";
    cls.textContent = member.characterClass;

    header.appendChild(name);
    header.appendChild(cls);
    card.appendChild(header);

    return card;
  }

  private buildLeaveButton(): HTMLElement {
    const btn = document.createElement("button");
    btn.className = "snes-btn party-leave";
    btn.textContent = "LEAVE PARTY";
    btn.addEventListener("click", () => this.onLeave?.());
    return btn;
  }

  // ─────────────────────────────────────────────
  // HELPERS
  // ─────────────────────────────────────────────

  private requireEl(id: string): HTMLElement {
    const el = document.getElementById(id);
    if (!el) throw new Error(`PartyPanel: missing element #${id}`);
    return el;
  }
}
