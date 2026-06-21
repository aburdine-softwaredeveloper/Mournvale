/**
 * character.ts — Combat & skill stats for every character class
 *
 * Defines the runtime stat system that sits on top of the cosmetic
 * CharacterData (name/gender/class/hair/glasses). These types power
 * Phase 1 (skills), Phase 2 (NPC dialogue checks), and Phase 3 (combat).
 *
 * CharacterClass is intentionally re-declared here so this module
 * stays free of circular dependencies — the string values are identical
 * to the CharacterClass union in network.ts and are interchangeable via
 * TypeScript structural typing.
 */

// ─── Character classes ────────────────────────────────────────────────────────

export const CHARACTER_CLASSES = [
  "Knight", "Healer", "Warrior", "Monk", "Mage", "Thief", "Archer",
] as const;
export type CharacterClass = (typeof CHARACTER_CLASSES)[number];

// ─── Ability scores ───────────────────────────────────────────────────────────

export const ABILITY_SCORE_NAMES = ["str", "dex", "con", "int", "wis", "cha"] as const;
export type AbilityScore = (typeof ABILITY_SCORE_NAMES)[number];

// ─── Skills ───────────────────────────────────────────────────────────────────

export const SKILL_NAMES = [
  "athletics",     // STR
  "acrobatics",    // DEX
  "stealth",       // DEX
  "arcana",        // INT
  "investigation", // INT
  "insight",       // WIS
  "perception",    // WIS
  "deception",     // CHA
  "intimidation",  // CHA
  "persuasion",    // CHA
] as const;
export type Skill = (typeof SKILL_NAMES)[number];

export const SKILL_ABILITY: Record<Skill, AbilityScore> = {
  athletics:    "str",
  acrobatics:   "dex",
  stealth:      "dex",
  arcana:       "int",
  investigation:"int",
  insight:      "wis",
  perception:   "wis",
  deception:    "cha",
  intimidation: "cha",
  persuasion:   "cha",
};

// ─── Conditions ───────────────────────────────────────────────────────────────

export type Condition = "poisoned" | "stunned" | "blinded" | "prone" | "burning";

// ─── Weapons ──────────────────────────────────────────────────────────────────

export interface Weapon {
  id: string;
  name: string;
  /** Dice notation, e.g. "1d8", "2d6", "1d4+1" */
  damageDice: string;
  /** Tile range (1 = melee only, >1 = ranged Manhattan distance) */
  range: number;
  /** Which ability score drives the attack and damage rolls */
  abilityScore: AbilityScore;
}

// ─── Class abilities ──────────────────────────────────────────────────────────

export interface AbilityEffect {
  damage?: string;       // e.g. "2d6"
  heal?: string;         // e.g. "1d8+wis" — tokens +level/+wis/etc. resolved at runtime
  extraAttack?: boolean; // grants a second attack this turn
  condition?: Condition; // applies a condition to the target on hit
}

export interface ClassAbility {
  id: string;
  name: string;
  description: string;
  type: "passive" | "active";
  targetType?: "self" | "enemy" | "ally";
  /** 0 = at-will, >0 = limited use per session */
  cooldownRounds: number;
  combatOnly: boolean;
  effect: AbilityEffect;
}

// ─── Stat tables by class ─────────────────────────────────────────────────────

export const CLASS_BASE_ABILITY_SCORES: Record<CharacterClass, Record<AbilityScore, number>> = {
  Knight:  { str: 16, dex: 10, con: 14, int: 10, wis: 12, cha: 12 },
  Healer:  { str: 10, dex: 10, con: 12, int: 12, wis: 16, cha: 14 },
  Warrior: { str: 16, dex: 12, con: 14, int: 10, wis: 10, cha: 10 },
  Monk:    { str: 12, dex: 14, con: 12, int: 10, wis: 16, cha: 10 },
  Mage:    { str: 8,  dex: 14, con: 10, int: 16, wis: 12, cha: 12 },
  Thief:   { str: 10, dex: 16, con: 12, int: 12, wis: 12, cha: 14 },
  Archer:  { str: 12, dex: 16, con: 12, int: 12, wis: 14, cha: 10 },
};

