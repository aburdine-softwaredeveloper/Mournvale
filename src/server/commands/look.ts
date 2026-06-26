/**
 * look.ts — Returns a structured room description for the current player
 *
 * `look` is the deliberate, close-inspection verb: beyond the room's arrival
 * blurb it surfaces ambient detail and the concrete objects/features in the
 * room (see roomDetails.ts) — many of which are story or quest hooks. The
 * quest-conditional clue (Quest.lookClue) is layered on top by the server,
 * which has the player's active quest; this function stays quest-agnostic.
 */

import { getPlayerById, getActivePlayersInRoom, rooms, getDisplayName } from "../gameState";
import { ROOM_DETAILS } from "../world/roomDetails";

export function look(playerId: string): string {
  const player = getPlayerById(playerId);
  if (!player) return "Player not found.";
  if (!player.roomId) return "You are nowhere...";

  const room = rooms[player.roomId];
  if (!room) return "You are nowhere...";

  const detail = ROOM_DETAILS[room.id];

  const occupants = getActivePlayersInRoom(room.id)
    .filter((p) => p.id !== player.id)
    .map((p) => `  - ${getDisplayName(p)}`);

  const exits = Object.keys(room.exits).join(", ") || "none";

  // Assemble in sections so the close-up detail and notable features read as a
  // natural deepening of the room blurb, before exits and occupants.
  const sections: string[] = [`📍 ${room.name}`, room.description];

  if (detail?.detail) sections.push(detail.detail);
  if (detail?.features?.length) {
    sections.push(
      `You notice:\n${detail.features.map((f) => `  • ${f}`).join("\n")}`
    );
  }

  sections.push(`Exits: ${exits}`);
  sections.push(
    occupants.length > 0 ? `People here:\n${occupants.join("\n")}` : "You are alone here."
  );

  return sections.join("\n\n");
}
