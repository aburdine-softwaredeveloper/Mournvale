import { players, rooms } from "../gameState";

export function move(playerId: string, direction: string): string {
  const player = players[playerId];
  if (!player) return "Player not found.";

  const room = rooms[player.roomId];
  if (!room) return "You are nowhere.";

  const nextRoomId = room.exits[direction as keyof typeof room.exits];

  if (!nextRoomId) {
    return "You can't go that way.";
  }

  const nextRoom = rooms[nextRoomId];

  if (!nextRoom) {
    return "That path leads nowhere...";
  }

  player.roomId = nextRoomId;

  return `\n➡️ You move ${direction}...\n\n📍 ${nextRoom.name}\n\n${nextRoom.description}`;
}