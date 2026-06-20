/**
 * PartyPanel.ts — Renders the party roster in the game screen
 *
 * Shows the current party members (leader marked), and a Leave button.
 * Hidden when the player is not in a party. Pure view + input collector;
 * the app injects the leave callback and feeds it PartyView snapshots.
 */

import type { PartyView } from "../../types/party";

export class PartyPanel {
  private readonly roster: HTMLElement;
  private readonly membersEl: HTMLElement;
  private readonly leaveBtn: HTMLButtonElement;

  private onLeave: (() => void) | null = null;

  constructor() {
    this.roster = this.requireEl("party-roster");
    this.membersEl = this.requireEl("party-members");
    this.leaveBtn = this.requireEl("party-leave-btn") as HTMLButtonElement;

    this.leaveBtn.addEventListener("click", () => this.onLeave?.());
  }

  /** Registers the leave-party callback. */
  public setLeaveHandler(handler: () => void): void {
    this.onLeave = handler;
  }

  /**
   * Updates the roster from a PartyView, or hides it when party is null
   * (player left or party disbanded).
   */
  public update(party: PartyView | null): void {
    if (!party || party.members.length === 0) {
      this.roster.classList.add("hidden");
      this.membersEl.textContent = "";
      return;
    }

    this.membersEl.innerHTML = "";
    for (const member of party.members) {
      const line = document.createElement("div");
      line.textContent = member.isLeader
        ? `★ ${member.name} — ${member.characterClass}`
        : `  ${member.name} — ${member.characterClass}`;
      if (member.isLeader) line.className = "party-member-leader";
      this.membersEl.appendChild(line);
    }

    this.roster.classList.remove("hidden");
  }

  private requireEl(id: string): HTMLElement {
    const el = document.getElementById(id);
    if (!el) throw new Error(`PartyPanel: missing element #${id}`);
    return el;
  }
}
