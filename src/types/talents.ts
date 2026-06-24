/**
 * talents.ts — Per-class talent tree definitions
 *
 * Pure data, mirroring the CLASS_ABILITIES / CLASS_BASE_AC style in character.ts.
 * Every `unlock_ability` / `rank_ability` reward references a real ability id
 * from CLASS_ABILITIES, so the talent tree, the known-ability list, and combat
 * all stay in sync from one source.
 *
 * Adding a class or talent = adding data here. No renderer or engine changes.
 * Node `pos` is a {col,row} grid cell consumed only by the client tree layout.
 *
 * The numbers below are deliberately conservative starter values — tune costs,
 * maxRanks, and passive magnitudes to taste; the structure is what matters.
 */

import type { CharacterClass } from "./character";
import type { TalentTree } from "./progression";

/**
 * Talent trees follow a shared 5-node shape so the client can lay them out on a
 * 3-column grid uniformly:
 *
 *        [ root passive ]        (row 0, col 1)
 *      [ unlock A ] [ unlock B ] (row 1, cols 0 & 2)
 *        [ mid passive ]         (row 2, col 1)  — gated behind A & B
 *        [ capstone unlock ]     (row 3, col 1)  — the class's signature ability
 *
 * Baseline abilities (Shield Bash, Second Wind, …) are NOT in the tree — every
 * character has those from level 1. The `unlock_ability` nodes here grant the
 * *additional* abilities a player can then slot in their place.
 */
