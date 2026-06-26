/**
 * questData.ts — Authored quests + random quest generator
 *
 * Per design, the board mixes hand-authored quests with procedurally
 * generated ones. Both produce the same Quest shape. Authored quests
 * give the world flavor; generated ones keep the board fresh.
 */

import { randomUUID } from "crypto";
import type {
  Quest,
  QuestDifficulty,
  QuestParticipation,
} from "../../types/quest";

// ─────────────────────────────────────────────
// AUTHORED QUESTS
// ─────────────────────────────────────────────

/**
 * Hand-authored quests. These always appear on the board. Stable ids so
 * accepting/abandoning behaves predictably across board refreshes.
 */
export const AUTHORED_QUESTS: Quest[] = [
  {
    id: "authored-rats",
    title: "Cellar Vermin",
    description:
      "Aldric's cellar has been overrun by unusually bold rats. Clear " +
      "them out before they get into the good ale.",
    giver: "Aldric",
    difficulty: "Trivial",
    participation: "solo",
    reward: { gold: 15, xp: 25 },
    recommendedSize: 1,
    generated: false,
    objectiveRoomId: "cellar",
    objectiveKind: "clear",
  },
  {
    id: "authored-fog-scout",
    title: "Into the Greyfall",
    description:
      "A merchant caravan vanished on the south road three days past. Follow " +
      "the road to the fog line, scout what became of them, and report back to " +
      "Captain Vey at the guard post.",
    giver: "Captain Vey",
    difficulty: "Moderate",
    participation: "either",
    reward: { gold: 80, xp: 120, item: "Lantern of Warding" },
    recommendedSize: 3,
    generated: false,
    objectiveRoomId: "south_road",
    objectiveKind: "scout",
    turnInNpcId: "captain_vey",
    lookClue:
      "You crouch by the ruts where the cart-tracks stop dead. No mud thrown, " +
      "no struggle — the wheels simply leave the ground. Among the moss you find " +
      "the caravan's strongbox, forced open and emptied, and a driver's glove " +
      "with the fingers frozen mid-grasp. Whatever took them, it came from above " +
      "the road, out of the fog. Captain Vey will want to hear this.",
  },
  {
    id: "authored-herbs",
    title: "The Healer's Request",
    description:
      "Sister Mara needs moonpetal blossoms from the old churchyard to treat " +
      "the sick. Gather them from the graveyard, then bring them to her at the " +
      "chapel.",
    giver: "Sister Mara",
    difficulty: "Easy",
    participation: "either",
    reward: { gold: 35, xp: 50 },
    recommendedSize: 2,
    generated: false,
    objectiveRoomId: "graveyard",
    objectiveKind: "gather",
    turnInNpcId: "sister_mara",
    lookClue:
      "The moonpetals grow thickest in the lee of the oldest stones, just as " +
      "Sister Mara said — pale cups that drink the dark. You gather the freshest " +
      "blooms with care; bruise them and the sap turns bitter and useless. A " +
      "handful should be enough for her draughts.",
  },
  {
    id: "authored-bell",
    title: "The Silent Bell",
    description:
      "The chapel bell has not rung since the Greyfall. Search the chapel for " +
      "what silenced it, then return to Old Hollis in the graveyard with what " +
      "you find.",
    giver: "Old Hollis",
    difficulty: "Hard",
    participation: "either",
    reward: { gold: 150, xp: 240, item: "Bellringer's Seal" },
    recommendedSize: 4,
    generated: false,
    objectiveRoomId: "chapel",
    objectiveKind: "investigate",
    turnInNpcId: "old_hollis",
    lookClue:
      "You climb to the belfry and find the bell whole — but something is wedged " +
      "in its throat: a knot of grey, fibrous matter, cold as grave-dirt and " +
      "faintly breathing. It drinks the sound before the bell can make it. You " +
      "work a sample free with your knife. Old Hollis kept the chapel for forty " +
      "years; he should see this.",
  },
  {
    id: "authored-wolves",
    title: "Fog-Wolves at the Gate",
    description:
      "Captain Vey reports fog-wolves circling the north gate after dark. " +
      "Follow the fog road past the chapel and thin the pack before they grow " +
      "bold enough to breach the wall.",
    giver: "Captain Vey",
    difficulty: "Moderate",
    participation: "either",
    reward: { gold: 70, xp: 100 },
    recommendedSize: 2,
    generated: false,
    objectiveRoomId: "fog_road",
    objectiveKind: "clear",
  },
  {
    id: "authored-fog-boss",
    title: "The Heart of the Fog",
    description:
      "The Greyfall has a source, and it is awake. Follow the fog road to its " +
      "end and face the Fogmother. Win, and the fog lifts from the land. This " +
      "is no fight to take lightly, or alone.",
    giver: "Old Hollis",
    difficulty: "Perilous",
    participation: "party",
    reward: { gold: 500, xp: 600, item: "Fogbreaker's Crown" },
    recommendedSize: 4,
    generated: false,
    objectiveRoomId: "fogheart",
    objectiveKind: "clear",
  },
  {
    id: "authored-delivery",
    title: "Bitter Medicine",
    description:
      "Isolde has a healing draught promised to a shut-in across the market " +
      "square. Carry it there before nightfall — and don't drink it yourself.",
    giver: "Isolde",
    difficulty: "Trivial",
    participation: "solo",
    reward: { gold: 20, xp: 30 },
    recommendedSize: 1,
    generated: false,
    objectiveRoomId: "market_square",
    objectiveKind: "deliver",
  },
];

