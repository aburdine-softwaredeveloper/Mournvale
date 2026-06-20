/**
 * GameScreen.ts — The main game interface for active players
 *
 * Responsibilities:
 *   - Render the room panel (name, description, exits, occupants)
 *   - Append messages to the scrolling log (system/chat/presence/error)
 *   - Host the CommandMenu (clickable command buttons)
 *   - Handle the text input for custom/typed commands
 *
 * All outgoing commands flow through a single onCommand callback that
 * the app forwards to the server as `command` messages.
 *
 * Architecture: GameScreen owns presentation only. It never talks to
 * the socket directly — the app injects the send callback.
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

export type LogKind = "system" | "chat" | "error" | "presence" | "default";

export class GameScreen {
  private readonly headerName: HTMLElement;
  private readonly headerClass: HTMLElement;
  private readonly roomName: HTMLElement;
  private readonly roomDesc: HTMLElement;
  private readonly roomExits: HTMLElement;
  private readonly roomPlayers: HTMLElement;
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

  constructor() {
    this.headerName = this.requireEl("player-name-display");
    this.headerClass = this.requireEl("player-class-display");
    this.roomName = this.requireEl("room-name");
    this.roomDesc = this.requireEl("room-description");
    this.roomExits = this.requireEl("room-exits");
    this.roomPlayers = this.requireEl("room-players");
    this.messageLog = this.requireEl("message-log");
    this.commandInput = this.requireEl("command-input") as HTMLInputElement;
    this.commandSend = this.requireEl("command-send") as HTMLButtonElement;
    this.headerPortrait = this.requireEl("header-portrait");
    this.roomImage = this.requireEl("room-image");

    this.commandMenu = new CommandMenu("command-buttons");
    this.partyPanel = new PartyPanel();
    this.wireInput();
  }

  /** Registers the leave-party handler on the party panel. */
  public setPartyLeaveHandler(handler: () => void): void {
    this.partyPanel.setLeaveHandler(handler);
  }

  /** Updates the party roster (or hides it when null). */
  public updateParty(party: PartyView | null): void {
    this.partyPanel.update(party);
  }

  /**
   * Initializes the screen with the player's identity, portrait, and
   * command set.
   * @param portraitSpec the visual fields used to composite the portrait
   * @param onCommand    callback invoked with every command string to send
   */
  public init(
    playerName: string,
    playerClass: string,
    portraitSpec: PortraitSpec | null,
    onCommand: (input: string) => void
  ): void {
    this.onCommand = onCommand;
    this.headerName.textContent = playerName;
    this.headerClass.textContent = playerClass.toUpperCase();

    // Render the header portrait from the player's appearance
    if (portraitSpec) {
      this.headerPortrait.innerHTML = portraitCompositor.compose(portraitSpec);
    }

    this.commandMenu.render(
      DEFAULT_COMMANDS,
      // Direct command (no argument) → send immediately
      (command) => this.send(command),
      // Argument-requiring command → focus input with prefix
      (prefix) => this.focusInputWith(prefix)
    );
  }

  /** Updates the room panel and image from a RoomMessage */
  public updateRoom(msg: RoomMessage): void {
    const { name, description, exits, players, artKey } = msg.payload;

    this.roomName.textContent = name;
    this.roomDesc.textContent = description;
    this.roomExits.textContent =
      exits.length > 0 ? `Exits: ${exits.join(", ")}` : "Exits: none";

    this.roomPlayers.textContent =
      players.length > 0 ? `Present: ${players.join(", ")}` : "You are alone.";

    this.updateRoomImage(artKey);
  }

  /**
   * Loads and displays the room's scene art. Skips the fetch if the art
   * key hasn't changed since the last update. Shows a placeholder when a
   * room has no art.
   */
  private updateRoomImage(artKey: string | undefined): void {
    if (artKey === this.currentArtKey) return;
    this.currentArtKey = artKey ?? null;

    if (!artKey) {
      this.roomImage.innerHTML =
        '<div class="room-image-empty">— no view —</div>';
      return;
    }

    const key = `tiles/${artKey}` as const;
    const cached = assetRegistry.get(key);

    if (cached) {
      this.roomImage.innerHTML = cached;
      return;
    }

    void assetRegistry
      .load(key)
      .then((svg) => {
        // Guard against a newer room having loaded while we awaited
        if (this.currentArtKey === artKey) {
          this.roomImage.innerHTML = svg;
        }
      })
      .catch(() => {
        if (this.currentArtKey === artKey) {
          this.roomImage.innerHTML =
            '<div class="room-image-empty">— no view —</div>';
        }
      });
  }

  /** Appends a line to the message log and scrolls to the bottom */
  public log(text: string, kind: LogKind = "default"): void {
    const entry = document.createElement("div");
    entry.className = `log-entry log-${kind}`;
    entry.textContent = text;
    this.messageLog.appendChild(entry);
    this.messageLog.scrollTop = this.messageLog.scrollHeight;
  }

  /** Wires the text input (Enter key + Send button) */
  private wireInput(): void {
    const submit = () => {
      const value = this.commandInput.value.trim();
      if (!value) return;
      this.send(value);
      this.commandInput.value = "";
    };

    this.commandSend.addEventListener("click", submit);
    this.commandInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        submit();
      }
    });
  }

  /** Focuses the input with a command prefix pre-filled (e.g. "say ") */
  private focusInputWith(prefix: string): void {
    this.commandInput.value = `${prefix} `;
    this.commandInput.focus();
    // Move cursor to end
    const len = this.commandInput.value.length;
    this.commandInput.setSelectionRange(len, len);
  }

  /** Sends a command via the injected callback */
  private send(input: string): void {
    this.onCommand?.(input);
  }

  private requireEl(id: string): HTMLElement {
    const el = document.getElementById(id);
    if (!el) throw new Error(`GameScreen: missing element #${id}`);
    return el;
  }
}
