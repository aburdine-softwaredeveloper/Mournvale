/**
 * CommandMenu.ts — Clickable command buttons for the game screen
 *
 * Renders a button per available command so players can click instead
 * of typing. Each button also has a single-key shortcut shown in
 * brackets. Clicking (or pressing the shortcut) invokes onCommand with
 * the full command string.
 *
 * Architecture: The command list is data-driven — pass in definitions
 * and the menu renders itself. The "say" command is special-cased to
 * focus the text input rather than sending immediately, since it needs
 * an argument.
 */

export interface CommandDefinition {
  /** The command sent to the server, e.g. "look" or "north" */
  command: string;
  /** Button label, e.g. "Look" */
  label: string;
  /** Single-char keyboard shortcut, e.g. "l" */
  shortcut?: string;
  /**
   * If true, clicking focuses the input with this command pre-filled
   * instead of sending immediately (for commands needing arguments).
   */
  needsArgument?: boolean;
}

/** The default command set for an active player */
export const DEFAULT_COMMANDS: CommandDefinition[] = [
  { command: "look",  label: "Look",  shortcut: "l" },
  { command: "north", label: "North", shortcut: "w" },
  { command: "south", label: "South", shortcut: "s" },
  { command: "east",  label: "East",  shortcut: "d" },
  { command: "west",  label: "West",  shortcut: "a" },
  { command: "say",   label: "Say",   shortcut: "t", needsArgument: true },
  { command: "talk",  label: "Talk",  shortcut: "k", needsArgument: true },
  { command: "invite", label: "Invite", shortcut: "i", needsArgument: true },
  { command: "party", label: "Party", shortcut: "p" },
  { command: "quests", label: "Quests", shortcut: "q" },
  { command: "help",  label: "Help",  shortcut: "h" },
];

export class CommandMenu {
  private readonly container: HTMLElement;
  private definitions: CommandDefinition[] = [];

  /** Called when a command should be sent directly */
  private onCommand: ((command: string) => void) | null = null;

  /** Called when a command needs an argument (focus the input) */
  private onNeedsArgument: ((commandPrefix: string) => void) | null = null;

  private readonly boundKey = (e: KeyboardEvent) => this.handleShortcut(e);
  private listening = false;

  constructor(containerId: string) {
    const el = document.getElementById(containerId);
    if (!el) throw new Error(`CommandMenu: missing container #${containerId}`);
    this.container = el;
  }

  /**
   * Renders the menu and wires callbacks.
   * @param definitions      command list to render
   * @param onCommand        invoked when a no-argument command is chosen
   * @param onNeedsArgument  invoked when an argument-requiring command is chosen
   */
  public render(
    definitions: CommandDefinition[],
    onCommand: (command: string) => void,
    onNeedsArgument: (commandPrefix: string) => void
  ): void {
    this.definitions = definitions;
    this.onCommand = onCommand;
    this.onNeedsArgument = onNeedsArgument;

    this.container.innerHTML = "";

    for (const def of definitions) {
      const btn = document.createElement("button");
      btn.className = "cmd-btn";
      btn.type = "button";
      btn.textContent = def.shortcut
        ? `${def.label} [${def.shortcut.toUpperCase()}]`
        : def.label;
      btn.addEventListener("click", () => this.invoke(def));
      this.container.appendChild(btn);
    }

    this.attachKeyListener();
  }

  /** Invokes a command definition — sends or requests argument */
  private invoke(def: CommandDefinition): void {
    if (def.needsArgument) {
      this.onNeedsArgument?.(def.command);
    } else {
      this.onCommand?.(def.command);
    }
  }

  /**
   * Handles keyboard shortcuts — but only when the player is NOT
   * typing in an input field (otherwise typing "say" would trigger
   * the south/east/etc shortcuts).
   */
  private handleShortcut(e: KeyboardEvent): void {
    const target = e.target as HTMLElement;
    if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA")) {
      return;
    }

    const key = e.key.toLowerCase();
    const def = this.definitions.find((d) => d.shortcut === key);
    if (def) {
      e.preventDefault();
      this.invoke(def);
    }
  }

  private attachKeyListener(): void {
    if (this.listening) return;
    this.listening = true;
    window.addEventListener("keydown", this.boundKey);
  }

  public destroy(): void {
    if (!this.listening) return;
    this.listening = false;
    window.removeEventListener("keydown", this.boundKey);
  }
}
