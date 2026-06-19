/**
 * help.ts — Returns the list of available commands
 */

export function help(): string {
  return [
    "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
    "  COMMANDS",
    "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
    "  look            — describe your surroundings",
    "  say <message>   — speak to others in the room",
    "  north / south   — move in a direction",
    "  east / west     — move in a direction",
    "  help            — show this list",
    "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
  ].join("\n");
}
