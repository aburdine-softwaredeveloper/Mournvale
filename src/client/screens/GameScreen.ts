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
import type { RoomMessage } from "../../types/network";

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

  private readonly commandMenu: CommandMenu;
  private onCommand: ((input: string) => void) | null = null;

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

    this.commandMenu = new CommandMenu("command-buttons");
    this.wireInput();
  }

  /**
   * Initializes the screen with the player's identity and command set.
   * @param onCommand callback invoked with every command string to send
   */
  public init(
    playerName: string,
    playerClass: string,
    onCommand: (input: string) => void
  ): void {
    this.onCommand = onCommand;
    this.headerName.textContent = playerName;
    this.headerClass.textContent = playerClass.toUpperCase();

    this.commandMenu.render(
      DEFAULT_COMMANDS,
      // Direct command (no argument) → send immediately
      (command) => this.send(command),
      // Argument-requiring command → focus input with prefix
      (prefix) => this.focusInputWith(prefix)
    );
  }

  /** Updates the room panel from a RoomMessage */
  public updateRoom(msg: RoomMessage): void {
    const { name, description, exits, players } = msg.payload;

    this.roomName.textContent = name;
    this.roomDesc.textContent = description;
    this.roomExits.textContent = exits.length > 0 ? exits.join(", ") : "none";

    this.roomPlayers.textContent =
      players.length > 0 ? players.join("\n") : "You are alone.";
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
