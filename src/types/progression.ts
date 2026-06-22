/**
 * progression.ts — Persistent character progression & the talent tree
 *
 * Adds the layer the game has been missing: XP → level, spendable skill &
 * attribute points, and a per-class talent tree whose nodes unlock or rank
 * existing CLASS_ABILITIES (see character.ts) or grant passive stat bonuses.
 *
 * Naming: this is deliberately the "talent" tree, NOT the "skill" tree, to
 * avoid colliding with the existing `Skill` type (athletics/stealth/…) used by
 * SkillEngine. The feature spec's "skill points" survive as a player-facing
 * label only.
 *
 * Purity: every function here is side-effect-free and unit-testable, matching
 * the SkillEngine convention. State lives on the server (Player.progression)
 * and is sent to the client as a lean view (SkillScreenView, defined in
 * network.ts). The client never mutates progression directly.
 */

import type { AbilityScore, CharacterClass, CharacterStats } from "./character";

// ─── Leveling curve ───────────────────────────────────────────────────────────

/** Skill points granted per level gained. */
export const SKILL_POINTS_PER_LEVEL = 1;

/**
 * Levels at which a player gains 1 attribute point (D&D-style ASIs).
 * Edit this set to retune attribute pacing — nothing else changes.
 */
export const ATTRIBUTE_POINT_LEVELS = new Set([4, 8, 12, 16, 19]);

export const MAX_LEVEL = 20;

/**
 * Total cumulative XP required to BE a given level.
 * Level 1 = 0. Each level costs a bit more than the last (gentle quadratic).
 */
export function xpForLevel(level: number): number {
  const clamped = Math.max(1, Math.min(MAX_LEVEL, level));
  // 0, 300, 900, 1800, 3000, … — total to reach `level`.
  return Math.round(150 * (clamped - 1) * clamped);
}

/** The level a given total XP amount corresponds to. */
export function levelForXp(xp: number): number {
  let level = 1;
  while (level < MAX_LEVEL && xp >= xpForLevel(level + 1)) level++;
  return level;
}

/** XP remaining until the next level (0 at MAX_LEVEL). */
export function xpToNextLevel(xp: number): number {
  const level = levelForXp(xp);
  if (level >= MAX_LEVEL) return 0;
  return xpForLevel(level + 1) - xp;
}

/** Total skill points a character of `level` has earned over their lifetime. */
export function lifetimeSkillPoints(level: number): number {
  return (level - 1) * SKILL_POINTS_PER_LEVEL;
}

/** Total attribute points a character of `level` has earned over their lifetime. */
export function lifetimeAttributePoints(level: number): number {
  let total = 0;
  for (const l of ATTRIBUTE_POINT_LEVELS) if (level >= l) total++;
  return total;
}

// ─── Talent tree data shapes ──────────────────────────────────────────────────

/**
 * What ranking up a node does. Kept to a small closed set so the effect system
 * stays declarative and new node behavior is added by extending this union.
 */
export type TalentReward =
  /** Makes a CLASS_ABILITIES entry usable; rank can scale its potency upstream. */
  | { kind: "unlock_ability"; abilityId: string }
  /** Each rank improves an already-unlocked ability (tuning lives in combat code). */
  | { kind: "rank_ability"; abilityId: string }
  /** Each rank adds `perRank` to one ability score. */
  | { kind: "passive_stat"; stat: AbilityScore; perRank: number }
  /** Each rank adds flat HP. */
  | { kind: "passive_hp"; perRank: number };

/** A single node in a class talent tree. */
export interface TalentNode {
  id: string;
  name: string;
  description: string;
  maxRank: number;
  /** Skill points spent per rank. */
  cost: number;
  /** Grid cell used purely for layout by the client renderer. */
  pos: { col: number; row: number };
  /** Prerequisite gates — every entry must be satisfied to rank this node. */
  requires: { nodeId: string; rank: number }[];
  reward: TalentReward;
}

/** A full class tree. One per CharacterClass (see talents.ts). */
export interface TalentTree {
  class: CharacterClass;
  nodes: TalentNode[];
}

// ─── Progression state (persisted per save slot) ──────────────────────────────

/**
 * The authoritative, persisted progression for one character. Stored server-
 * side on the Player (scoped to activeSlot) and written by the save system.
 */
export interface ProgressionState {
  xp: number;
  level: number;
  unspentSkillPoints: number;
  unspentAttributePoints: number;
  /** nodeId → current rank. Absent key = rank 0. */
  talentRanks: Record<string, number>;
  /** Manual attribute-point allocations, on top of class base scores. */
  attributeAllocations: Record<AbilityScore, number>;
}

/** A fresh level-1 progression for a newly finalized character. */
export function newProgression(): ProgressionState {
  return {
    xp: 0,
    level: 1,
    unspentSkillPoints: 0,
    unspentAttributePoints: 0,
    talentRanks: {},
    attributeAllocations: { str: 0, dex: 0, con: 0, int: 0, wis: 0, cha: 0 },
  };
}

