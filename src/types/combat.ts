/**
 * combat.ts — Type system for Phase 3 tactical grid combat
 *
 * This module defines the full state machine for an encounter:
 *   planning → (all players submit) → resolving → (events broadcast) → planning …
 * until one side is eliminated, at which point phase = 'complete'.
 *
 * These types are intentionally free of any imports from network.ts to
 * prevent circular dependencies. Network message wrappers live in
 * network.ts and import from here.
 */

import type { CharacterStats, Condition, Weapon } from "./character";

// ─── Grid ─────────────────────────────────────────────────────────────────────

export const GRID_COLS = 8;
export const GRID_ROWS = 8;

export interface GridPosition {
  x: number;  // 0-indexed column, 0 = left
  y: number;  // 0-indexed row,    0 = top
}

/**
 * Tile kinds. The first four are the original passable floor / blocking set;
 * the last three are *tactical terrain* that changes how the board plays:
 *   - rubble  → difficult terrain: passable, but costs 2 movement to enter.
 *   - embers  → hazard: passable, but burns anything that ends its move on it.
 *   - cover   → passable, and grants its occupant an AC bonus (you fight from it).
 *   - barrel / crate → plain impassable scenery (basement props): no effect
 *     beyond blocking a tile, so a humble room reads as a humble room.
 * Terrain behavior is data-driven via TERRAIN below, so adding a tile kind is a
 * one-line table edit that both the server math and the client renderer read.
 */
export type GridCellType =
  | "floor" | "wall" | "obstacle" | "door"
  | "rubble" | "embers" | "cover"
  | "barrel" | "crate";

export interface GridCell {
  type: GridCellType;
  passable: boolean;
  /** Id of entity currently occupying this cell, if any. */
  entityId?: string;
  /**
   * Terrain height in whole "levels" (0 = ground). Purely presentational for
   * now — the renderer extrudes and lifts the tile so battlefields read with
   * real depth (a ridge, a mound), but movement/line-of-sight ignore it, so
   * adding elevation to a room never changes its balance. Absent = 0 (flat).
   * Indoor rooms (e.g. the tavern cellar) stay flat; outdoor rooms earn relief.
   */
  elevation?: number;
}

// ─── Tactical terrain (shared by server math + client renderer) ─────────────────

/** Declarative properties of one tile kind. */
export interface TerrainMeta {
  passable: boolean;
  /** Movement points to ENTER this tile (difficult terrain costs more). */
  moveCost: number;
  /** AC bonus granted to an entity standing on this tile. */
  coverBonus: number;
  /** Fire damage dealt when an entity ends its move here (0 = none). */
  hazardDamage: number;
  /** Short player-facing name, e.g. for tile tooltips. */
  label: string;
}

/**
 * The single source of truth for what each tile kind does. Pure data — both
 * CombatManager (movement cost, cover AC, hazard ticks) and CombatScreen
 * (rendering, reachable-tile math, tooltips) read from this so the two never
 * disagree about the rules of the board.
 */
export const TERRAIN: Record<GridCellType, TerrainMeta> = {
  floor:    { passable: true,  moveCost: 1, coverBonus: 0, hazardDamage: 0, label: "Floor" },
  door:     { passable: true,  moveCost: 1, coverBonus: 0, hazardDamage: 0, label: "Doorway" },
  wall:     { passable: false, moveCost: 1, coverBonus: 0, hazardDamage: 0, label: "Wall" },
  obstacle: { passable: false, moveCost: 1, coverBonus: 0, hazardDamage: 0, label: "Obstacle" },
  rubble:   { passable: true,  moveCost: 2, coverBonus: 0, hazardDamage: 0, label: "Rubble (slow)" },
  embers:   { passable: true,  moveCost: 1, coverBonus: 0, hazardDamage: 4, label: "Embers (burns)" },
  cover:    { passable: true,  moveCost: 1, coverBonus: 2, hazardDamage: 0, label: "Cover (+2 AC)" },
  barrel:   { passable: false, moveCost: 1, coverBonus: 0, hazardDamage: 0, label: "Barrel" },
  crate:    { passable: false, moveCost: 1, coverBonus: 0, hazardDamage: 0, label: "Crate" },
};

/** Movement points needed to enter a tile (∞ for impassable). */
export function entryCost(type: GridCellType): number {
  const meta = TERRAIN[type];
  return meta.passable ? meta.moveCost : Infinity;
}

/** AC bonus an entity gains from the tile it occupies. */
export function coverBonus(type: GridCellType): number {
  return TERRAIN[type].coverBonus;
}

/** Fire damage for ending a move on a tile (0 if harmless). */
export function hazardDamage(type: GridCellType): number {
  return TERRAIN[type].hazardDamage;
}

// ─── Distance ─────────────────────────────────────────────────────────────────
//
// Movement is 8-directional (diagonals cost 1), so REACH must be measured the
// same way or a corner-adjacent enemy reads as "range 2" and can't be hit with
// a reach-1 weapon — visually adjacent but mechanically not. Chebyshev distance
// (max of the axis deltas) matches the movement geometry: every tile touching
// yours, corners included, is distance 1. Server resolution and client
// targeting BOTH use this so they can never disagree.

/** Board distance where diagonals count as 1 (matches 8-way movement). */
export function chebyshev(a: GridPosition, b: GridPosition): number {
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
}

// ─── Entities ─────────────────────────────────────────────────────────────────

