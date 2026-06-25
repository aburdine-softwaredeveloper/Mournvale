/**
 * rooms.ts — The Mournvale world map (room definitions)
 *
 * Static world data, moved out of gameState.ts so content lives apart
 * from live session state. Each room has an artKey resolved to
 * /assets/tiles/{artKey}.png by the AssetRegistry (PNG is the default
 * format). The shipped tiles are greyscale placeholders — to use your own
 * pixel art, just overwrite public/assets/tiles/{artKey}.png. No code
 * changes needed; bare artKeys already resolve to PNG.
 *
 * Layout:
 *                       [chapel]
 *                          |
 *      [graveyard]--[north_gate]--[apothecary]
 *                          |
 *      [smithy]----[market_square]----[general_store]
 *                          |
 *                  [cobblestone_street]
 *                          |
 *      [stables]----[tavern]----[guard_post]
 *                          |
 *                     [south_road]
 *
 * Tone: grim-gothic bones (the Greyfall fog at the edges) with warmer,
 * lived-in village life in the town core.
 */

import type { Room } from "../../types/game";

export const ROOMS: Record<string, Room> = {
  tavern: {
    id: "tavern",
    name: "The Broken Lantern",
    description:
      "A dimly lit tavern filled with the smell of ale and wet wood. " +
      "Candles flicker on rough-hewn tables. Behind the bar, the keeper " +
      "eyes you with weathered curiosity.",
    artKey: "tavern",
    exits: { north: "cobblestone_street", west: "stables", east: "guard_post", south: "south_road", down: "cellar" },
  },

  cellar: {
    id: "cellar",
    name: "The Broken Lantern — Cellar",
    description:
      "A low, damp undercroft stacked with ale casks and splintered crates. " +
      "The air is thick with mildew, and something skitters in the dark " +
      "between the barrels — too many somethings, by the sound of it.",
    artKey: "tavern",
    exits: { up: "tavern" },
  },

  cobblestone_street: {
    id: "cobblestone_street",
    name: "Cobblestone Street",
    description:
      "A narrow street worn smooth by generations of boots. Iron lanterns " +
      "sway in the damp air. The tavern's glow spills from the south; the " +
      "market bustles to the north.",
    artKey: "street",
    exits: { north: "market_square", south: "tavern" },
  },

  market_square: {
    id: "market_square",
    name: "Market Square",
    description:
      "The beating heart of the town. Stalls huddle beneath patched awnings, " +
      "and townsfolk barter in low voices. A cracked fountain stands dry at " +
      "the center, its basin filled with grey rainwater.",
    artKey: "market_square",
    exits: {
      north: "north_gate",
      south: "cobblestone_street",
      west: "smithy",
      east: "general_store",
    },
  },

  smithy: {
    id: "smithy",
    name: "The Iron Hearth",
    description:
      "Heat rolls from the forge in waves. Half-finished blades hang on the " +
      "walls, and the rhythmic clang of hammer on steel never quite stops. " +
      "Soot blackens every surface.",
    artKey: "smithy",
    exits: { east: "market_square" },
  },

  general_store: {
    id: "general_store",
    name: "Welk's Sundries",
    description:
      "Shelves crammed to the rafters with rope, lamp oil, dried goods, and " +
      "oddments. A ledger lies open on the counter, its columns filled in a " +
      "cramped, careful hand.",
    artKey: "general_store",
    exits: { west: "market_square" },
  },

  north_gate: {
    id: "north_gate",
    name: "The North Gate",
    description:
      "A heavy timber gate banded with iron, the last barrier before the fog. " +
      "A guard leans against the wall, watching the treeline. Beyond, the road " +
      "vanishes into grey.",
    artKey: "north_gate",
    exits: { south: "market_square", north: "chapel", west: "graveyard", east: "apothecary" },
  },

  chapel: {
    id: "chapel",
    name: "Chapel of the Still Light",
    description:
      "A modest stone chapel, its windows long dark. Rows of worn pews face an " +
      "altar where a single candle burns. The silence here feels deliberate, " +
      "as though the room is listening.",
    artKey: "chapel",
    exits: { south: "north_gate" },
  },

  graveyard: {
    id: "graveyard",
    name: "The Old Graveyard",
    description:
      "Leaning headstones rise from the mist like crooked teeth. The grass is " +
      "wet and silver. Somewhere among the markers, a crow complains and falls " +
      "quiet.",
    artKey: "graveyard",
    exits: { east: "north_gate" },
  },

  apothecary: {
    id: "apothecary",
    name: "The Greenglass Apothecary",
    description:
      "Bundles of dried herbs hang from the beams, and glass bottles in a " +
      "hundred shades of green line the shelves. The air is thick with the " +
      "smell of bitter roots and crushed petals.",
    artKey: "apothecary",
    exits: { west: "north_gate" },
  },

  stables: {
    id: "stables",
    name: "The Stables",
    description:
      "Warm with the breath of horses and the smell of hay. Tack hangs in neat " +
      "rows, and a stable-hand moves quietly between the stalls. One horse " +
      "watches you with dark, patient eyes.",
    artKey: "stables",
    exits: { east: "tavern" },
  },

  guard_post: {
    id: "guard_post",
    name: "The Guard Post",
    description:
      "A cramped watch-house with a weapon rack and a cold hearth. A map of the " +
      "valley is pinned to the wall, several roads marked through with charcoal " +
      "where the fog has swallowed them.",
    artKey: "guard_post",
    exits: { west: "tavern" },
  },

  south_road: {
    id: "south_road",
    name: "The South Road",
    description:
      "The town thins to nothing here. The road runs on into the Greyfall, its " +
      "edges dissolving after a dozen paces. The fog seems to breathe. Few who " +
      "walk this way alone come back.",
    artKey: "south_road",
    exits: { north: "tavern" },
  },
};
