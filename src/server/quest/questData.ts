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
  },
  {
    id: "authored-fog-scout",
    title: "Into the Greyfall",
    description:
      "A merchant caravan vanished on the north road three days past. " +
      "Scout the fog line and report what you find. Do not go alone.",
    giver: "Captain Vey",
    difficulty: "Moderate",
    participation: "party",
    reward: { gold: 80, xp: 120, item: "Lantern of Warding" },
    recommendedSize: 3,
    generated: false,
  },
  {
    id: "authored-herbs",
    title: "The Healer's Request",
    description:
      "Sister Mara needs moonpetal blossoms from the old churchyard to " +
      "treat the sick. They only bloom after dark.",
    giver: "Sister Mara",
    difficulty: "Easy",
    participation: "either",
    reward: { gold: 35, xp: 50 },
    recommendedSize: 2,
    generated: false,
  },
  {
    id: "authored-bell",
    title: "The Silent Bell",
    description:
      "The chapel bell has not rung since the Greyfall. Climb the tower, " +
      "find what stops it, and make it sound again.",
    giver: "Old Hollis",
    difficulty: "Hard",
    participation: "party",
    reward: { gold: 150, xp: 240, item: "Bellringer's Seal" },
    recommendedSize: 4,
    generated: false,
  },
  {
    id: "authored-wolves",
    title: "Fog-Wolves at the Gate",
    description:
      "Captain Vey reports fog-wolves circling the north gate after dark. " +
      "Thin the pack before they grow bold enough to breach the wall.",
    giver: "Captain Vey",
    difficulty: "Moderate",
    participation: "either",
    reward: { gold: 70, xp: 100 },
    recommendedSize: 2,
    generated: false,
  },
  {
    id: "authored-delivery",
    title: "Bitter Medicine",
    description:
      "Isolde has a healing draught promised to a shut-in across the square. " +
      "Deliver it before nightfall — and don't drink it yourself.",
    giver: "Isolde",
    difficulty: "Trivial",
    participation: "solo",
    reward: { gold: 20, xp: 30 },
    recommendedSize: 1,
    generated: false,
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
