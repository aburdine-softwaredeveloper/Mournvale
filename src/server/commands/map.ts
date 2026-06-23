/**
 * map.ts — Renders an ASCII map of Mournvale with the player's room marked.
 *
 * The town is a fixed 3-column grid (see the layout diagram in rooms.ts); the
 * cellar sits below the tavern and is noted separately rather than placed on the
 * grid. The current room is highlighted by swapping its `[ ]` brackets for `* *`
 * — same width, so the grid stays aligned in the monospace log.
 */

import { getPlayerById, rooms } from "../gameState";

/** Short labels (≤13 chars) for the grid cells. */
const LABELS: Record<string, string> = {
  chapel: "Chapel",
  graveyard: "Graveyard",
  north_gate: "North Gate",
  apothecary: "Apothecary",
  smithy: "Smithy",
  market_square: "Market Sq.",
  general_store: "Welk's Store",
  cobblestone_street: "Cobble St.",
  stables: "Stables",
  tavern: "The Lantern",
  guard_post: "Guard Post",
  south_road: "South Road",
};

const CELL_INNER = 13; // chars inside the brackets
const COL1_INDENT = " ".repeat(18); // 15-wide cell + 3-wide connector
const VBAR = `${" ".repeat(25)}|`; // aligns under the centre column
const H = "---";

function center(s: string, width: number): string {
  if (s.length >= width) return s.slice(0, width);
  const total = width - s.length;
  const left = Math.floor(total / 2);
  return " ".repeat(left) + s + " ".repeat(total - left);
}

/** A fixed-width grid cell; highlighted with `*` borders when it's the room. */
function cell(id: string, current: string): string {
  const inner = center(LABELS[id] ?? id, CELL_INNER);
  return id === current ? `*${inner}*` : `[${inner}]`;
}

export function townMap(playerId: string): string {
  const player = getPlayerById(playerId);
  const here = player?.roomId ?? "";
  const inCellar = here === "cellar";
  const c = inCellar ? "" : here; // nothing on the grid is "current" while below

  const grid = [
    COL1_INDENT + cell("chapel", c),
    VBAR,
    cell("graveyard", c) + H + cell("north_gate", c) + H + cell("apothecary", c),
    VBAR,
    cell("smithy", c) + H + cell("market_square", c) + H + cell("general_store", c),
    VBAR,
    COL1_INDENT + cell("cobblestone_street", c),
    VBAR,
    cell("stables", c) + H + cell("tavern", c) + H + cell("guard_post", c),
    VBAR,
    COL1_INDENT + cell("south_road", c),
  ];

  const hereName = rooms[here]?.name ?? "somewhere unknown";
  const youAre = inCellar
    ? `You are in the cellar beneath The Broken Lantern — go 'up' to climb out.`
    : `You are here: ${hereName}  (marked *…*)`;

  return [
    "        M O U R N V A L E  —  Town Map",
    "",
    ...grid,
    "",
    "  (The Lantern's cellar lies below — go 'down'.)",
    "",
    `  ${youAre}`,
  ].join("\n");
}
