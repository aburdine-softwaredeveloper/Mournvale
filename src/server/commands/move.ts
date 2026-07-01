/**
 * move.ts — Moves a player to an adjacent room via a direction
 */

import { rooms, getPlayerById } from "../gameState";
import { broadcastToRoom } from "../roomUtils";

export function move(playerId: string, direction: string): string {
  const player = getPlayerById(playerId);
  if (!player) return "Player not found.";
  if (!player.roomId) return "You have no location to move from.";

  const room = rooms[player.roomId];
  if (!room) return "You are nowhere.";

  const nextRoomId = room.exits[direction as keyof typeof room.exits];
  if (!nextRoomId) return "You can't go that way.";

  const nextRoom = rooms[nextRoomId];
  if (!nextRoom) return "That path leads nowhere...";

  // Announce departure to the old room
  broadcastToRoom(
    player.roomId,
    {
      type: "player_presence",
      payload: {
        playerName: player.character?.name ?? player.tempName,
        event: "left",
      },
    },
    player.id
  );

  player.roomId = nextRoomId;

  // Announce arrival to the new room
  broadcastToRoom(
    nextRoomId,
    {
      type: "player_presence",
      payload: {
        playerName: player.character?.name ?? player.tempName,
        event: "entered",
      },
    },
    player.id
  );

  const exits = Object.keys(nextRoom.exits).join(", ") || "none";

  return `» You move ${direction}...\n\n◆ ${nextRoom.name}\n\n${nextRoom.description}\n\nExits: ${exits}`;
}
