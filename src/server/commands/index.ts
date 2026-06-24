/**
 * commands/index.ts — Command dispatcher
 *
 * Architecture: Commands are only processed for players in "active" state.
 * Pending and character_creation players cannot issue game commands.
 * This guard lives here so individual command files don't need to check it.
 */

import { look } from "./look";
import { say } from "./say";
import { help } from "./help";
import { move } from "./move";
import { townMap } from "./map";
import { getPlayerById } from "../gameState";

export function handleCommand(playerId: string, input: string): string {
  // Guard: only active players can issue commands
  const player = getPlayerById(playerId);
  if (!player || player.state !== "active") {
    return "You are not yet in the world.";
  }

  const trimmed = input.trim();
  if (!trimmed) return "";

  const parts = trimmed.split(" ");
  const command = parts[0]?.toLowerCase();
  const args = parts.slice(1);

  if (!command) return "No command entered.";

  switch (command) {
    case "look":
      return look(playerId);

    case "say":
      return say(playerId, args);

    case "help":
      return help();

    case "map":
      return townMap(playerId);

    case "north":
    case "south":
    case "east":
    case "west":
    case "up":
    case "down":
      return move(playerId, command);

    default:
      return `Unknown command: "${command}". Type help for a list of commands.`;
  }
}
