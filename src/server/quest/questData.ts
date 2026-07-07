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
    resolution:
      "Aldric wipes a tankard, listening to the quiet below. \"No more scratching in " +
      "the walls. First peace this cellar's had in a month.\" He slides you a drink " +
      "on the house. \"You're alright, you know that? Door's always open to you here.\"",
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
    resolution:
      "Vey turns the frozen glove over in her hands for a long moment, jaw tight. " +
      "\"Taken from above. So it's not just beasts out there — it's hunting.\" She " +
      "presses the Lantern of Warding into your grip. \"This kept my father alive in " +
      "the old fog. Carry it. And keep your eyes on the sky.\"",
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
    resolution:
      "Sister Mara cradles the moonpetals as though they were newborn. \"Fresh, and " +
      "not a one bruised. Bless you.\" Down the ward, a child's fever has already " +
      "begun to break. \"You didn't just fetch flowers,\" she says softly. \"You " +
      "bought that little one another morning. I won't forget it.\"",
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
    resolution:
      "Old Hollis holds the grey, breathing knot to the lamplight and his hands " +
      "start to shake. \"Forty years I rang that bell at dawn. Forty years it kept " +
      "the dark honest.\" He closes your fingers around the Bellringer's Seal. \"It " +
      "will ring again because of you. Go on — I want to hear it while I still can.\"",
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
    resolution:
      "The last wolf's howl thins into the fog and does not return. Word runs ahead " +
      "of you to the gate, where Captain Vey meets you at the wall. \"The nightwatch " +
      "can sleep tonight,\" she says, and means it. \"The pack won't test that wall " +
      "again soon. The town owes you a quiet night — take it.\"",
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
    resolution:
      "The shut-in's door opens a crack, then wider. Thin hands take the draught, " +
      "and for the first time in a long while, the old soul on the other side smiles. " +
      "\"Isolde sent you? Tell her... tell her I said thank you. And that I'm not " +
      "ready to go yet.\" The door closes gently. It's done.",
  },
];

// ─────────────────────────────────────────────
// RANDOM QUEST GENERATION
// ─────────────────────────────────────────────

/**
 * Every generated quest is bound to a REAL room and a completable objective —
 * no more jobs pointing at places that don't exist ("the fog market", "the
 * drowned crypt"). Field kinds auto-complete: gather/scout/investigate finish
 * on `look` in the objective room (they carry no turnInNpcId), deliver finishes
 * on arrival. So a generated quest never depends on NPC wiring it doesn't have.
 */
interface GenPlace {
  roomId: string;
  /** How the place reads in quest prose ("the Old Graveyard"). */
  label: string;
}

const GEN_PLACES: GenPlace[] = [
  { roomId: "market_square",      label: "Market Square" },
  { roomId: "graveyard",          label: "the Old Graveyard" },
  { roomId: "stables",            label: "the Stables" },
  { roomId: "smithy",             label: "the Iron Hearth" },
  { roomId: "general_store",      label: "Welk's Sundries" },
  { roomId: "guard_post",         label: "the Guard Post" },
  { roomId: "south_road",         label: "the South Road" },
  { roomId: "north_gate",         label: "the North Gate" },
  { roomId: "apothecary",         label: "the Greenglass Apothecary" },
  { roomId: "cobblestone_street", label: "Cobblestone Street" },
];

interface GenTemplate {
  title: string;
  description: string;
  participation: QuestParticipation;
  objectiveKind: NonNullable<Quest["objectiveKind"]>;
  lookClue: string;
}

const GEN_TEMPLATES: GenTemplate[] = [
  {
    title: "Lost {item}",
    description:
      "Someone dropped a {item} near {place}. Search the spot (look around " +
      "when you get there) and it's yours to claim the reward on.",
    participation: "solo",
    objectiveKind: "gather",
    lookClue:
      "There — half-hidden in the muck, the {item}. You pocket it. That was " +
      "easier than honest work.",
  },
  {
    title: "Eyes on {place}",
    description:
      "Folk report strange movement around {place} after dark. Go take a " +
      "careful look and note anything amiss.",
    participation: "either",
    objectiveKind: "scout",
    lookClue:
      "You watch {place} from the shadows until your legs cramp. Whatever " +
      "was moving here has moved on — but you've seen enough to earn your coin.",
  },
  {
    title: "Trouble at {place}",
    description:
      "Something's been wrong at {place} for days — noises, small thefts, a " +
      "bad feeling. Look the place over and get to the bottom of it.",
    participation: "either",
    objectiveKind: "investigate",
    lookClue:
      "You turn {place} over corner by corner and find the cause: fog-damp " +
      "rot and a nest of vermin, already abandoned. Nothing a stiff broom " +
      "won't cure. Mystery solved.",
  },
  {
    title: "Delivery to {place}",
    description:
      "A sealed parcel needs carrying to {place} before nightfall. No " +
      "questions, no peeking.",
    participation: "solo",
    objectiveKind: "deliver",
    lookClue: "", // deliver completes on arrival; no look step
  },
];

const ITEMS = ["signet ring", "iron locket", "sealed letter", "silver dagger", "music box"];
const GIVERS = ["Aldric the Barkeep", "Captain Vey", "Old Hollis", "a hooded stranger", "the town notice board"];

/** Generated jobs are odd jobs, not campaigns — keep them in the low tiers. */
const GEN_DIFFICULTIES: QuestDifficulty[] = ["Trivial", "Easy", "Moderate"];
const DIFFICULTIES: QuestDifficulty[] = ["Trivial", "Easy", "Moderate", "Hard", "Perilous"];

function pick<T>(arr: T[]): T {
  // arr is always non-empty here; the non-null assertion is safe.
  return arr[Math.floor(Math.random() * arr.length)]!;
}

function fill(template: string, place: string, item: string): string {
  return template.replace(/\{place\}/g, place).replace(/\{item\}/g, item);
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
 * Generates a single random quest from the templates. Always playable:
 * the objective room exists and the objective kind auto-completes.
 */
export function generateQuest(): Quest {
  const template = pick(GEN_TEMPLATES);
  const place = pick(GEN_PLACES);
  const item = pick(ITEMS);
  const difficulty = pick(GEN_DIFFICULTIES);
  const reward = rewardForDifficulty(difficulty);

  return {
    id: `gen-${randomUUID()}`,
    title: fill(template.title, place.label, item),
    description: fill(template.description, place.label, item),
    giver: pick(GIVERS),
    difficulty,
    participation: template.participation,
    reward,
    recommendedSize: recommendedForParticipation(template.participation, difficulty),
    generated: true,
    objectiveRoomId: place.roomId,
    objectiveKind: template.objectiveKind,
    ...(template.lookClue ? { lookClue: fill(template.lookClue, place.label, item) } : {}),
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
