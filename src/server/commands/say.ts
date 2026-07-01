/**
 * say.ts — Broadcasts a chat message to the current room
 *
 * Fix from original: broadcastToRoom now receives a structured
 * ChatMessage instead of a raw string.
 */

import { getPlayerById, getDisplayName } from "../gameState";
import { broadcastToRoom } from "../roomUtils";

export function say(playerId: string, args: string[]): string {
  const player = getPlayerById(playerId);
  if (!player) return "Player not found.";
  if (!player.roomId) return "You aren't anywhere you can speak.";

  const message = args.join(" ").trim();
  if (!message) return "Say what?";

  const name = getDisplayName(player);

  broadcastToRoom(
    player.roomId,
    {
      type: "chat",
      payload: {
        speaker: name,
        message,
      },
    },
    player.id
  );

  return `❝ You say: "${message}"`;
}
