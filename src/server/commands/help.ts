/**
 * help.ts — Returns the list of available commands
 */

export function help(): string {
  return [
    "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
    "  COMMANDS",
    "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
    "  look              — describe your surroundings",
    "  map               — show the town map",
    "  say <message>     — speak to everyone in the room",
    "  say <name> <...>  — talk TO someone here (an NPC will reply)",
    "  persuade/intimidate/inquire/deceive <name> <...>",
    "                    — talk to an NPC with a chosen approach",
    "  north / south     — move in a direction",
    "  east / west       — move in a direction",
    "  up / down         — use a vertical exit, when present",
    "  fight <name>      — attack a hostile here",
    "  skills            — open your character screen",
    "  invite <name>     — invite someone to your party",
    "  party             — show your party",
    "  leave             — leave your party",
    "  quests            — read the quest board",
    "  help              — show this list",
    "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━",
  ].join("\n");
}