// ─────────────────────────────────────────────
// RANDOM QUEST GENERATION
// ─────────────────────────────────────────────

const GEN_TEMPLATES: {
  title: string;
  description: string;
  participation: QuestParticipation;
}[] = [
  {
    title: "Bounty: {target}",
    description: "A {target} has been menacing the {place}. Put it down and bring proof.",
    participation: "either",
  },
  {
    title: "Lost {item}",
    description: "Someone dropped a {item} near the {place}. Recover it and return it for a reward.",
    participation: "solo",
  },
  {
    title: "Escort to {place}",
    description: "A nervous traveler needs safe passage to the {place}. Keep them alive.",
    participation: "party",
  },
  {
    title: "Clear the {place}",
    description: "The {place} is thick with {target}s. Make it safe again.",
    participation: "either",
  },
];

const TARGETS = ["wraith", "fog-wolf", "bandit", "ghoul", "shade", "mire-beast"];
const PLACES = ["old mill", "drowned crypt", "north road", "ruined chapel", "fog market", "broken bridge"];
const ITEMS = ["signet ring", "iron locket", "sealed letter", "silver dagger", "music box"];
const GIVERS = ["Aldric the Barkeep", "Captain Vey", "Old Hollis", "a hooded stranger", "the town notice board"];

const DIFFICULTIES: QuestDifficulty[] = ["Trivial", "Easy", "Moderate", "Hard", "Perilous"];

function pick<T>(arr: T[]): T {
  // arr is always non-empty here; the non-null assertion is safe.
  return arr[Math.floor(Math.random() * arr.length)]!;
}

function fill(template: string, target: string, place: string, item: string): string {
  return template
    .replace(/\{target\}/g, target)
    .replace(/\{place\}/g, place)
    .replace(/\{item\}/g, item);
}

/** Rewards scale with difficulty tier. */
function rewardForDifficulty(difficulty: QuestDifficulty): { gold: number; xp: number } {
  const tier = DIFFICULTIES.indexOf(difficulty);
  const gold = 10 + tier * 30 + Math.floor(Math.random() * 20);
  const xp = 20 + tier * 50 + Math.floor(Math.random() * 30);
  return { gold, xp };
}

function recommendedForParticipation(
  participation: QuestParticipation,
  difficulty: QuestDifficulty
): number {
  const tier = DIFFICULTIES.indexOf(difficulty);
  if (participation === "solo") return 1;
  if (participation === "party") return Math.min(4, 2 + Math.floor(tier / 2));
  return Math.min(4, 1 + Math.floor(tier / 2));
}

/**
 * Generates a single random quest from the templates.
 */
export function generateQuest(): Quest {
  const template = pick(GEN_TEMPLATES);
  const target = pick(TARGETS);
  const place = pick(PLACES);
  const item = pick(ITEMS);
  const difficulty = pick(DIFFICULTIES);
  const reward = rewardForDifficulty(difficulty);

  return {
    id: `gen-${randomUUID()}`,
    title: fill(template.title, target, place, item),
    description: fill(template.description, target, place, item),
    giver: pick(GIVERS),
    difficulty,
    participation: template.participation,
    reward,
    recommendedSize: recommendedForParticipation(template.participation, difficulty),
    generated: true,
  };
}

/**
 * Generates `count` random quests.
 */
export function generateQuests(count: number): Quest[] {
  const quests: Quest[] = [];
  for (let i = 0; i < count; i++) {
    quests.push(generateQuest());
  }
  return quests;
}
