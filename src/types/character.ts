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
  /**
   * Tile range (Manhattan) at which this ability can reach a target. Optional —
   * see abilityRange() for the default (self abilities ignore range; offensive
   * abilities default to your weapon's reach; support defaults to a short throw).
   * Set explicitly only when an ability's reach differs from that default, e.g. a
   * ranged spell cast by a melee-weapon class.
   */
  range?: number;
  /** 0 = at-will, >0 = limited use per session */
  cooldownRounds: number;
  combatOnly: boolean;
  effect: AbilityEffect;
  /**
   * Baseline abilities are granted to every character of this class from
   * level 1 and occupy ability slots by default. Non-baseline abilities are
   * locked until a talent node unlocks them (see talents.ts), after which the
   * player may slot them — potentially replacing a baseline. The talent tree
   * never duplicates these; it references them by id.
   */
  baseline?: boolean;
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

/**
 * Per-class ability pools. The first two entries of each class are flagged
 * `baseline: true` — always granted and slotted from level 1. The remaining
 * entries are talent-locked (unlocked by `unlock_ability` nodes in talents.ts)
 * and can be swapped into the character's ability slots once learned.
 *
 * Scaling: add a new ability by appending an entry here and pointing a talent
 * node at its id. Nothing else needs to change — the slot system, the known-
 * ability list, and combat all read from this single source.
 */
