import { getPlayerById, players } from "../gameState";
import { broadcastToRoom } from "../roomUtils";

export function say(playerId: string, args: string[]): string {
  const player = getPlayerById(playerId);

  if (!player) return "Player not found.";

  const message = args.join(" ");

  if (!message) return "Say what?";

  broadcastToRoom(
    player.roomId,
    `💬 ${player.name}: ${message}`,
    player.id
  );

  return `💬 You say: ${message}`;
}