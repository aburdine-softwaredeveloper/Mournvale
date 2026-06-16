import { players, rooms } from "../gameState";

export function look(playerId: string): string {
  const player = players[playerId];
  if (!player) return "Player not found.";

  const room = rooms[player.roomId];
  if (!room) return "You are nowhere...";

  return `\n📍 ${room.name}\n\n${room.description}`;
}