export const CLASS_ABILITIES: Record<CharacterClass, ClassAbility[]> = {
  Knight: [
    {
      id: "shield_bash", name: "Shield Bash",
      description: "Strike with your shield — target must make a STR save or be stunned for one round.",
      type: "active", targetType: "enemy",
      cooldownRounds: 3, combatOnly: true,
      effect: { damage: "1d4", condition: "stunned" }, baseline: true,
    },
    {
      id: "second_wind", name: "Second Wind",
      description: "Rally yourself and recover 1d10 + level HP.",
      type: "active", targetType: "self",
      cooldownRounds: 5, combatOnly: false,
      effect: { heal: "1d10+level" }, baseline: true,
    },
    {
      id: "guardian_strike", name: "Guardian Strike",
      description: "A heavy blow that dares your foe to look away: 1d8 damage and the target is marked, drawing its ire.",
      type: "active", targetType: "enemy",
      cooldownRounds: 2, combatOnly: true,
      effect: { damage: "1d8" },
    },
    {
      id: "shield_wall", name: "Shield Wall",
      description: "Raise your shield and brace — halve all damage you take until your next turn.",
      type: "active", targetType: "self",
      cooldownRounds: 3, combatOnly: true,
      effect: {},
    },
    {
      id: "valiant_charge", name: "Valiant Charge",
      description: "Surge forward with momentum: 2d6 damage and an immediate second attack.",
      type: "active", targetType: "enemy",
      cooldownRounds: 4, combatOnly: true,
      effect: { damage: "2d6", extraAttack: true },
    },
  ],
  Healer: [
    {
      id: "healing_word", name: "Healing Word",
      description: "Restore 1d8 + WIS modifier HP to an ally.",
      type: "active", targetType: "ally",
      cooldownRounds: 3, combatOnly: false,
      effect: { heal: "1d8+wis" }, baseline: true,
    },
    {
      id: "sacred_flame", name: "Sacred Flame",
      description: "Radiant energy washes over the target: 1d8 radiant damage on a failed DEX save.",
      type: "active", targetType: "enemy", range: 5,
      cooldownRounds: 0, combatOnly: true,
      effect: { damage: "1d8" }, baseline: true,
    },
    {
      id: "cure_wounds", name: "Cure Wounds",
      description: "A potent touch restoring 2d8 + WIS HP to an ally.",
      type: "active", targetType: "ally", range: 1,
      cooldownRounds: 4, combatOnly: false,
      effect: { heal: "2d8+wis" },
    },
    {
      id: "guiding_bolt", name: "Guiding Bolt",
      description: "A lance of light: 4d6 radiant damage to a single foe.",
      type: "active", targetType: "enemy", range: 6,
      cooldownRounds: 3, combatOnly: true,
      effect: { damage: "4d6" },
    },
    {
      id: "purifying_light", name: "Purifying Light",
      description: "Wash an ally in warmth — heal 1d8 + WIS and cleanse poison and burning.",
      type: "active", targetType: "ally",
      cooldownRounds: 4, combatOnly: false,
      effect: { heal: "1d8+wis" },
    },
  ],
  Warrior: [
    {
      id: "reckless_attack", name: "Reckless Attack",
      description: "Attack with wild abandon — roll twice and take the higher result, but enemies also gain advantage against you until your next turn.",
      type: "active", targetType: "enemy",
      cooldownRounds: 1, combatOnly: true,
      effect: { extraAttack: true }, baseline: true,
    },
    {
      id: "second_wind", name: "Second Wind",
      description: "Catch your breath and recover 1d10 + level HP.",
      type: "active", targetType: "self",
      cooldownRounds: 5, combatOnly: false,
      effect: { heal: "1d10+level" }, baseline: true,
    },
    {
      id: "cleave", name: "Cleave",
      description: "A sweeping strike biting deep for 1d12 damage.",
      type: "active", targetType: "enemy",
      cooldownRounds: 2, combatOnly: true,
      effect: { damage: "1d12" },
    },
    {
      id: "battle_cry", name: "Battle Cry",
      description: "Roar a challenge — steel your nerves and strike with renewed fury (extra attack this turn).",
      type: "active", targetType: "self",
      cooldownRounds: 3, combatOnly: true,
      effect: { extraAttack: true },
    },
    {
      id: "whirlwind", name: "Whirlwind",
      description: "Spin through the fray, dealing 2d6 to your target and any enemy beside it.",
      type: "active", targetType: "enemy",
      cooldownRounds: 4, combatOnly: true,
      effect: { damage: "2d6" },
    },
  ],
  Monk: [
    {
      id: "stunning_strike", name: "Stunning Strike",
      description: "Channel your ki — target makes a CON save or is stunned until your next turn.",
      type: "active", targetType: "enemy",
      cooldownRounds: 3, combatOnly: true,
      effect: { condition: "stunned" }, baseline: true,
    },
    {
      id: "patient_defense", name: "Patient Defense",
      description: "Assume a defensive stance, halving the next hit you take this round.",
      type: "active", targetType: "self",
      cooldownRounds: 1, combatOnly: true,
      effect: {}, baseline: true,
    },
    {
      id: "flurry_of_blows", name: "Flurry of Blows",
      description: "Two rapid strikes flow from your stance — make a second attack this turn.",
      type: "active", targetType: "enemy",
      cooldownRounds: 2, combatOnly: true,
      effect: { extraAttack: true },
    },
    {
      id: "step_of_the_wind", name: "Step of the Wind",
      description: "Flow like air — dash a free extra distance and slip past reach this turn.",
      type: "active", targetType: "self",
      cooldownRounds: 2, combatOnly: true,
      effect: {},
    },
    {
      id: "quivering_palm", name: "Quivering Palm",
      description: "A focused ki strike: 3d6 damage and the target is stunned on a failed save.",
      type: "active", targetType: "enemy",
      cooldownRounds: 5, combatOnly: true,
      effect: { damage: "3d6", condition: "stunned" },
    },
  ],
  Mage: [
    {
      id: "magic_missile", name: "Magic Missile",
      description: "Three darts of pure force, each dealing 1d4+1 damage. Always hits.",
      type: "active", targetType: "enemy",
      cooldownRounds: 3, combatOnly: true,
      effect: { damage: "1d4+1" }, baseline: true,  // applied ×3
    },
    {
      id: "fire_bolt", name: "Fire Bolt",
      description: "1d10 fire damage. On hit, the target may begin burning.",
      type: "active", targetType: "enemy",
      cooldownRounds: 0, combatOnly: true,
      effect: { damage: "1d10", condition: "burning" }, baseline: true,
    },
    {
      id: "frost_ray", name: "Frost Ray",
      description: "A beam of biting cold: 2d8 damage that slows the target.",
      type: "active", targetType: "enemy",
      cooldownRounds: 2, combatOnly: true,
      effect: { damage: "2d8" },
    },
    {
      id: "arcane_shield", name: "Arcane Shield",
      description: "Weave a barrier of force, halving the next hit against you this round.",
      type: "active", targetType: "self",
      cooldownRounds: 3, combatOnly: true,
      effect: {},
    },
    {
      id: "fireball", name: "Fireball",
      description: "A roaring blast: 6d6 fire damage to the target and everything around it; survivors burn.",
      type: "active", targetType: "enemy", range: 6,
      cooldownRounds: 5, combatOnly: true,
      effect: { damage: "6d6", condition: "burning" },
    },
  ],
  Thief: [
    {
      id: "sneak_attack", name: "Sneak Attack",
      description: "+2d6 damage when an ally is adjacent to your target or you have advantage.",
      type: "passive",
      cooldownRounds: 0, combatOnly: false,
      effect: { damage: "2d6" }, baseline: true,
    },
    {
      id: "cunning_action", name: "Cunning Action",
      description: "Dash as a free action this turn, doubling your movement range.",
      type: "active",
      cooldownRounds: 1, combatOnly: true,
      effect: {}, baseline: true,
    },
    {
      id: "poison_blade", name: "Poison Blade",
      description: "Coat your blade — 1d6 damage and the target is poisoned.",
      type: "active", targetType: "enemy",
      cooldownRounds: 2, combatOnly: true,
      effect: { damage: "1d6", condition: "poisoned" },
    },
    {
      id: "vanish", name: "Vanish",
      description: "Melt into the shadows, halving the next hit against you and setting up your next strike.",
      type: "active", targetType: "self",
      cooldownRounds: 3, combatOnly: true,
      effect: {},
    },
    {
      id: "backstab", name: "Backstab",
      description: "A precise killing thrust for 3d6 damage when you catch a foe unaware.",
      type: "active", targetType: "enemy",
      cooldownRounds: 4, combatOnly: true,
      effect: { damage: "3d6" },
    },
  ],
  Archer: [
    {
      id: "hunters_mark", name: "Hunter's Mark",
      description: "Mark a target — deal +1d6 damage on all attacks against it this combat.",
      type: "active", targetType: "enemy",
      cooldownRounds: 3, combatOnly: false,
      effect: { damage: "1d6" }, baseline: true,
    },
    {
      id: "volley", name: "Volley",
      description: "Rain arrows on an area — attack every enemy within 2 tiles of your target.",
      type: "active", targetType: "enemy",
      cooldownRounds: 3, combatOnly: true,
      effect: { damage: "1d6" }, baseline: true,
    },
    {
      id: "piercing_shot", name: "Piercing Shot",
      description: "Draw fully and loose a bodkin: 2d8 damage that ignores cover.",
      type: "active", targetType: "enemy",
      cooldownRounds: 2, combatOnly: true,
      effect: { damage: "2d8" },
    },
    {
      id: "evasive_roll", name: "Evasive Roll",
      description: "Tumble clear — halve the next hit against you and reposition this turn.",
      type: "active", targetType: "self",
      cooldownRounds: 3, combatOnly: true,
      effect: {},
    },
    {
      id: "rapid_fire", name: "Rapid Fire",
      description: "Loose a second arrow this turn in a blur of motion.",
      type: "active", targetType: "enemy",
      cooldownRounds: 4, combatOnly: true,
      effect: { extraAttack: true },
    },
  ],
};

