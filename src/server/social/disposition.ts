/**
 * disposition.ts — Per-character relationship state that *drifts* over time.
 *
 * The town codex (townCodex.ts) is what every NPC publicly knows; playerContext
 * is what they notice about a visitor right now. This is the third social layer:
 * how each NPC privately *feels* about THIS character, accumulated across every
 * conversation they've had. Talk kindly and an NPC warms to you (and grows
 * easier to persuade next time); lean on people and you get what you want now
 * but earn a grudge that follows you.
 *
 * Design — one rapport axis, deliberately:
 *   - Score lives in [-100, +100], 0 = strangers. Mapped to five named bands.
 *   - Each conversational outcome nudges the score by (intent, tier). The deltas
 *     encode the *mechanic the player feels*: PERSUADE/INQUIRE build rapport that
 *     compounds (a warmer NPC has a lower effective DC, so kindness pays interest);
 *     INTIMIDATE still wins the check but COSTS rapport even on success (compliance
 *     through fear breeds resentment) — a real strategic trade; a botched DECEIVE
 *     (crit_fail) means you were caught lying and the relationship craters.
 *   - Band sets the LLM's tone across conversations (so an NPC "remembers" you)
 *     and shifts the effective DC of future checks (so drift is mechanical, not
 *     just flavor).
 *
 * Purity: every function here is side-effect-free and unit-testable, matching the
 * SkillEngine / progression conventions. State (SocialMemory) lives on the Player,
 * is persisted per save slot, and is only ever mutated through these helpers.
 */

import type { TalkIntent, DialogueOutcome } from "../../types/npc";
import type { SocialMemory } from "../../types/social";

export type { SocialMemory };

// ─── Score bounds & bands ──────────────────────────────────────────────────────

export const DISPOSITION_MIN = -100;
export const DISPOSITION_MAX = 100;

/** Named relationship tiers, coldest → warmest. */
export type DispositionBand = "hostile" | "wary" | "neutral" | "warm" | "trusting";

/**
 * Lower score bound (inclusive) for each band, checked high→low. Edit these to
 * retune how quickly relationships read as warm/cold — nothing else changes.
 */
const BAND_FLOORS: { band: DispositionBand; floor: number }[] = [
  { band: "trusting", floor: 50 },
  { band: "warm", floor: 20 },
  { band: "neutral", floor: -19 },
  { band: "wary", floor: -49 },
  { band: "hostile", floor: DISPOSITION_MIN },
];

/** The band a raw disposition score falls into. */
export function bandFor(score: number): DispositionBand {
  for (const { band, floor } of BAND_FLOORS) {
    if (score >= floor) return band;
  }
  return "hostile";
}

// ─── Outcome deltas (the heart of the mechanic) ────────────────────────────────

/**
 * How much each (intent, outcome-tier) shifts rapport. Read these as the social
 * contract of the game:
 *   - persuade / inquire: warmth is earned by talking well; failure stings a little.
 *   - deceive: a smooth lie charms slightly, but getting CAUGHT (crit_fail) is ruinous.
 *   - intimidate: every tier is net-negative on rapport — fear is not friendship.
 *     You may still WANT to intimidate (the check can succeed and unlock things),
 *     but you spend the relationship to do it.
 */
const OUTCOME_DELTAS: Record<TalkIntent, Record<DialogueOutcome, number>> = {
  persuade:   { crit_success: 12, success: 6, fail: -3, crit_fail: -10 },
  inquire:    { crit_success: 8, success: 4, fail: -1, crit_fail: -6 },
  deceive:    { crit_success: 4, success: 2, fail: -6, crit_fail: -18 },
  intimidate: { crit_success: -2, success: -5, fail: -10, crit_fail: -16 },
};

/** The rapport change a given approach + result would produce. */
export function outcomeDelta(intent: TalkIntent, tier: DialogueOutcome): number {
  return OUTCOME_DELTAS[intent][tier];
}

// ─── Per-character social memory (persisted) ───────────────────────────────────

/**
 * SocialMemory (one character's private feelings toward every NPC they've met)
 * is defined in types/social.ts and re-exported above so callers can import it
 * from here alongside the helpers that operate on it.
 */

