import { players } from "../gameState";

export function say(playerId: string, args: string[]): string {
  const player = players[playerId];
  if (!player) return "Player not found.";

  const message = args.join(" ");
  if (!message) return "Say what?";

  return `💬 ${player.name} says: ${message}`;
}