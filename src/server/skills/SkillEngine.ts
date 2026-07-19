/**
 * SkillEngine.ts — Pure dice and skill-resolution functions
 *
 * All functions here are side-effect-free and easily unit-testable.
 * Used by:
 *   Phase 2 — NPC dialogue skill checks (WorldManager.resolveTalk)
 *   Phase 3 — Combat attack rolls, initiative, saving throws
 *
 * No imports from network.ts or other server modules — stays pure.
 */

import type { AbilityScore, CharacterStats, Skill, Weapon } from "../../types/character";
import { SKILL_ABILITY } from "../../types/character";

// ─── Result types ─────────────────────────────────────────────────────────────

export interface DiceRoll {
  die: number;       // e.g. 20 for a d20
  result: number;    // raw die face before modifier
  modifier: number;  // total modifier applied
  total: number;     // result + modifier
}

/**
 * Four-tier outcome used for skill checks and saving throws.
 * Mirrors DialogueOutcome in npc.ts — kept separate to avoid
 * importing NPC types into a general-purpose engine.
 */
export type CheckTier = "crit_fail" | "fail" | "success" | "crit_success";

export interface SkillCheckResult {
  roll: DiceRoll;
  dc: number;
  /** total − dc (negative = failure) */
  margin: number;
  tier: CheckTier;
  skill: Skill;
  wasProficient: boolean;
}

export interface AttackResult {
  roll: DiceRoll;
  targetAC: number;
  hit: boolean;
  /** Natural 20 — always hits and doubles damage dice. */
  crit: boolean;
  damage?: DamageResult;
}

export interface DamageResult {
  dice: string;
  baseRoll: number;
  modifier: number;
  total: number;
}

export interface InitiativeResult {
  entityId: string;
  roll: DiceRoll;
  total: number;
}

// ─── Dice primitives ──────────────────────────────────────────────────────────

export function rollDie(sides: number): number {
  return Math.floor(Math.random() * sides) + 1;
}

/**
 * Parses and rolls standard dice notation: "2d6", "1d8+3", "1d4+1", etc.
 * NOTE: does NOT resolve token references like "+level" or "+wis" —
 * use resolveHealingDice for those.
 */
export function rollDice(notation: string): number {
  const match = notation.match(/^(\d+)d(\d+)([+-]\d+)?$/);
  if (!match) return 0;
  const count = parseInt(match[1] ?? "1");
  const sides = parseInt(match[2] ?? "6");
  const flat  = match[3] ? parseInt(match[3]) : 0;
  let total   = flat;
  for (let i = 0; i < count; i++) total += rollDie(sides);
  return Math.max(1, total);
}

// ─── Modifiers ────────────────────────────────────────────────────────────────

/** Standard D&D ability modifier: ⌊(score − 10) / 2⌋ */
export function getAbilityModifier(score: number): number {
  return Math.floor((score - 10) / 2);
}

/**
 * Proficiency bonus by level (D&D 5e-style).
 * Levels 1–4 → +2, 5–8 → +3, 9–12 → +4, etc.
 */
export function getProficiencyBonus(level: number): number {
  return Math.ceil(level / 4) + 1;
}

export function getSkillModifier(stats: CharacterStats, skill: Skill): number {
  const ability    = SKILL_ABILITY[skill];
  const abilityMod = getAbilityModifier(stats.abilityScores[ability]);
  const profBonus  = stats.skillProficiencies.includes(skill)
    ? getProficiencyBonus(stats.level)
    : 0;
  return abilityMod + profBonus;
}

export function getAttackBonus(stats: CharacterStats, weapon: Weapon): number {
  return (
    getAbilityModifier(stats.abilityScores[weapon.abilityScore]) +
    getProficiencyBonus(stats.level)
  );
}

// ─── Skill checks ─────────────────────────────────────────────────────────────

/**
 * Core check engine: d20 + modifier vs DC.
 *
 * Tier thresholds:
 *   crit_fail    — natural 1, OR margin ≤ −10
 *   fail         — missed DC (margin < 0)
 *   success      — met or beat DC (margin ≥ 0)
 *   crit_success — natural 20, OR margin ≥ 10
 */