/**
 * Award XP and reconcile derived fields (level, unspent points). Pure: returns
 * a new state. Unspent points are lifetime-earned minus already-spent, so this
 * is safe to call repeatedly without double-granting.
 */
export function awardXp(prev: ProgressionState, amount: number): ProgressionState {
  const xp = Math.max(0, prev.xp + amount);
  const level = levelForXp(xp);

  const spentSkill = Object.entries(prev.talentRanks).reduce(
    (sum, [, rank]) => sum + rank, // cost-weighting applied in spendTalentPoint; ranks tracked here
    0
  );
  const spentAttr = Object.values(prev.attributeAllocations).reduce((a, b) => a + b, 0);

  return {
    ...prev,
    xp,
    level,
    unspentSkillPoints: Math.max(0, lifetimeSkillPoints(level) - spentSkill),
    unspentAttributePoints: Math.max(0, lifetimeAttributePoints(level) - spentAttr),
  };
}

// ─── Talent node state (pure, mirrors SkillEngine's tier helpers) ──────────────

export type TalentNodeState = "locked" | "available" | "unlocked" | "maxed";

export function nodeRank(prog: ProgressionState, nodeId: string): number {
  return prog.talentRanks[nodeId] ?? 0;
}

export function prereqsMet(node: TalentNode, prog: ProgressionState): boolean {
  return node.requires.every((req) => nodeRank(prog, req.nodeId) >= req.rank);
}

export function talentNodeState(node: TalentNode, prog: ProgressionState): TalentNodeState {
  const rank = nodeRank(prog, node.id);
  if (rank >= node.maxRank) return "maxed";
  if (rank > 0) return "unlocked";
  return prereqsMet(node, prog) ? "available" : "locked";
}

/** Whether the player may spend a point on this node right now. */
export function canRankUp(node: TalentNode, prog: ProgressionState): boolean {
  return (
    nodeRank(prog, node.id) < node.maxRank &&
    prereqsMet(node, prog) &&
    prog.unspentSkillPoints >= node.cost
  );
}

/**
 * Spend one rank's worth of skill points on a node. Returns the SAME state
 * (unchanged) if the spend is illegal, so callers can compare by reference to
 * detect rejection. The server validates with this before persisting.
 */
export function spendTalentPoint(prog: ProgressionState, node: TalentNode): ProgressionState {
  if (!canRankUp(node, prog)) return prog;
  return {
    ...prog,
    unspentSkillPoints: prog.unspentSkillPoints - node.cost,
    talentRanks: { ...prog.talentRanks, [node.id]: nodeRank(prog, node.id) + 1 },
  };
}

// ─── Projecting progression onto CharacterStats ────────────────────────────────

/**
 * The set of ability ids the character has actually learned: every ability that
 * a tree node has unlocked (or ranked) for them. Drives the right-hand ability
 * list and gates which CLASS_ABILITIES are usable in combat.
 */
export function knownAbilityIds(prog: ProgressionState, tree: TalentTree): Set<string> {
  const known = new Set<string>();
  for (const node of tree.nodes) {
    if (nodeRank(prog, node.id) < 1) continue;
    if (node.reward.kind === "unlock_ability" || node.reward.kind === "rank_ability") {
      known.add(node.reward.abilityId);
    }
  }
  return known;
}

/** Current rank a character has in a given ability (max across nodes that touch it). */
export function abilityRank(prog: ProgressionState, tree: TalentTree, abilityId: string): number {
  let rank = 0;
  for (const node of tree.nodes) {
    const r = node.reward;
    if ((r.kind === "unlock_ability" || r.kind === "rank_ability") && r.abilityId === abilityId) {
      rank = Math.max(rank, nodeRank(prog, node.id));
    }
  }
  return rank;
}

/**
 * Layer progression onto a freshly-built CharacterStats block. Pure: returns a
 * new stats object with talent passives + manual allocations folded into the
 * ability scores and level. Wire this into buildCharacterStats() in character.ts
 * once the save system loads a ProgressionState — that is the single hook needed
 * to make progression actually affect combat.
 */
export function applyProgression(
  stats: CharacterStats,
  prog: ProgressionState,
  tree: TalentTree
): CharacterStats {
  const abilityScores = { ...stats.abilityScores };

  // Manual attribute-point allocations
  for (const key of Object.keys(prog.attributeAllocations) as AbilityScore[]) {
    abilityScores[key] += prog.attributeAllocations[key];
  }

  // Passive talent nodes
  for (const node of tree.nodes) {
    const rank = nodeRank(prog, node.id);
    if (rank < 1) continue;
    if (node.reward.kind === "passive_stat") {
      abilityScores[node.reward.stat] += node.reward.perRank * rank;
    }
  }

  return { ...stats, abilityScores, level: prog.level };
}