// ─── Ability lookup helpers ────────────────────────────────────────────────────

/** Every ability defined for a class, keyed by id, across the whole pool. */
export function abilityById(
  charClass: CharacterClass,
  abilityId: string
): ClassAbility | undefined {
  return CLASS_ABILITIES[charClass].find(a => a.id === abilityId);
}

/**
 * The ids a class is granted from level 1 — the abilities flagged `baseline`.
 * These seed a new character's ability slots (see newProgression in
 * progression.ts) and are always considered "known" regardless of talents.
 */
export function baselineAbilityIds(charClass: CharacterClass): string[] {
  return CLASS_ABILITIES[charClass].filter(a => a.baseline).map(a => a.id);
}

/** Default reach for support abilities with no explicit `range` (a short throw). */
export const DEFAULT_SUPPORT_RANGE = 6;

/**
 * The tile range at which an ability can reach a target. Single source of truth
 * for both the server's range gate and the client's range shading, so they never
 * disagree:
 *   - self abilities ignore range entirely (they target the caster) → Infinity.
 *   - an explicit `range` always wins.
 *   - offensive (enemy) abilities default to the caster's WEAPON reach, so a
 *     melee class throws its strikes 1 tile and an archer/mage reaches further.
 *   - support (ally) abilities default to a short throw (DEFAULT_SUPPORT_RANGE).
 */
export function abilityRange(
  ability: Pick<ClassAbility, "range" | "targetType">,
  weaponRange: number
): number {
  if (ability.targetType === "self" || ability.targetType === undefined) return Infinity;
  if (ability.range !== undefined) return ability.range;
  if (ability.targetType === "ally") return DEFAULT_SUPPORT_RANGE;
  return weaponRange;
}

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