/** A blank social memory for a fresh character. */
export function newSocialMemory(): SocialMemory {
  return { disposition: {} };
}

/** Current rapport with an NPC (0 if never spoken). */
export function dispositionWith(memory: SocialMemory, npcId: string): number {
  return memory.disposition[npcId] ?? 0;
}

function clampScore(n: number): number {
  return Math.max(DISPOSITION_MIN, Math.min(DISPOSITION_MAX, n));
}

/** The result of folding one conversation into a relationship. */
export interface DispositionShift {
  memory: SocialMemory;
  before: number;
  after: number;
  bandBefore: DispositionBand;
  bandAfter: DispositionBand;
  /** True when the conversation moved the relationship into a new band. */
  bandChanged: boolean;
}

/**
 * Apply a conversation's (intent, tier) to the relationship with `npcId`. Pure:
 * returns a NEW SocialMemory plus the before/after detail so the caller can both
 * persist the new state and tell the player when a relationship visibly shifts.
 */
export function applyTalkOutcome(
  memory: SocialMemory,
  npcId: string,
  intent: TalkIntent,
  tier: DialogueOutcome
): DispositionShift {
  const before = dispositionWith(memory, npcId);
  const after = clampScore(before + outcomeDelta(intent, tier));
  const next: SocialMemory = {
    disposition: { ...memory.disposition, [npcId]: after },
  };
  const bandBefore = bandFor(before);
  const bandAfter = bandFor(after);
  return {
    memory: next,
    before,
    after,
    bandBefore,
    bandAfter,
    bandChanged: bandBefore !== bandAfter,
  };
}

// ─── Mechanical & narrative projections of a relationship ──────────────────────

/**
 * How the relationship shifts the effective DC of a conversational check. Warmer
 * NPCs are easier to sway (negative = lower DC); wary/hostile ones harder. Capped
 * so a single relationship can't trivialize or hard-lock dialogue (~±4).
 */
export function dispositionDcModifier(score: number): number {
  // `+ 0` normalizes the -0 that Math.round(-0/15) yields at score 0.
  return Math.max(-4, Math.min(4, Math.round(-score / 15) + 0));
}

/** First-person tone guidance folded into the NPC's LLM prompt for each band. */
const BAND_GUIDANCE: Record<DispositionBand, string> = {
  hostile:
    "You bear a real grudge against this person from past dealings — you're cold, short, and would rather they left.",
  wary:
    "Past encounters left you wary of them; you're guarded, slow to trust, and weigh your words.",
  neutral:
    "You've no strong feelings about them yet — you treat them as the stranger they are.",
  warm:
    "You've come to like this person over past talks; you're glad to see them and inclined to help.",
  trusting:
    "You trust this person and speak to them almost as an old friend, openly and without guard.",
};

/** The prompt line describing how this NPC currently feels about the player. */
export function dispositionGuidance(score: number): string {
  return BAND_GUIDANCE[bandFor(score)];
}

/**
 * A short player-facing line when a relationship crosses into a new band, framed
 * from the NPC's side. Direction is inferred from the bands so one table covers
 * both warming and souring. Returns null if asked for a non-transition.
 */
export function bandChangeNotice(npcName: string, shift: DispositionShift): string | null {
  if (!shift.bandChanged) return null;
  const warmer = shift.after > shift.before;
  const PHRASING: Record<DispositionBand, { up: string; down: string }> = {
    trusting: { up: `${npcName} now speaks to you as a trusted friend.`, down: "" },
    warm: { up: `${npcName} warms to you.`, down: `${npcName} thaws a little toward you.` },
    neutral: { up: `${npcName} sets aside their wariness of you.`, down: `${npcName} cools toward you.` },
    wary: { up: `${npcName} eyes you, wary now.`, down: `${npcName} grows wary of you.` },
    hostile: { up: "", down: `${npcName} has come to resent you.` },
  };
  const phrase = PHRASING[shift.bandAfter];
  const line = warmer ? phrase.up : phrase.down;
  return line || null;
}
