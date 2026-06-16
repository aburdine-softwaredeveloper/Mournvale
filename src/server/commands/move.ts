import { rooms, getPlayerById } from "../gameState";

export function move(playerId: string, direction: string): string {
  const player = getPlayerById(playerId);
  if (!player) return "Player not found.";

  const room = rooms[player.roomId];
  if (!room) return "You are nowhere.";

  const nextRoomId = room.exits[direction];

  if (!nextRoomId) {
    return "You can't go that way.";
  }

  const nextRoom = rooms[nextRoomId];

  if (!nextRoom) {
    return "That path leads nowhere...";
  }

  player.roomId = nextRoomId;

  return `➡️ You move ${direction}...

📍 ${nextRoom.name}

${nextRoom.description}`;
}