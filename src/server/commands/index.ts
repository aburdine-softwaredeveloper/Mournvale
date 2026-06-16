import { look } from "./look";
import { say } from "./say";
import { help } from "./help";
import { move } from "./move";

export function handleCommand(playerId: string, input: string): string {
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

    case "north":
    case "south":
    case "east":
    case "west":
      return move(playerId, command);

    default:
      return "Unknown command. Try 'help'.";
  }
}