export function rollSkillCheck(
  stats: CharacterStats,
  skill: Skill,
  dc: number
): SkillCheckResult {
  const d20      = rollDie(20);
  const modifier = getSkillModifier(stats, skill);
  const total    = d20 + modifier;
  const margin   = total - dc;

  let tier: CheckTier;
  if      (d20 === 1  || margin <= -10) tier = "crit_fail";
  else if (margin < 0)                  tier = "fail";
  else if (d20 === 20 || margin >= 10)  tier = "crit_success";
  else                                  tier = "success";

  return {
    roll: { die: 20, result: d20, modifier, total },
    dc,
    margin,
    tier,
    skill,
    wasProficient: stats.skillProficiencies.includes(skill),
  };
}

export function rollSavingThrow(
  stats: CharacterStats,
  ability: AbilityScore
): DiceRoll {
  const d20        = rollDie(20);
  const abilityMod = getAbilityModifier(stats.abilityScores[ability]);
  const profBonus  = stats.savingThrowProficiencies.includes(ability)
    ? getProficiencyBonus(stats.level)
    : 0;
  const modifier   = abilityMod + profBonus;
  return { die: 20, result: d20, modifier, total: d20 + modifier };
}

// ─── Combat rolls ─────────────────────────────────────────────────────────────

export function rollInitiative(
  stats: CharacterStats,
  entityId: string
): InitiativeResult {
  const d20      = rollDie(20);
  const modifier = getAbilityModifier(stats.abilityScores["dex"]);
  const total    = d20 + modifier;
  return { entityId, roll: { die: 20, result: d20, modifier, total }, total };
}

/** Advantage state for an attack roll (5e-style: roll two d20, keep one). */
export type RollEdge = "normal" | "advantage" | "disadvantage";

/**
 * Attack roll: d20 + proficiency + ability modifier vs target AC.
 * Natural 20 always hits and doubles damage dice.
 * Natural 1 always misses.
 * With advantage/disadvantage, two d20 are rolled and the higher/lower kept.
 */
export function rollAttack(
  attackerStats: CharacterStats,
  targetAC: number,
  weapon: Weapon,
  edge: RollEdge = "normal"
): AttackResult {
  let d20 = rollDie(20);
  if (edge !== "normal") {
    const second = rollDie(20);
    d20 = edge === "advantage" ? Math.max(d20, second) : Math.min(d20, second);
  }
  const attackBonus = getAttackBonus(attackerStats, weapon);
  const total       = d20 + attackBonus;
  const crit        = d20 === 20;
  const fumble      = d20 === 1;
  const hit         = !fumble && (crit || total >= targetAC);

  let damage: DamageResult | undefined;
  if (hit) {
    // Critical hit: double the number of dice rolled
    const dice = crit
      ? weapon.damageDice.replace(/^(\d+)/, n => String(parseInt(n) * 2))
      : weapon.damageDice;
    const abilityMod = getAbilityModifier(attackerStats.abilityScores[weapon.abilityScore]);
    const baseRoll   = rollDice(dice);
    damage = {
      dice,
      baseRoll,
      modifier: abilityMod,
      total:    Math.max(1, baseRoll + abilityMod),
    };
  }

  return {
    roll: { die: 20, result: d20, modifier: attackBonus, total },
    targetAC,
    hit,
    crit,
    // Omit `damage` entirely on a miss (exactOptionalPropertyTypes).
    ...(damage && { damage }),
  };
}

// ─── Healing / ability resolution ─────────────────────────────────────────────

/**
 * Resolves heal dice that contain token references.
 * Supported: +level, +wis, +str, +cha, +int, +dex, +con
 * Example: "1d8+wis" with WIS 16 → "1d8+3"
 */
export function resolveHealingDice(
  dice: string,
  stats: CharacterStats
): number {
  const resolved = dice
    .replace("+level", `+${stats.level}`)
    .replace("+wis",   `+${getAbilityModifier(stats.abilityScores["wis"])}`)
    .replace("+str",   `+${getAbilityModifier(stats.abilityScores["str"])}`)
    .replace("+cha",   `+${getAbilityModifier(stats.abilityScores["cha"])}`)
    .replace("+int",   `+${getAbilityModifier(stats.abilityScores["int"])}`)
    .replace("+dex",   `+${getAbilityModifier(stats.abilityScores["dex"])}`)
    .replace("+con",   `+${getAbilityModifier(stats.abilityScores["con"])}`);
  return Math.max(1, rollDice(resolved));
}

/** Returns 1d4 burn tick damage for the burning condition. */
export function rollBurnDamage(): number {
  return rollDie(4);
}
