/**
 * look.ts — Returns a structured room description for the current player
 */

import { getPlayerById, getActivePlayersInRoom, rooms, getDisplayName } from "../gameState";

export function look(playerId: string): string {
  const player = getPlayerById(playerId);
  if (!player) return "Player not found.";
  if (!player.roomId) return "You are nowhere...";

  const room = rooms[player.roomId];
  if (!room) return "You are nowhere...";

  const occupants = getActivePlayersInRoom(room.id)
    .filter((p) => p.id !== player.id)
    .map((p) => `  - ${getDisplayName(p)}`);

  const exits = Object.keys(room.exits).join(", ") || "none";

  const playerList =
    occupants.length > 0
      ? `\n\nPeople here:\n${occupants.join("\n")}`
      : "\n\nYou are alone here.";

  return `📍 ${room.name}\n\n${room.description}\n\nExits: ${exits}${playerList}`;
}