export const CLASS_TALENT_TREES: Record<CharacterClass, TalentTree> = {
  Knight: {
    class: "Knight",
    nodes: [
      { id: "kn_bulwark", name: "Bulwark", description: "+1 Constitution per rank.", maxRank: 3, cost: 1, pos: { col: 1, row: 0 }, requires: [], reward: { kind: "passive_stat", stat: "con", perRank: 1 } },
      { id: "kn_guardian", name: "Guardian Strike", description: "Unlock Guardian Strike — a marking blow that pulls aggro.", maxRank: 1, cost: 1, pos: { col: 0, row: 1 }, requires: [{ nodeId: "kn_bulwark", rank: 1 }], reward: { kind: "unlock_ability", abilityId: "guardian_strike" } },
      { id: "kn_shieldwall", name: "Shield Wall", description: "Unlock Shield Wall — halve incoming damage for a round.", maxRank: 1, cost: 1, pos: { col: 2, row: 1 }, requires: [{ nodeId: "kn_bulwark", rank: 1 }], reward: { kind: "unlock_ability", abilityId: "shield_wall" } },
      { id: "kn_unbreakable", name: "Unbreakable", description: "+8 HP per rank.", maxRank: 2, cost: 1, pos: { col: 1, row: 2 }, requires: [{ nodeId: "kn_guardian", rank: 1 }, { nodeId: "kn_shieldwall", rank: 1 }], reward: { kind: "passive_hp", perRank: 8 } },
      { id: "kn_valiant", name: "Valiant Charge", description: "Capstone: unlock Valiant Charge — a charging double strike.", maxRank: 1, cost: 2, pos: { col: 1, row: 3 }, requires: [{ nodeId: "kn_unbreakable", rank: 1 }], reward: { kind: "unlock_ability", abilityId: "valiant_charge" } },
    ],
  },

  Healer: {
    class: "Healer",
    nodes: [
      { id: "he_devotion", name: "Devotion", description: "+1 Wisdom per rank.", maxRank: 3, cost: 1, pos: { col: 1, row: 0 }, requires: [], reward: { kind: "passive_stat", stat: "wis", perRank: 1 } },
      { id: "he_cure_wounds", name: "Cure Wounds", description: "Unlock Cure Wounds — a stronger single-target heal.", maxRank: 1, cost: 1, pos: { col: 0, row: 1 }, requires: [{ nodeId: "he_devotion", rank: 1 }], reward: { kind: "unlock_ability", abilityId: "cure_wounds" } },
      { id: "he_guiding_bolt", name: "Guiding Bolt", description: "Unlock Guiding Bolt — burst radiant damage.", maxRank: 1, cost: 1, pos: { col: 2, row: 1 }, requires: [{ nodeId: "he_devotion", rank: 1 }], reward: { kind: "unlock_ability", abilityId: "guiding_bolt" } },
      { id: "he_radiance", name: "Radiance", description: "+6 HP per rank.", maxRank: 2, cost: 1, pos: { col: 1, row: 2 }, requires: [{ nodeId: "he_cure_wounds", rank: 1 }, { nodeId: "he_guiding_bolt", rank: 1 }], reward: { kind: "passive_hp", perRank: 6 } },
      { id: "he_purifying_light", name: "Purifying Light", description: "Capstone: unlock Purifying Light — heal and cleanse.", maxRank: 1, cost: 2, pos: { col: 1, row: 3 }, requires: [{ nodeId: "he_radiance", rank: 1 }], reward: { kind: "unlock_ability", abilityId: "purifying_light" } },
    ],
  },

  Warrior: {
    class: "Warrior",
    nodes: [
      { id: "wa_might", name: "Might", description: "+1 Strength per rank.", maxRank: 3, cost: 1, pos: { col: 1, row: 0 }, requires: [], reward: { kind: "passive_stat", stat: "str", perRank: 1 } },
      { id: "wa_cleave", name: "Cleave", description: "Unlock Cleave — a heavy 1d12 strike.", maxRank: 1, cost: 1, pos: { col: 0, row: 1 }, requires: [{ nodeId: "wa_might", rank: 1 }], reward: { kind: "unlock_ability", abilityId: "cleave" } },
      { id: "wa_battle_cry", name: "Battle Cry", description: "Unlock Battle Cry — rally for an extra attack.", maxRank: 1, cost: 1, pos: { col: 2, row: 1 }, requires: [{ nodeId: "wa_might", rank: 1 }], reward: { kind: "unlock_ability", abilityId: "battle_cry" } },
      { id: "wa_juggernaut", name: "Juggernaut", description: "+10 HP per rank.", maxRank: 2, cost: 1, pos: { col: 1, row: 2 }, requires: [{ nodeId: "wa_cleave", rank: 1 }, { nodeId: "wa_battle_cry", rank: 1 }], reward: { kind: "passive_hp", perRank: 10 } },
      { id: "wa_whirlwind", name: "Whirlwind", description: "Capstone: unlock Whirlwind — hit everything around your target.", maxRank: 1, cost: 2, pos: { col: 1, row: 3 }, requires: [{ nodeId: "wa_juggernaut", rank: 1 }], reward: { kind: "unlock_ability", abilityId: "whirlwind" } },
    ],
  },

  Monk: {
    class: "Monk",
    nodes: [
      { id: "mo_discipline", name: "Discipline", description: "+1 Dexterity per rank.", maxRank: 3, cost: 1, pos: { col: 1, row: 0 }, requires: [], reward: { kind: "passive_stat", stat: "dex", perRank: 1 } },
      { id: "mo_flurry", name: "Flurry of Blows", description: "Unlock Flurry of Blows — a bonus strike.", maxRank: 1, cost: 1, pos: { col: 0, row: 1 }, requires: [{ nodeId: "mo_discipline", rank: 1 }], reward: { kind: "unlock_ability", abilityId: "flurry_of_blows" } },
      { id: "mo_step_wind", name: "Step of the Wind", description: "Unlock Step of the Wind — mobility burst.", maxRank: 1, cost: 1, pos: { col: 2, row: 1 }, requires: [{ nodeId: "mo_discipline", rank: 1 }], reward: { kind: "unlock_ability", abilityId: "step_of_the_wind" } },
      { id: "mo_serenity", name: "Serenity", description: "+1 Wisdom per rank.", maxRank: 2, cost: 1, pos: { col: 1, row: 2 }, requires: [{ nodeId: "mo_flurry", rank: 1 }, { nodeId: "mo_step_wind", rank: 1 }], reward: { kind: "passive_stat", stat: "wis", perRank: 1 } },
      { id: "mo_quivering", name: "Quivering Palm", description: "Capstone: unlock Quivering Palm — heavy ki strike with stun.", maxRank: 1, cost: 2, pos: { col: 1, row: 3 }, requires: [{ nodeId: "mo_serenity", rank: 1 }], reward: { kind: "unlock_ability", abilityId: "quivering_palm" } },
    ],
  },

  Mage: {
    class: "Mage",
    nodes: [
      { id: "ma_arcana", name: "Arcane Focus", description: "+1 Intelligence per rank.", maxRank: 3, cost: 1, pos: { col: 1, row: 0 }, requires: [], reward: { kind: "passive_stat", stat: "int", perRank: 1 } },
      { id: "ma_frost_ray", name: "Frost Ray", description: "Unlock Frost Ray — chilling beam.", maxRank: 1, cost: 1, pos: { col: 0, row: 1 }, requires: [{ nodeId: "ma_arcana", rank: 1 }], reward: { kind: "unlock_ability", abilityId: "frost_ray" } },
      { id: "ma_arcane_shield", name: "Arcane Shield", description: "Unlock Arcane Shield — a defensive ward.", maxRank: 1, cost: 1, pos: { col: 2, row: 1 }, requires: [{ nodeId: "ma_arcana", rank: 1 }], reward: { kind: "unlock_ability", abilityId: "arcane_shield" } },
      { id: "ma_archmage", name: "Archmage", description: "+1 Intelligence per rank.", maxRank: 2, cost: 1, pos: { col: 1, row: 2 }, requires: [{ nodeId: "ma_frost_ray", rank: 1 }, { nodeId: "ma_arcane_shield", rank: 1 }], reward: { kind: "passive_stat", stat: "int", perRank: 1 } },
      { id: "ma_fireball", name: "Fireball", description: "Capstone: unlock Fireball — the signature blast.", maxRank: 1, cost: 2, pos: { col: 1, row: 3 }, requires: [{ nodeId: "ma_archmage", rank: 1 }], reward: { kind: "unlock_ability", abilityId: "fireball" } },
    ],
  },

  Thief: {
    class: "Thief",
    nodes: [
      { id: "th_finesse", name: "Finesse", description: "+1 Dexterity per rank.", maxRank: 3, cost: 1, pos: { col: 1, row: 0 }, requires: [], reward: { kind: "passive_stat", stat: "dex", perRank: 1 } },
      { id: "th_poison_blade", name: "Poison Blade", description: "Unlock Poison Blade — a venomous strike.", maxRank: 1, cost: 1, pos: { col: 0, row: 1 }, requires: [{ nodeId: "th_finesse", rank: 1 }], reward: { kind: "unlock_ability", abilityId: "poison_blade" } },
      { id: "th_vanish", name: "Vanish", description: "Unlock Vanish — slip into the shadows.", maxRank: 1, cost: 1, pos: { col: 2, row: 1 }, requires: [{ nodeId: "th_finesse", rank: 1 }], reward: { kind: "unlock_ability", abilityId: "vanish" } },
      { id: "th_shadow", name: "Shadowstep", description: "+6 HP per rank.", maxRank: 2, cost: 1, pos: { col: 1, row: 2 }, requires: [{ nodeId: "th_poison_blade", rank: 1 }, { nodeId: "th_vanish", rank: 1 }], reward: { kind: "passive_hp", perRank: 6 } },
      { id: "th_backstab", name: "Backstab", description: "Capstone: unlock Backstab — a devastating opener.", maxRank: 1, cost: 2, pos: { col: 1, row: 3 }, requires: [{ nodeId: "th_shadow", rank: 1 }], reward: { kind: "unlock_ability", abilityId: "backstab" } },
    ],
  },

  Archer: {
    class: "Archer",
    nodes: [
      { id: "ar_marksman", name: "Marksman", description: "+1 Dexterity per rank.", maxRank: 3, cost: 1, pos: { col: 1, row: 0 }, requires: [], reward: { kind: "passive_stat", stat: "dex", perRank: 1 } },
      { id: "ar_piercing", name: "Piercing Shot", description: "Unlock Piercing Shot — armor-ignoring damage.", maxRank: 1, cost: 1, pos: { col: 0, row: 1 }, requires: [{ nodeId: "ar_marksman", rank: 1 }], reward: { kind: "unlock_ability", abilityId: "piercing_shot" } },
      { id: "ar_evasive", name: "Evasive Roll", description: "Unlock Evasive Roll — dodge and reposition.", maxRank: 1, cost: 1, pos: { col: 2, row: 1 }, requires: [{ nodeId: "ar_marksman", rank: 1 }], reward: { kind: "unlock_ability", abilityId: "evasive_roll" } },
      { id: "ar_deadeye", name: "Deadeye", description: "+1 Dexterity per rank.", maxRank: 2, cost: 1, pos: { col: 1, row: 2 }, requires: [{ nodeId: "ar_piercing", rank: 1 }, { nodeId: "ar_evasive", rank: 1 }], reward: { kind: "passive_stat", stat: "dex", perRank: 1 } },
      { id: "ar_rapid_fire", name: "Rapid Fire", description: "Capstone: unlock Rapid Fire — a second arrow each turn.", maxRank: 1, cost: 2, pos: { col: 1, row: 3 }, requires: [{ nodeId: "ar_deadeye", rank: 1 }], reward: { kind: "unlock_ability", abilityId: "rapid_fire" } },
    ],
  },
};
