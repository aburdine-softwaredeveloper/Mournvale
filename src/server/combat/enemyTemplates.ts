/**
 * enemyTemplates.ts — Data-driven monster roster
 *
 * The old combat engine built EVERY enemy from a level-1 Warrior stat block and
 * only overrode HP/AC. That made "rats" swing a battleaxe with a trained
 * warrior's +5 to hit and 1d8+3 damage — three of them could kill a solo
 * level-1 player long before the player ground through their 60 combined HP.
 * The first quest was, by the numbers, unwinnable.
 *
 * This module replaces that with a proper monster roster. Each template carries
 * its OWN weapon, ability scores (which drive to-hit and damage modifiers), HP,
 * AC, speed, and XP value, so a rat bites for 1d3 and a fog-boss hits like a
 * boss. Encounters are now tuned per-creature, and the difficulty ladder
 * (vermin → wolves → fog-spawn → the Fogmother) is expressed as data here.
 *
 * To add a monster: append an entry. To re-tune balance: edit the numbers.
 * Nothing in CombatManager needs to change — it reads everything from here.
 */

import type { AbilityScore, CharacterStats, Weapon, Condition } from "../../types/character";

/** A single authored monster archetype. */
export interface EnemyTemplate {
  /** Stable lookup key referenced by hostile NPC definitions. */
  key: string;
  /** Display name fallback (the spawning NPC's name usually wins). */
  name: string;
  /** Narrative difficulty tier — used to order the ladder, 0 = weakest. */
  tier: number;
  hp: number;
  ac: number;
  /** Tiles of movement per combat turn. */
  speed: number;
  weapon: Weapon;
  /**
   * Only the scores that matter for combat need supplying; the rest default to
   * 10 (a +0 modifier). The weapon's `abilityScore` drives both to-hit and
   * damage, so that one matters most.
   */
  abilityScores?: Partial<Record<AbilityScore, number>>;
  /** XP awarded to the party for defeating one of these. */
  xp: number;
  /** Optional condition this creature's bite/claw inflicts on a hit. */
  inflicts?: Condition;
}

function weapon(
  id: string,
  name: string,
  damageDice: string,
  range: number,
  abilityScore: AbilityScore
): Weapon {
  return { id, name, damageDice, range, abilityScore };
}

/**
 * The monster roster, keyed for lookup. Tiers form the intended quest ladder:
 *   0  cellar vermin (the tutorial fight — must be an easy win)
 *   1  pack predators on the fog line
 *   2  bandits / desperate folk
 *   3  fog-touched horrors
 *   9  the Fogmother — the capstone boss
 */
export const ENEMY_TEMPLATES: Record<string, EnemyTemplate> = {
  // ── Tier 0 — Cellar Vermin (the tutorial; deliberately gentle) ──
  rat: {
    key: "rat", name: "Cellar Rat", tier: 0,
    hp: 5, ac: 11, speed: 3,
    weapon: weapon("rat_bite", "Bite", "1d3", 1, "str"),
    abilityScores: { str: 8, dex: 12, con: 8 },
    xp: 12,
  },
  rat_bold: {
    key: "rat_bold", name: "Bold Rat", tier: 0,
    hp: 12, ac: 12, speed: 3,
    weapon: weapon("rat_bite_big", "Gnashing Bite", "1d4", 1, "str"),
    abilityScores: { str: 12, dex: 12, con: 12 },
    xp: 30,
  },

  // ── Tier 1 — Fog-line predators ──
  fog_wolf: {
    key: "fog_wolf", name: "Fog-Wolf", tier: 1,
    hp: 10, ac: 12, speed: 5,
    weapon: weapon("wolf_bite", "Savage Bite", "1d6", 1, "str"),
    abilityScores: { str: 11, dex: 14, con: 12 },
    xp: 45,
  },
  fog_wolf_alpha: {
    key: "fog_wolf_alpha", name: "Pack Alpha", tier: 1,
    hp: 18, ac: 12, speed: 5,
    weapon: weapon("alpha_bite", "Crushing Bite", "1d6", 1, "str"),
    abilityScores: { str: 13, dex: 14, con: 14 },
    xp: 80,
  },

  // ── Tier 2 — Desperate folk ──
  bandit: {
    key: "bandit", name: "Road Bandit", tier: 2,
    hp: 16, ac: 13, speed: 4,
    weapon: weapon("bandit_sword", "Notched Sword", "1d6", 1, "str"),
    abilityScores: { str: 12, dex: 13, con: 12 },
    xp: 55,
  },

  // ── Tier 3 — Fog-touched horrors ──
  ghoul: {
    key: "ghoul", name: "Greyfall Ghoul", tier: 3,
    hp: 22, ac: 12, speed: 4,
    weapon: weapon("ghoul_claws", "Rotting Claws", "1d6", 1, "str"),
    abilityScores: { str: 14, dex: 12, con: 14 },
    xp: 75, inflicts: "poisoned",
  },
  shade: {
    key: "shade", name: "Fog Shade", tier: 3,
    hp: 18, ac: 13, speed: 4,
    weapon: weapon("shade_touch", "Chilling Touch", "1d6", 3, "dex"),
    abilityScores: { str: 10, dex: 16, con: 12 },
    xp: 75,
  },
  wraith: {
    key: "wraith", name: "Hollow Wraith", tier: 3,
    hp: 30, ac: 14, speed: 4,
    weapon: weapon("wraith_drain", "Life Drain", "1d8", 2, "dex"),
    abilityScores: { str: 12, dex: 16, con: 14 },
    xp: 130,
  },

  // ── Tier 9 — The capstone boss ──
  fog_boss: {
    key: "fog_boss", name: "The Fogmother", tier: 9,
    hp: 90, ac: 15, speed: 4,
    weapon: weapon("fog_lash", "Tendril Lash", "2d6", 2, "str"),
    abilityScores: { str: 18, dex: 14, con: 18 },
    xp: 400, inflicts: "blinded",
  },
};

/** Safe lookup — returns the rat (weakest) if a bad key is referenced. */
export function getEnemyTemplate(key: string | undefined): EnemyTemplate {
  return (key && ENEMY_TEMPLATES[key]) || ENEMY_TEMPLATES.rat!;
}

/**
 * Builds the full ability-score block for a template, filling any unspecified
 * score with 10 (a +0 modifier). Kept here so CombatManager doesn't need to
 * know the template's internal shape.
 */
export function templateAbilityScores(
  t: EnemyTemplate
): CharacterStats["abilityScores"] {
  const base = { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 };
  return { ...base, ...t.abilityScores };
}
