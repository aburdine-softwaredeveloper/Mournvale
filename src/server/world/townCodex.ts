/**
 * townCodex.ts — Shared "what any local would know" about Mournvale.
 *
 * Compiles the *public* world data (room layout + how places connect, the
 * townsfolk and where they stand, and the work posted on the quest board) into
 * one compact text block. This is folded into every NPC's LLM system prompt so
 * an NPC can answer questions about the town, point a player toward another
 * person ("the smithy's just west of the square — Borin'll sort your steel"),
 * and speak about the quests on offer.
 *
 * Deliberately PUBLIC knowledge only. Secrets that the game gates behind a
 * skill check (the bricked-over cellar door, the caravan that drove into the
 * fog willingly, …) live in `dialogueBranches[].outcomes` and are NOT included
 * here — a townsperson shouldn't blurt out a secret just because someone asked.
 *
 * The codex is static (derived entirely from authored world data), so it's
 * built once at module load and exported as a frozen string.
 */

import { ROOMS } from "./rooms";
import { NPCS } from "./npcs";
import { AUTHORED_QUESTS } from "../quest/questData";
import type { Room } from "../../types/game";

/** Human-readable label for an exit direction. */
const DIRECTION_LABEL: Record<string, string> = {
  north: "north",
  south: "south",
  east: "east",
  west: "west",
  up: "up",
  down: "down",
};

/** First sentence of a room's description — enough flavor without the bulk. */
function shortDescription(room: Room): string {
  const firstSentence = room.description.split(/(?<=\.)\s+/)[0] ?? room.description;
  return firstSentence.trim();
}

/** "north to Market Square, west to the Stables" — how this place connects. */
function describeExits(room: Room): string {
  const parts = Object.entries(room.exits)
    .filter((entry): entry is [string, string] => Boolean(entry[1]))
    .map(([dir, destId]) => {
      const dest = ROOMS[destId];
      const destName = dest ? dest.name : destId;
      const label = DIRECTION_LABEL[dir] ?? dir;
      return `${label} to ${destName}`;
    });
  return parts.length ? parts.join(", ") : "nowhere — it's a dead end";
}

/** The places of Mournvale and how a person walks between them. */
function buildPlacesSection(): string {
  const lines = Object.values(ROOMS).map((room) => {
    return `- ${room.name}: ${shortDescription(room)} (paths lead ${describeExits(room)}.)`;
  });
  return ["The places of Mournvale and how they connect:", ...lines].join("\n");
}

/** The neighbours — who lives/works where (hostiles are not "townsfolk"). */
function buildTownsfolkSection(): string {
  const folk = NPCS.filter((npc) => npc.role !== "hostile");
  const lines = folk.map((npc) => {
    const room = ROOMS[npc.roomId];
    const where = room ? room.name : npc.roomId;
    const offersQuests =
      npc.questIds && npc.questIds.length > 0 ? " — has work to offer" : "";
    const sells = npc.stock && npc.stock.length > 0 ? " — keeps a shop" : "";
    return `- ${npc.name}, the ${npc.title}, found at ${where}${offersQuests}${sells}.`;
  });
  return [
    "The townsfolk you know (your neighbours — where to send someone looking for them):",
    ...lines,
  ].join("\n");
}

/** The work posted around town — what every local has heard is on offer. */
function buildQuestBoardSection(): string {
  const lines = AUTHORED_QUESTS.map((quest) => {
    return `- "${quest.title}" (posted by ${quest.giver}): ${quest.description}`;
  });
  return [
    "Work being talked about around town (the quest board):",
    ...lines,
  ].join("\n");
}

/**
 * The full shared knowledge block. Built once; every NPC's prompt references the
 * same text, so the whole town agrees on the layout, who's who, and what work is
 * going — letting any NPC act as a reference for another.
 */
export const TOWN_CODEX: string = [
  "SHARED LOCAL KNOWLEDGE — things any longtime resident of Mournvale simply knows, and may share in plain conversation:",
  "",
  buildPlacesSection(),
  "",
  buildTownsfolkSection(),
  "",
  buildQuestBoardSection(),
].join("\n");
