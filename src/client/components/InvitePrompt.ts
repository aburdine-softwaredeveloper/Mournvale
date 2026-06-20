/**
 * InvitePrompt.ts — Party invitation prompt overlay
 *
 * Shown when a party_invite arrives. Displays who invited the player and
 * offers Accept / Decline. Reports the choice via a callback. Pure view.
 */

import type { PartyInviteView } from "../../types/party";

export class InvitePrompt {
  private readonly overlay: HTMLElement;
  private readonly textEl: HTMLElement;
  private readonly acceptBtn: HTMLButtonElement;
  private readonly declineBtn: HTMLButtonElement;

  private current: PartyInviteView | null = null;
  private onRespond:
    | ((invite: PartyInviteView, accept: boolean) => void)
    | null = null;

  constructor() {
    this.overlay = this.requireEl("invite-overlay");
    this.textEl = this.requireEl("invite-text");
    this.acceptBtn = this.requireEl("invite-accept-btn") as HTMLButtonElement;
    this.declineBtn = this.requireEl("invite-decline-btn") as HTMLButtonElement;

    this.acceptBtn.addEventListener("click", () => this.respond(true));
    this.declineBtn.addEventListener("click", () => this.respond(false));
  }

  /** Registers the response callback. */
  public setRespondHandler(
    handler: (invite: PartyInviteView, accept: boolean) => void
  ): void {
    this.onRespond = handler;
  }

  /** Shows the prompt for an incoming invite. */
  public show(invite: PartyInviteView): void {
    this.current = invite;
    this.textEl.textContent = `${invite.fromName} invites you to join their party.`;
    this.overlay.classList.remove("hidden");
  }

  public hide(): void {
    this.overlay.classList.add("hidden");
    this.current = null;
  }

  private respond(accept: boolean): void {
    if (this.current) {
      this.onRespond?.(this.current, accept);
    }
    this.hide();
  }

  private requireEl(id: string): HTMLElement {
    const el = document.getElementById(id);
    if (!el) throw new Error(`InvitePrompt: missing element #${id}`);
    return el;
  }
}