export const CLASS_SKILL_PROFICIENCIES: Record<CharacterClass, Skill[]> = {
  Knight:  ["athletics", "intimidation"],
  Healer:  ["insight", "perception"],
  Warrior: ["athletics", "intimidation"],
  Monk:    ["acrobatics", "insight"],
  Mage:    ["arcana", "investigation"],
  Thief:   ["stealth", "deception", "acrobatics"],
  Archer:  ["perception", "stealth", "athletics"],
};

export const CLASS_SAVING_THROWS: Record<CharacterClass, AbilityScore[]> = {
  Knight:  ["str", "con"],
  Healer:  ["wis", "cha"],
  Warrior: ["str", "con"],
  Monk:    ["str", "dex"],
  Mage:    ["int", "wis"],
  Thief:   ["dex", "int"],
  Archer:  ["str", "dex"],
};

export const CLASS_BASE_AC: Record<CharacterClass, number> = {
  Knight:  17, // plate
  Healer:  13, // light
  Warrior: 15, // chainmail
  Monk:    14, // unarmored defense
  Mage:    11, // robes
  Thief:   13, // leather
  Archer:  14, // scale
};

export const CLASS_DEFAULT_WEAPONS: Record<CharacterClass, Weapon> = {
  Knight:  { id: "longsword",    name: "Longsword",     damageDice: "1d8", range: 1, abilityScore: "str" },
  Healer:  { id: "mace",         name: "Mace",          damageDice: "1d6", range: 1, abilityScore: "str" },
  Warrior: { id: "battleaxe",    name: "Battleaxe",     damageDice: "1d8", range: 1, abilityScore: "str" },
  Monk:    { id: "unarmed",      name: "Unarmed Strike", damageDice: "1d6", range: 1, abilityScore: "dex" },
  Mage:    { id: "arcane_bolt",  name: "Arcane Bolt",   damageDice: "1d6", range: 4, abilityScore: "int" },
  Thief:   { id: "short_sword",  name: "Short Sword",   damageDice: "1d6", range: 1, abilityScore: "dex" },
  Archer:  { id: "longbow",      name: "Longbow",       damageDice: "1d8", range: 6, abilityScore: "dex" },
};