export interface CombatEntity {
  id: string;
  name: string;
  type: "player" | "enemy";
  /** Populated for player-controlled entities. */
  playerId?: string;
  position: GridPosition;
  hp: number;
  maxHp: number;
  /** Full stat block — includes AC, speed, weapon, ability scores. */
  stats: CharacterStats;
  /** Rolled at combat start via SkillEngine.rollInitiative. */
  initiative: number;
  conditions: Condition[];
  /** Remaining uses per ability id; 0 = on cooldown. */
  abilityUses: Record<string, number>;
  isDead: boolean;
  /** Escaped the fight alive via the flee action — out of the combat but not dead. */
  fled?: boolean;
  /** Consumables carried in (itemId → count), spent via the "item" action. Players only. */
  consumables?: Record<string, number>;
  /** Art key for the combatant's sprite (see CombatEntityView.sprite). */
  sprite?: string;
}

/** Lean per-player view of an entity sent over the network. */
export interface CombatEntityView {
  id: string;
  name: string;
  type: "player" | "enemy";
  playerId?: string;
  position: GridPosition;
  hp: number;
  maxHp: number;
  ac: number;
  speed: number;
  initiative: number;
  conditions: Condition[];
  isDead: boolean;
  /** Only present for the receiving player's own entity. */
  weapon?: Weapon;
  abilities?: AbilityStatus[];
  /** d20 attack bonus with the equipped weapon (own entity only) — lets the client estimate hit chance. */
  attackModifier?: number;
  /** Usable consumables carried into the fight (own entity only). */
  consumables?: ConsumableStatus[];
  /**
   * Art key for this combatant's sprite, e.g. "warrior", "mage", "rat",
   * "fog_wolf". The renderer looks for `/assets/sprites/<sprite>.png` and, when
   * present (registered in the client sprite manifest), draws it in place of the
   * placeholder token. Absent/unregistered → the lettered gradient token. This
   * is the drop-in seam for 2.5D character art — no code change to add sprites.
   */
  sprite?: string;
}

export interface AbilityStatus {
  id: string;
  name: string;
  description: string;
  cooldownRounds: number;
  /** 0 = on cooldown. */
  usesLeft: number;
  targetType?: "self" | "enemy" | "ally";
  /** Tile range this ability can reach (Infinity for self-targeting). */
  range: number;
}

/** A consumable the player can spend as their combat action. */
export interface ConsumableStatus {
  itemId: string;
  name: string;
  count: number;
  /** Heal dice, e.g. "2d4+2" — shown in the action button hint. */
  heal?: string;
}

// ─── Actions ──────────────────────────────────────────────────────────────────

export type CombatActionType = "attack" | "ability" | "dodge" | "item" | "flee" | "end_turn";

/**
 * Submitted during the planning phase — one per entity per round.
 * Both `move` and `action` are optional so players can choose to only
 * move, only act, or skip either.
 */
export interface CombatActionSubmission {
  entityId: string;
  /** Desired destination tile. Server validates range and path. */
  move?: GridPosition;
  action?: {
    type: CombatActionType;
    targetEntityId?: string;
    abilityId?: string;
    /** Catalog id of the consumable being used (type "item"). */
    itemId?: string;
  };
}

// ─── Events ───────────────────────────────────────────────────────────────────
//
// Events are the atomic units of a resolved round. The server emits them
// in initiative order; the client replays them sequentially to animate
// the outcome.

export type CombatEventType =
  | "move"
  | "attack_roll"
  | "attack_hit"
  | "attack_crit"
  | "attack_miss"
  | "damage"
  | "heal"
  | "ability_used"
  | "item_used"
  | "flee"
  /** A planned move or attack that couldn't happen (blocked path, target gone) — always visible, never silent. */
  | "action_fizzles"
  | "condition_applied"
  | "condition_removed"
  | "burn_damage"
  | "entity_dies"
  | "combat_ends";

export interface CombatEvent {
  type: CombatEventType;
  round: number;
  entityId: string;
  targetId?: string;
  roll?: {
    d20: number;
    modifier: number;
    total: number;
    /** AC for attack rolls, save DC for ability checks. */
    dc?: number;
  };
  /** Damage or heal amount. */
  value?: number;
  /** Destination for move events. */
  position?: GridPosition;
  /**
   * For move events: the full tile-by-tile route the entity walked (including
   * the origin as path[0] and the destination as the last cell). The client
   * animates the token stepping along this so players can see HOW it moved, not
   * just where it ended up. Server-authoritative — the client never invents it.
   */
  path?: GridPosition[];
  abilityId?: string;
  condition?: Condition;
  /** Human-readable log line for the combat log panel. */
  text: string;
}

// ─── Combat state ─────────────────────────────────────────────────────────────

export type CombatPhase = "planning" | "resolving" | "complete";
export type CombatOutcome = "players_win" | "players_lose" | "fled";

/** Full authoritative server state — never sent to clients directly. */
export interface CombatState {
  id: string;
  roomId: string;
  round: number;
  phase: CombatPhase;
  entities: CombatEntity[];
  /** [row][col] — y is the row index, x is the column index. */
  grid: GridCell[][];
  /** Entity ids sorted by initiative (descending). */
  initiativeOrder: string[];
  /** Entity ids of players who haven't yet submitted for this round. */
  pendingSubmissions: string[];
  /** Keyed by entityId — filled during planning, cleared after resolution. */
  submissions: Record<string, CombatActionSubmission>;
  eventLog: CombatEvent[];
  outcome?: CombatOutcome;
}

/** Lean board view broadcast to each connected player. */
export interface CombatStateView {
  id: string;
  roomId: string;
  round: number;
  phase: CombatPhase;
  entities: CombatEntityView[];
  grid: GridCell[][];
  initiativeOrder: string[];
  /** The receiving player's entity id — lets the client know which token to control. */
  myEntityId?: string;
}
