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
 *   This is a pure view. It reports leave and invite intents via callbacks
 *   and never touches the socket.
 *
 * Invite:
 *   The "INVITE" button replaces the old `invite`/`party` text commands.
 *   It is always visible (even when solo, so a player can start a party).
 *   Clicking it reveals an inline name field; submitting fires onInvite.
 */

import type { PartyView, PartyMemberView } from "../../types/party";

export class PartyPanel {
  /** The mount point from index.html (#party-panel-container). */
  private readonly root: HTMLElement;

  /** Callback fired when the player clicks LEAVE PARTY. */
  private onLeave: (() => void) | null = null;

  /** Callback fired with the target name when an invite is submitted. */
  private onInvite: ((name: string) => void) | null = null;

  /** Callback fired with a member's playerId when their card is clicked. */
  private onMemberView: ((playerId: string) => void) | null = null;

  constructor() {
    this.root = this.requireEl("party-panel-container");
    // Solo players still see the INVITE control beneath ◆ PARTY.
    this.update(null);
  }

  // ─────────────────────────────────────────────
  // PUBLIC API  (matches GameScreen / app.ts usage)
  // ─────────────────────────────────────────────

  /** Registers the handler invoked when LEAVE PARTY is clicked. */
  public setLeaveHandler(handler: () => void): void {
    this.onLeave = handler;
  }

  /** Registers the handler invoked when an invite name is submitted. */
  public setInviteHandler(handler: (name: string) => void): void {
    this.onInvite = handler;
  }

  /** Registers the handler invoked when a member card is clicked (view sheet). */
  public setMemberViewHandler(handler: (playerId: string) => void): void {
    this.onMemberView = handler;
  }

  /**
   * Re-renders the roster.
   *   - null, or a party of one  → just the INVITE control (solo).
   *   - 2+ members               → a card per member, Leave + Invite buttons.
   */
  public update(party: PartyView | null): void {
    this.root.innerHTML = "";

    // Solo: PartyManager disbands a party of one, and the server sends
    // null in that case — treat both as "no party".
    const inParty = !!party && party.members.length > 1;

    if (inParty) {
      for (const member of party!.members) {
        this.root.appendChild(this.buildMemberCard(member));
      }
      this.root.appendChild(this.buildLeaveButton());
    }

    // The invite control sits underneath the roster (or alone when solo).
    this.root.appendChild(this.buildInviteControl());
  }

  // ─────────────────────────────────────────────
  // RENDERING
  // ─────────────────────────────────────────────

  private buildMemberCard(member: PartyMemberView): HTMLElement {
    const card = document.createElement("div");
    card.className = "party-member-card party-member-clickable";
    card.title = `View ${member.name}'s character sheet`;
    // Clicking a companion opens their character sheet (read-only).
    card.addEventListener("click", () => this.onMemberView?.(member.playerId));

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

  /**
   * Builds the INVITE control: a toggle button that reveals an inline
   * name field. Submitting (SEND or Enter) fires onInvite and resets.
   * Replaces the removed `invite <name>` text command.
   */
  private buildInviteControl(): HTMLElement {
    const wrap = document.createElement("div");
    wrap.className = "party-invite";

    const toggle = document.createElement("button");
    toggle.className = "snes-btn party-invite-toggle";
    toggle.textContent = "✦ INVITE";

    const form = document.createElement("div");
    form.className = "party-invite-form hidden";

    const input = document.createElement("input");
    input.type = "text";
    input.className = "party-invite-input";
    input.placeholder = "Player name…";

    const send = document.createElement("button");
    send.className = "snes-btn party-invite-send";
    send.textContent = "SEND";

    const submit = () => {
      const name = input.value.trim();
      if (!name) return;
      this.onInvite?.(name);
      input.value = "";
      form.classList.add("hidden");
    };

    toggle.addEventListener("click", () => {
      const opening = form.classList.contains("hidden");
      form.classList.toggle("hidden");
      if (opening) input.focus();
    });
    send.addEventListener("click", submit);
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") { e.preventDefault(); submit(); }
    });

    form.appendChild(input);
    form.appendChild(send);
    wrap.appendChild(toggle);
    wrap.appendChild(form);
    return wrap;
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