export const CLASS_ABILITIES: Record<CharacterClass, ClassAbility[]> = {
  Knight: [
    {
      id: "shield_bash", name: "Shield Bash",
      description: "Strike with your shield — target must make a STR save or be stunned for one round.",
      type: "active", targetType: "enemy",
      cooldownRounds: 3, combatOnly: true,
      effect: { damage: "1d4", condition: "stunned" },
    },
    {
      id: "second_wind", name: "Second Wind",
      description: "Rally yourself and recover 1d10 + level HP.",
      type: "active", targetType: "self",
      cooldownRounds: 5, combatOnly: false,
      effect: { heal: "1d10+level" },
    },
  ],
  Healer: [
    {
      id: "healing_word", name: "Healing Word",
      description: "Restore 1d8 + WIS modifier HP to an ally.",
      type: "active", targetType: "ally",
      cooldownRounds: 3, combatOnly: false,
      effect: { heal: "1d8+wis" },
    },
    {
      id: "sacred_flame", name: "Sacred Flame",
      description: "Radiant energy washes over the target: 1d8 radiant damage on a failed DEX save.",
      type: "active", targetType: "enemy",
      cooldownRounds: 0, combatOnly: true,
      effect: { damage: "1d8" },
    },
  ],
  Warrior: [
    {
      id: "reckless_attack", name: "Reckless Attack",
      description: "Attack with wild abandon — roll twice and take the higher result, but enemies also gain advantage against you until your next turn.",
      type: "active", targetType: "enemy",
      cooldownRounds: 1, combatOnly: true,
      effect: { extraAttack: true },
    },
    {
      id: "second_wind", name: "Second Wind",
      description: "Catch your breath and recover 1d10 + level HP.",
      type: "active", targetType: "self",
      cooldownRounds: 5, combatOnly: false,
      effect: { heal: "1d10+level" },
    },
  ],
  Monk: [
    {
      id: "stunning_strike", name: "Stunning Strike",
      description: "Channel your ki — target makes a CON save or is stunned until your next turn.",
      type: "active", targetType: "enemy",
      cooldownRounds: 3, combatOnly: true,
      effect: { condition: "stunned" },
    },
    {
      id: "patient_defense", name: "Patient Defense",
      description: "Assume a defensive stance, halving the next hit you take this round.",
      type: "active", targetType: "self",
      cooldownRounds: 1, combatOnly: true,
      effect: {},
    },
  ],
  Mage: [
    {
      id: "magic_missile", name: "Magic Missile",
      description: "Three darts of pure force, each dealing 1d4+1 damage. Always hits.",
      type: "active", targetType: "enemy",
      cooldownRounds: 3, combatOnly: true,
      effect: { damage: "1d4+1" },  // applied ×3
    },
    {
      id: "fire_bolt", name: "Fire Bolt",
      description: "1d10 fire damage. On hit, the target may begin burning.",
      type: "active", targetType: "enemy",
      cooldownRounds: 0, combatOnly: true,
      effect: { damage: "1d10", condition: "burning" },
    },
  ],
  Thief: [
    {
      id: "sneak_attack", name: "Sneak Attack",
      description: "+2d6 damage when an ally is adjacent to your target or you have advantage.",
      type: "passive",
      cooldownRounds: 0, combatOnly: false,
      effect: { damage: "2d6" },
    },
    {
      id: "cunning_action", name: "Cunning Action",
      description: "Dash as a free action this turn, doubling your movement range.",
      type: "active",
      cooldownRounds: 1, combatOnly: true,
      effect: {},
    },
  ],
  Archer: [
    {
      id: "hunters_mark", name: "Hunter's Mark",
      description: "Mark a target — deal +1d6 damage on all attacks against it this combat.",
      type: "active", targetType: "enemy",
      cooldownRounds: 3, combatOnly: false,
      effect: { damage: "1d6" },
    },
    {
      id: "volley", name: "Volley",
      description: "Rain arrows on an area — attack every enemy within 2 tiles of your target.",
      type: "active", targetType: "enemy",
      cooldownRounds: 3, combatOnly: true,
      effect: { damage: "1d6" },
    },
  ],
};

// ─── CharacterStats ───────────────────────────────────────────────────────────

/**
 * Full combat + skill stat block for a character. Built from their class
 * and level; would eventually incorporate equipment and persistent
 * progression. Currently constructed fresh from class defaults each session.
 */
export interface CharacterStats {
  abilityScores: Record<AbilityScore, number>;
  skillProficiencies: Skill[];
  savingThrowProficiencies: AbilityScore[];
  classAbilities: ClassAbility[];
  /** Remaining uses keyed by abilityId; 0 = on cooldown */
  abilityUses: Record<string, number>;
  ac: number;
  /** Tiles of movement per turn in combat */
  speed: number;
  equippedWeapon: Weapon;
  conditions: Condition[];
  level: number;
}

/**
 * Build default stats for a character of the given class and level.
 * Called at login/spawn; will eventually layer in saved gear + XP.
 */
export function buildCharacterStats(
  charClass: CharacterClass,
  level = 1
): CharacterStats {
  const abilities = CLASS_ABILITIES[charClass];
  return {
    abilityScores:           { ...CLASS_BASE_ABILITY_SCORES[charClass] },
    skillProficiencies:      [...CLASS_SKILL_PROFICIENCIES[charClass]],
    savingThrowProficiencies:[...CLASS_SAVING_THROWS[charClass]],
    classAbilities:          abilities,
    abilityUses:             Object.fromEntries(
      abilities
        .filter(a => a.type === "active" && a.cooldownRounds > 0)
        .map(a => [a.id, 1])
    ),
    ac:             CLASS_BASE_AC[charClass],
    speed:          4,
    equippedWeapon: CLASS_DEFAULT_WEAPONS[charClass],
    conditions:     [],
    level,
  };
}
