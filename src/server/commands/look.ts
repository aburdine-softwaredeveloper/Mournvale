import { players, rooms, getPlayerById } from "../gameState";
import { getPlayersInRoom } from "../roomUtils";

export function look(playerId: string): string {
  const player = getPlayerById(playerId);

  if (!player) return "Player not found.";

  const room = rooms[player.roomId];

  if (!room) return "You are nowhere...";

  const occupants = getPlayersInRoom(room.id)
    .filter((p) => p.id !== player.id)
    .map((p) => ` - ${p.name}`);

  const playerList =
    occupants.length > 0
      ? `\n\nPeople here:\n${occupants.join("\n")}`
      : "\n\nYou are alone here.";

  return `📍 ${room.name}

${room.description}${playerList}`;
}