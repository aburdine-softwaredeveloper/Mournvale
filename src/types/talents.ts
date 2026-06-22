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

export const CLASS_TALENT_TREES: Record<CharacterClass, TalentTree> = {
  Knight: {
    class: "Knight",
    nodes: [
      { id: "kn_bulwark", name: "Bulwark", description: "+1 Constitution per rank.", maxRank: 3, cost: 1, pos: { col: 1, row: 0 }, requires: [], reward: { kind: "passive_stat", stat: "con", perRank: 1 } },
      { id: "kn_shield_bash", name: "Shield Bash", description: "Unlock Shield Bash; further ranks raise its stun reliability.", maxRank: 3, cost: 1, pos: { col: 0, row: 1 }, requires: [{ nodeId: "kn_bulwark", rank: 1 }], reward: { kind: "unlock_ability", abilityId: "shield_bash" } },
      { id: "kn_second_wind", name: "Second Wind", description: "Unlock Second Wind self-heal.", maxRank: 1, cost: 1, pos: { col: 2, row: 1 }, requires: [{ nodeId: "kn_bulwark", rank: 1 }], reward: { kind: "unlock_ability", abilityId: "second_wind" } },
      { id: "kn_unbreakable", name: "Unbreakable", description: "Capstone: +8 HP per rank.", maxRank: 1, cost: 2, pos: { col: 1, row: 2 }, requires: [{ nodeId: "kn_shield_bash", rank: 2 }, { nodeId: "kn_second_wind", rank: 1 }], reward: { kind: "passive_hp", perRank: 8 } },
    ],
  },

  Healer: {
    class: "Healer",
    nodes: [
      { id: "he_devotion", name: "Devotion", description: "+1 Wisdom per rank.", maxRank: 3, cost: 1, pos: { col: 1, row: 0 }, requires: [], reward: { kind: "passive_stat", stat: "wis", perRank: 1 } },
      { id: "he_healing_word", name: "Healing Word", description: "Unlock Healing Word; ranks improve its output.", maxRank: 3, cost: 1, pos: { col: 0, row: 1 }, requires: [{ nodeId: "he_devotion", rank: 1 }], reward: { kind: "unlock_ability", abilityId: "healing_word" } },
      { id: "he_sacred_flame", name: "Sacred Flame", description: "Unlock Sacred Flame.", maxRank: 1, cost: 1, pos: { col: 2, row: 1 }, requires: [{ nodeId: "he_devotion", rank: 1 }], reward: { kind: "unlock_ability", abilityId: "sacred_flame" } },
      { id: "he_radiance", name: "Radiance", description: "Capstone: +6 HP per rank.", maxRank: 1, cost: 2, pos: { col: 1, row: 2 }, requires: [{ nodeId: "he_healing_word", rank: 2 }, { nodeId: "he_sacred_flame", rank: 1 }], reward: { kind: "passive_hp", perRank: 6 } },
    ],
  },

  Warrior: {
    class: "Warrior",
    nodes: [
      { id: "wa_might", name: "Might", description: "+1 Strength per rank.", maxRank: 3, cost: 1, pos: { col: 1, row: 0 }, requires: [], reward: { kind: "passive_stat", stat: "str", perRank: 1 } },
      { id: "wa_reckless", name: "Reckless Attack", description: "Unlock Reckless Attack.", maxRank: 1, cost: 1, pos: { col: 0, row: 1 }, requires: [{ nodeId: "wa_might", rank: 1 }], reward: { kind: "unlock_ability", abilityId: "reckless_attack" } },
      { id: "wa_second_wind", name: "Second Wind", description: "Unlock Second Wind self-heal.", maxRank: 1, cost: 1, pos: { col: 2, row: 1 }, requires: [{ nodeId: "wa_might", rank: 1 }], reward: { kind: "unlock_ability", abilityId: "second_wind" } },
      { id: "wa_juggernaut", name: "Juggernaut", description: "Capstone: +10 HP per rank.", maxRank: 1, cost: 2, pos: { col: 1, row: 2 }, requires: [{ nodeId: "wa_reckless", rank: 1 }, { nodeId: "wa_second_wind", rank: 1 }], reward: { kind: "passive_hp", perRank: 10 } },
    ],
  },

  Monk: {
    class: "Monk",
    nodes: [
      { id: "mo_discipline", name: "Discipline", description: "+1 Dexterity per rank.", maxRank: 3, cost: 1, pos: { col: 1, row: 0 }, requires: [], reward: { kind: "passive_stat", stat: "dex", perRank: 1 } },
      { id: "mo_stunning", name: "Stunning Strike", description: "Unlock Stunning Strike.", maxRank: 1, cost: 1, pos: { col: 0, row: 1 }, requires: [{ nodeId: "mo_discipline", rank: 1 }], reward: { kind: "unlock_ability", abilityId: "stunning_strike" } },
      { id: "mo_patient", name: "Patient Defense", description: "Unlock Patient Defense.", maxRank: 1, cost: 1, pos: { col: 2, row: 1 }, requires: [{ nodeId: "mo_discipline", rank: 1 }], reward: { kind: "unlock_ability", abilityId: "patient_defense" } },
      { id: "mo_serenity", name: "Serenity", description: "Capstone: +1 Wisdom per rank.", maxRank: 2, cost: 2, pos: { col: 1, row: 2 }, requires: [{ nodeId: "mo_stunning", rank: 1 }, { nodeId: "mo_patient", rank: 1 }], reward: { kind: "passive_stat", stat: "wis", perRank: 1 } },
    ],
  },

  Mage: {
    class: "Mage",
    nodes: [
      { id: "ma_arcana", name: "Arcane Focus", description: "+1 Intelligence per rank.", maxRank: 3, cost: 1, pos: { col: 1, row: 0 }, requires: [], reward: { kind: "passive_stat", stat: "int", perRank: 1 } },
      { id: "ma_magic_missile", name: "Magic Missile", description: "Unlock Magic Missile; ranks may add darts upstream.", maxRank: 3, cost: 1, pos: { col: 0, row: 1 }, requires: [{ nodeId: "ma_arcana", rank: 1 }], reward: { kind: "unlock_ability", abilityId: "magic_missile" } },
      { id: "ma_fire_bolt", name: "Fire Bolt", description: "Unlock Fire Bolt.", maxRank: 1, cost: 1, pos: { col: 2, row: 1 }, requires: [{ nodeId: "ma_arcana", rank: 1 }], reward: { kind: "unlock_ability", abilityId: "fire_bolt" } },
      { id: "ma_archmage", name: "Archmage", description: "Capstone: +1 Intelligence per rank.", maxRank: 2, cost: 2, pos: { col: 1, row: 2 }, requires: [{ nodeId: "ma_magic_missile", rank: 2 }, { nodeId: "ma_fire_bolt", rank: 1 }], reward: { kind: "passive_stat", stat: "int", perRank: 1 } },
    ],
  },

  Thief: {
    class: "Thief",
    nodes: [
      { id: "th_finesse", name: "Finesse", description: "+1 Dexterity per rank.", maxRank: 3, cost: 1, pos: { col: 1, row: 0 }, requires: [], reward: { kind: "passive_stat", stat: "dex", perRank: 1 } },
      { id: "th_sneak", name: "Sneak Attack", description: "Unlock Sneak Attack; ranks raise its bonus dice upstream.", maxRank: 3, cost: 1, pos: { col: 0, row: 1 }, requires: [{ nodeId: "th_finesse", rank: 1 }], reward: { kind: "unlock_ability", abilityId: "sneak_attack" } },
      { id: "th_cunning", name: "Cunning Action", description: "Unlock Cunning Action.", maxRank: 1, cost: 1, pos: { col: 2, row: 1 }, requires: [{ nodeId: "th_finesse", rank: 1 }], reward: { kind: "unlock_ability", abilityId: "cunning_action" } },
      { id: "th_shadow", name: "Shadowstep", description: "Capstone: +6 HP per rank.", maxRank: 1, cost: 2, pos: { col: 1, row: 2 }, requires: [{ nodeId: "th_sneak", rank: 2 }, { nodeId: "th_cunning", rank: 1 }], reward: { kind: "passive_hp", perRank: 6 } },
    ],
  },

  Archer: {
    class: "Archer",
    nodes: [
      { id: "ar_marksman", name: "Marksman", description: "+1 Dexterity per rank.", maxRank: 3, cost: 1, pos: { col: 1, row: 0 }, requires: [], reward: { kind: "passive_stat", stat: "dex", perRank: 1 } },
      { id: "ar_hunters_mark", name: "Hunter's Mark", description: "Unlock Hunter's Mark.", maxRank: 1, cost: 1, pos: { col: 0, row: 1 }, requires: [{ nodeId: "ar_marksman", rank: 1 }], reward: { kind: "unlock_ability", abilityId: "hunters_mark" } },
      { id: "ar_volley", name: "Volley", description: "Unlock Volley.", maxRank: 1, cost: 1, pos: { col: 2, row: 1 }, requires: [{ nodeId: "ar_marksman", rank: 1 }], reward: { kind: "unlock_ability", abilityId: "volley" } },
      { id: "ar_deadeye", name: "Deadeye", description: "Capstone: +1 Dexterity per rank.", maxRank: 2, cost: 2, pos: { col: 1, row: 2 }, requires: [{ nodeId: "ar_hunters_mark", rank: 1 }, { nodeId: "ar_volley", rank: 1 }], reward: { kind: "passive_stat", stat: "dex", perRank: 1 } },
    ],
  },
};
