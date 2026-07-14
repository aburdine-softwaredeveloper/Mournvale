/**
 * CombatManager.ts — Server-side tactical combat engine
 *
 * Combat round flow (simultaneous submission model):
 *   1. createCombat()  → rolls initiative, places entities, enters 'planning'
 *   2. submitAction()  → collects one player submission; returns allSubmitted flag
 *   3. resolveRound()  → generates enemy AI, runs actions in initiative order,
 *                        emits CombatEvents, advances to next round or ends
 *
 * Only one CombatState per room is tracked. The singleton `combatManager`
 * is imported by server/index.ts which orchestrates all socket I/O.
 */

import { randomUUID } from "crypto";
import type {
  CombatState, CombatEntity, CombatActionSubmission, CombatEvent,
  CombatStateView, CombatEntityView, GridCell, GridCellType, GridPosition,
  CombatOutcome, AbilityStatus, ConsumableStatus,
} from "../../types/combat";
import {
  GRID_COLS, GRID_ROWS, entryCost, coverBonus, hazardDamage, chebyshev,
} from "../../types/combat";
import type { CharacterStats, CharacterClass } from "../../types/character";
import { buildCharacterStats, CLASS_DEFAULT_WEAPONS, abilityRange } from "../../types/character";
import type { Inventory } from "../../types/items";
import { applyEquipment, equipmentBonusHp, itemById } from "../../types/items";
import type { ProgressionState } from "../../types/progression";
import {
  applyProgression, equippedAbilityIds, talentBonusHp,
} from "../../types/progression";
import { CLASS_TALENT_TREES } from "../../types/talents";
import {
  rollDie, rollDice, rollAttack, rollInitiative,
  getAbilityModifier, getAttackBonus, resolveHealingDice, rollBurnDamage,
} from "../skills/SkillEngine";
import type { RollEdge } from "../skills/SkillEngine";
import { getEnemyTemplate, templateAbilityScores } from "./enemyTemplates";

// ─── Grid helpers ─────────────────────────────────────────────────────────────

function buildEmptyGrid(): GridCell[][] {
  return Array.from({ length: GRID_ROWS }, () =>
    Array.from({ length: GRID_COLS }, () => ({
      type: "floor" as const,
      passable: true,
    }))
  );
}

function getCell(grid: GridCell[][], pos: GridPosition): GridCell | undefined {
  return grid[pos.y]?.[pos.x];
}

/** Stamp a terrain kind onto a cell, keeping `passable` in sync with TERRAIN. */
function setTerrain(grid: GridCell[][], pos: GridPosition, type: GridCellType): void {
  const cell = getCell(grid, pos);
  if (!cell) return;
  cell.type = type;
  cell.passable = entryCost(type) !== Infinity;
}

/** A single authored tile placement. */
interface TerrainPlacement { pos: GridPosition; type: GridCellType; }

/**
 * Per-room terrain layouts. The look and tactics of a battlefield should suit
 * the place: a humble tavern cellar is just grey stone with a few barrels and
 * crates to path around (no glowing hazards), while the fog-wracked battle rooms
 * earn dramatic tactical terrain — cover to use, rubble to slow, embers to fear.
 *
 * All placements live in the middle rows (y 2..5) so the spawn rows stay clean,
 * and are only stamped onto empty floor (never an occupied cell). Add a room by
 * adding an entry; rooms without one fall back to DEFAULT_LAYOUT.
 */
const CELLAR_LAYOUT: TerrainPlacement[] = [
  { pos: { x: 2, y: 3 }, type: "barrel" },
  { pos: { x: 3, y: 4 }, type: "barrel" },
  { pos: { x: 5, y: 3 }, type: "barrel" },
  { pos: { x: 4, y: 2 }, type: "crate" },
  { pos: { x: 1, y: 4 }, type: "crate" },
  { pos: { x: 6, y: 4 }, type: "crate" },
];

const FOGLAND_LAYOUT: TerrainPlacement[] = [
  { pos: { x: 2, y: 4 }, type: "cover" }, { pos: { x: 3, y: 4 }, type: "cover" }, { pos: { x: 5, y: 3 }, type: "cover" },
  { pos: { x: 4, y: 3 }, type: "rubble" }, { pos: { x: 4, y: 4 }, type: "rubble" }, { pos: { x: 1, y: 3 }, type: "rubble" }, { pos: { x: 6, y: 4 }, type: "rubble" },
  { pos: { x: 3, y: 3 }, type: "embers" }, { pos: { x: 5, y: 4 }, type: "embers" },
];

/** A light, neutral fallback: a couple of crates, nothing dramatic. */
const DEFAULT_LAYOUT: TerrainPlacement[] = [
  { pos: { x: 3, y: 3 }, type: "crate" },
  { pos: { x: 5, y: 4 }, type: "crate" },
];

const ROOM_LAYOUTS: Record<string, TerrainPlacement[]> = {
  cellar:   CELLAR_LAYOUT,
  fog_road: FOGLAND_LAYOUT,
  fogheart: FOGLAND_LAYOUT,
};

/** A single tile's raised height, in whole levels (visual only). */
interface ElevationPlacement { pos: GridPosition; level: number; }

/**
 * Per-room terrain RELIEF. Elevation is purely visual (see GridCell.elevation) —
 * it never changes movement or line-of-sight, so it can't unbalance a fight. Use
 * it to give outdoor battlefields real shape. Indoor rooms stay flat by simply
 * having no entry here: a tavern cellar has a stone floor, not hills.
 *
 * Kept off the spawn rows (y 0 and 7) so no combatant starts perched on a ledge,
 * and shaped as a gentle central rise rather than a cliff.
 */
const FOGLAND_ELEVATION: ElevationPlacement[] = [
  // A low broken ridge running through the midfield — high ground at the centre.
  { pos: { x: 3, y: 3 }, level: 1 }, { pos: { x: 4, y: 3 }, level: 2 }, { pos: { x: 5, y: 3 }, level: 1 },
  { pos: { x: 3, y: 4 }, level: 1 }, { pos: { x: 4, y: 4 }, level: 2 }, { pos: { x: 5, y: 4 }, level: 1 },
  { pos: { x: 2, y: 3 }, level: 1 }, { pos: { x: 6, y: 4 }, level: 1 },
];

const ROOM_ELEVATION: Record<string, ElevationPlacement[]> = {
  // cellar intentionally absent → flat.
  fog_road: FOGLAND_ELEVATION,
  fogheart: FOGLAND_ELEVATION,
};

/**
 * Stamp the room-appropriate terrain onto the board. Only writes onto empty
 * floor tiles, so it's safe to call after entities are placed. Unknown rooms get
 * the light default layout.
 */
function applyRoomTerrain(grid: GridCell[][], roomId: string): void {
  const layout = ROOM_LAYOUTS[roomId] ?? DEFAULT_LAYOUT;
  for (const { pos, type } of layout) {
    const cell = getCell(grid, pos);
    if (cell && cell.type === "floor" && !cell.entityId) setTerrain(grid, pos, type);
  }
  // Relief (visual only). Rooms without an entry stay flat.
  for (const { pos, level } of ROOM_ELEVATION[roomId] ?? []) {
    const cell = getCell(grid, pos);
    if (cell) cell.elevation = level;
  }
}

function setCell(
  grid: GridCell[][],
  pos: GridPosition,
  entityId: string | undefined
): void {
  const cell = getCell(grid, pos);
  if (!cell) return;
  // Under exactOptionalPropertyTypes an optional prop can't be assigned
  // `undefined` — clearing the cell means deleting the key.
  if (entityId === undefined) delete cell.entityId;
  else cell.entityId = entityId;
}

// Reach and AI distances use chebyshev (types/combat.ts) so they match the
// 8-directional movement: a corner-adjacent enemy IS in reach of a melee weapon.

const MOVE_DIRS: Array<[number, number]> = [[-1,0],[1,0],[0,-1],[0,1],[-1,-1],[1,-1],[-1,1],[1,1]];

/**
 * Cost-aware shortest path from `from` to `to` within `maxSteps` movement
 * points, honoring terrain entry costs (difficult terrain costs more) and
 * treating other entities' cells as blocked. Uniform-cost (Dijkstra) search,
 * since difficult terrain breaks the equal-step assumption a plain BFS makes.
 *
 * Returns the tile-by-tile route INCLUDING the origin (path[0]) and total cost,
 * or null if the destination is unreachable in budget. This single function
 * backs both reachability checks and the actual move (which needs the route to
 * animate on the client), so the two can never disagree.
 */
function findPath(
  grid: GridCell[][],
  from: GridPosition,
  to: GridPosition,
  maxSteps: number,
  ownId: string
): { path: GridPosition[]; cost: number } | null {
  if (from.x === to.x && from.y === to.y) return { path: [from], cost: 0 };

  const key = (p: GridPosition) => `${p.x},${p.y}`;
  const best = new Map<string, number>([[key(from), 0]]);
  const prev = new Map<string, GridPosition>();
  // Small frontier; linear extract-min is fine for an 8×8 board.
  const frontier: Array<{ pos: GridPosition; cost: number }> = [{ pos: from, cost: 0 }];

  while (frontier.length) {
    let bi = 0;
    for (let i = 1; i < frontier.length; i++) if (frontier[i]!.cost < frontier[bi]!.cost) bi = i;
    const { pos, cost } = frontier.splice(bi, 1)[0]!;
    if (cost > (best.get(key(pos)) ?? Infinity)) continue;

    if (pos.x === to.x && pos.y === to.y) {
      const path: GridPosition[] = [pos];
      let cur = pos;
      while (prev.has(key(cur))) { cur = prev.get(key(cur))!; path.unshift(cur); }
      return { path, cost };
    }

    for (const [dx, dy] of MOVE_DIRS) {
      const nx = pos.x + dx, ny = pos.y + dy;
      if (nx < 0 || ny < 0 || ny >= GRID_ROWS || nx >= GRID_COLS) continue;
      const cell = grid[ny]?.[nx];
      if (!cell?.passable) continue;
      if (cell.entityId && cell.entityId !== ownId) continue;
      const step = entryCost(cell.type);
      const next = cost + step;
      if (next > maxSteps) continue;
      const np = { x: nx, y: ny };
      if (next < (best.get(key(np)) ?? Infinity)) {
        best.set(key(np), next);
        prev.set(key(np), pos);
        frontier.push({ pos: np, cost: next });
      }
    }
  }
  return null;
}

/**
 * Best route TOWARD a target within a movement budget — the workhorse behind
 * enemy movement, players' automatic pursuit of a shifted target, and rerouting
 * a blocked move. Floods every tile reachable within `budget` (same rules as
 * findPath: terrain costs, other entities block) and picks the one that ends
 * closest to `toward` (ties broken by cheapest route). Returns null when no
 * move improves on standing still.
 */
function bestApproach(
  grid: GridCell[][],
  from: GridPosition,
  toward: GridPosition,
  budget: number,
  ownId: string
): { path: GridPosition[]; cost: number; dest: GridPosition } | null {
  const key = (p: GridPosition) => `${p.x},${p.y}`;
  const best = new Map<string, number>([[key(from), 0]]);
  const prev = new Map<string, GridPosition>();
  const frontier: Array<{ pos: GridPosition; cost: number }> = [{ pos: from, cost: 0 }];

  let winner = from;
  let winnerDist = chebyshev(from, toward);
  let winnerCost = 0;

  while (frontier.length) {
    let bi = 0;
    for (let i = 1; i < frontier.length; i++) if (frontier[i]!.cost < frontier[bi]!.cost) bi = i;
    const { pos, cost } = frontier.splice(bi, 1)[0]!;
    if (cost > (best.get(key(pos)) ?? Infinity)) continue;

    const d = chebyshev(pos, toward);
    if (d < winnerDist || (d === winnerDist && cost < winnerCost)) {
      winner = pos; winnerDist = d; winnerCost = cost;
    }

    for (const [dx, dy] of MOVE_DIRS) {
      const nx = pos.x + dx, ny = pos.y + dy;
      if (nx < 0 || ny < 0 || ny >= GRID_ROWS || nx >= GRID_COLS) continue;
      const cell = grid[ny]?.[nx];
      if (!cell?.passable) continue;
      if (cell.entityId && cell.entityId !== ownId) continue;
      const next = cost + entryCost(cell.type);
      if (next > budget) continue;
      const np = { x: nx, y: ny };
      if (next < (best.get(key(np)) ?? Infinity)) {
        best.set(key(np), next);
        prev.set(key(np), pos);
        frontier.push({ pos: np, cost: next });
      }
    }
  }

  if (winner.x === from.x && winner.y === from.y) return null;
  const path: GridPosition[] = [winner];
  let cur = winner;
  while (prev.has(key(cur))) { cur = prev.get(key(cur))!; path.unshift(cur); }
  return { path, cost: winnerCost, dest: winner };
}

/** Whether `to` is reachable from `from` within budget (terrain-aware). */
function canReach(
  grid: GridCell[][],
  from: GridPosition,
  to: GridPosition,
  maxSteps: number,
  ownId: string
): boolean {
  return findPath(grid, from, to, maxSteps, ownId) !== null;
}

// ─── View builders ────────────────────────────────────────────────────────────

function buildEntityView(e: CombatEntity, isOwner: boolean): CombatEntityView {
  const abilities: AbilityStatus[] = isOwner
    ? (e.stats.classAbilities ?? [])
        .filter(a => a.type === "active")
        .map(a => ({
          id:            a.id,
          name:          a.name,
          description:   a.description,
          cooldownRounds: a.cooldownRounds,
          usesLeft:      e.abilityUses[a.id] ?? 0,
          range:         abilityRange(a, e.stats.equippedWeapon.range),
          // Omit (don't set to undefined) under exactOptionalPropertyTypes.
          ...(a.targetType && { targetType: a.targetType }),
        }))
    : [];
  const consumables: ConsumableStatus[] = isOwner
    ? Object.entries(e.consumables ?? {})
        .filter(([, count]) => count > 0)
        .map(([itemId, count]) => {
          const def = itemById(itemId);
          return {
            itemId,
            count,
            name: def?.name ?? itemId,
            ...(def?.consumable?.heal && { heal: def.consumable.heal }),
          };
        })
    : [];
  return {
    id:         e.id,
    name:       e.name,
    type:       e.type,
    position:   e.position,
    hp:         e.hp,
    maxHp:      e.maxHp,
    ac:         e.stats.ac,
    speed:      e.stats.speed,
    initiative: e.initiative,
    conditions: e.conditions,
    // A fled combatant is out of the fight — render them gone, same as dead.
    isDead:     e.isDead || !!e.fled,
    ...(e.playerId !== undefined && { playerId: e.playerId }),
    ...(e.sprite !== undefined && { sprite: e.sprite }),
    ...(isOwner && {
      weapon: e.stats.equippedWeapon,
      abilities,
      consumables,
      attackModifier: getAttackBonus(e.stats, e.stats.equippedWeapon),
    }),
  };
}

function buildView(state: CombatState, forPlayerId?: string): CombatStateView {
  const myEntity = forPlayerId
    ? state.entities.find(e => e.playerId === forPlayerId)
    : undefined;
  return {
    id:              state.id,
    roomId:          state.roomId,
    round:           state.round,
    phase:           state.phase,
    initiativeOrder: state.initiativeOrder,
    grid:            state.grid,
    entities:        state.entities.map(e =>
      buildEntityView(e, e.playerId === forPlayerId)
    ),
    ...(myEntity && { myEntityId: myEntity.id }),
  };
}

// ─── Enemy entity builder ─────────────────────────────────────────────────────

/**
 * Builds a combat entity from an NPC definition.
 * For now, all enemies use Warrior stats at level 1 with customizable HP/AC.
 */
export function buildEnemyCombatEntity(params: {
  id: string;
  name: string;
  position: GridPosition;
  hp?: number;
  ac?: number;
  characterClass?: CharacterClass;
  level?: number;
}): CombatEntity {
  const charClass = params.characterClass ?? "Warrior";
  const level     = params.level ?? 1;
  const stats     = buildCharacterStats(charClass, level);
  if (params.ac !== undefined)   stats.ac = params.ac;
  return {
    id:          `enemy-${params.id}`,
    name:        params.name,
    type:        "enemy",
    position:    params.position,
    hp:          params.hp ?? 20,
    maxHp:       params.hp ?? 20,
    stats,
    initiative:  0,
    conditions:  [],
    abilityUses: {},
    isDead:      false,
  };
}

/**
 * Builds a combat entity from a monster template (see enemyTemplates.ts).
 *
 * This is the preferred path for spawning hostiles: the creature carries its own
 * weapon, ability scores, AC, speed, and HP, so a rat fights like a rat instead
 * of inheriting a trained Warrior's stat block. The `name` override lets a
 * specific NPC ("Bold Rat") relabel a shared template.
 */
export function buildEnemyFromTemplate(params: {
  id: string;
  templateKey: string;
  position: GridPosition;
  name?: string;
}): CombatEntity {
  const tmpl  = getEnemyTemplate(params.templateKey);
  // Start from a level-1 Warrior block purely for structural defaults
  // (skill/save lists are never read for enemies), then overwrite everything
  // that actually drives combat with the template's own numbers.
  const stats = buildCharacterStats("Warrior", 1);
  stats.abilityScores  = templateAbilityScores(tmpl);
  stats.ac             = tmpl.ac;
  stats.speed          = tmpl.speed;
  stats.equippedWeapon = tmpl.weapon;
  stats.classAbilities = [];   // enemies fight with weapon + AI only
  stats.abilityUses    = {};

  return {
    id:          `enemy-${params.id}`,
    name:        params.name ?? tmpl.name,
    type:        "enemy",
    position:    params.position,
    hp:          tmpl.hp,
    maxHp:       tmpl.hp,
    stats,
    initiative:  0,
    conditions:  [],
    abilityUses: {},
    isDead:      false,
    // Sprite art key = the template key ("rat", "fog_wolf", …). See sprite manifest.
    sprite:      tmpl.key,
  };
}

/**
 * Builds a combat entity from a player character.
 *
 * When `progression` is supplied, the character's talent passives and manual
 * attribute allocations are folded into their stats, their ability list is
 * narrowed to the abilities they have slotted, and `passive_hp` talents raise
 * maxHp. Without it, the character falls back to level-1 class defaults with
 * all baseline abilities (used for tests and any pre-progression caller).
 */
export function buildPlayerCombatEntity(params: {
  playerId: string;
  name: string;
  characterClass: CharacterClass;
  hp: number;
  position: GridPosition;
  progression?: ProgressionState;
  inventory?: Inventory;
  /**
   * Current HP carried in from the world (wounds persist between fights).
   * Omitted = enter at full health. Clamped to [1, computed max].
   */
  currentHp?: number;
}): CombatEntity {
  let stats = buildCharacterStats(params.characterClass, params.progression?.level ?? 1);
  let maxHp = params.hp;

  if (params.progression) {
    const tree = CLASS_TALENT_TREES[params.characterClass];
    stats = applyProgression(stats, params.progression, tree);

    // Only slotted abilities are usable in combat.
    const equipped = new Set(equippedAbilityIds(params.progression));
    const classAbilities = stats.classAbilities.filter(a => equipped.has(a.id));
    stats = {
      ...stats,
      classAbilities,
      abilityUses: Object.fromEntries(
        classAbilities
          .filter(a => a.type === "active" && a.cooldownRounds > 0)
          .map(a => [a.id, 1])
      ),
    };

    maxHp = params.hp + talentBonusHp(params.progression, tree);
  }

  // Equipped gear layers on AC / ability scores / weapon / speed / HP, on top of
  // progression — so a worn sword and plate actually change how the player fights.
  // Consumables in the pack come along too, usable via the "item" combat action.
  const consumables: Record<string, number> = {};
  if (params.inventory) {
    stats = applyEquipment(stats, params.inventory);
    maxHp += equipmentBonusHp(params.inventory);
    for (const [itemId, count] of Object.entries(params.inventory.items)) {
      if (count > 0 && itemById(itemId)?.kind === "consumable") {
        consumables[itemId] = count;
      }
    }
  }

  return {
    id:          `player-${params.playerId}`,
    name:        params.name,
    type:        "player",
    playerId:    params.playerId,
    position:    params.position,
    hp:          Math.max(1, Math.min(params.currentHp ?? maxHp, maxHp)),
    maxHp,
    stats,
    initiative:  0,
    conditions:  [],
    abilityUses: { ...stats.abilityUses },
    isDead:      false,
    consumables,
    // Sprite art key = the class name lowercased ("warrior", "mage", …).
    sprite:      params.characterClass.toLowerCase(),
  };
}

// ─── CombatManager ────────────────────────────────────────────────────────────

export class CombatManager {
  private readonly combats = new Map<string, CombatState>();

  /**
   * True when a live combat is already running in this room. endCombat()
   * removes finished fights from the map, so presence == live. Guards against
   * a second `fight` command spawning a parallel combat over the same NPCs
   * (which would double XP/loot and desync the room).
   */
  hasCombatInRoom(roomId: string): boolean {
    for (const c of this.combats.values()) {
      if (c.roomId === roomId) return true;
    }
    return false;
  }

  /** True when this persistent player id is fighting in any live combat. */
  isPlayerInCombat(playerId: string): boolean {
    for (const c of this.combats.values()) {
      if (c.entities.some(e => e.type === "player" && e.playerId === playerId)) {
        return true;
      }
    }
    return false;
  }

  /**
   * Pulls a player out of whatever live combat they're in — used when they
   * disconnect mid-fight. Their entity falls (leaves the grid) and any pending
   * submission of theirs is dropped, so the round can no longer wait on them.
   * Without this, one player closing the app froze the fight forever: the
   * room stayed combat-locked and party members waited on a ghost.
   *
   * Returns what the caller needs to finish the job (resolve the round if the
   * leaver was the last holdout, or end the combat if no players remain), or
   * null when the player wasn't fighting.
   */
  removePlayer(playerId: string): { combatId: string; roomId: string; playersRemain: boolean } | null {
    for (const state of this.combats.values()) {
      const entity = state.entities.find(e => e.type === "player" && e.playerId === playerId);
      if (!entity) continue;

      if (!entity.isDead) {
        entity.isDead = true;
        setCell(state.grid, entity.position, undefined);
      }
      state.pendingSubmissions = state.pendingSubmissions.filter(id => id !== entity.id);
      delete state.submissions[entity.id];

      const playersRemain = state.entities.some(e => e.type === "player" && !e.isDead);
      return { combatId: state.id, roomId: state.roomId, playersRemain };
    }
    return null;
  }

  // ── Lifecycle ──────────────────────────────────────────────────────────────

  createCombat(
    roomId: string,
    playerEntities: CombatEntity[],
    enemyEntities: CombatEntity[]
  ): CombatState {
    const entities = [...playerEntities, ...enemyEntities];
    const grid     = buildEmptyGrid();

    // Disambiguate duplicate names ("Cellar Rat" ×2 → "Cellar Rat A"/"Cellar
    // Rat B") so the turn order, log lines, and board tokens all agree on who
    // is who. Done once here so every downstream text uses the labeled name.
    const nameCounts = new Map<string, number>();
    for (const e of entities) nameCounts.set(e.name, (nameCounts.get(e.name) ?? 0) + 1);
    const nameSeen = new Map<string, number>();
    for (const e of entities) {
      if ((nameCounts.get(e.name) ?? 0) > 1) {
        const nth = nameSeen.get(e.name) ?? 0;
        nameSeen.set(e.name, nth + 1);
        e.name = `${e.name} ${String.fromCharCode(65 + nth)}`; // A, B, C…
      }
    }

    for (const e of entities) setCell(grid, e.position, e.id);

    // Lay room-appropriate terrain into the midfield (after spawns, so it never
    // lands on an occupied cell): barrels/crates in a cellar, tactical hazards in
    // the fog battles. See ROOM_LAYOUTS.
    applyRoomTerrain(grid, roomId);

    // Roll initiative
    for (const e of entities) {
      const init = rollInitiative(e.stats, e.id);
      e.initiative = init.total;
    }

    const initiativeOrder = [...entities]
      .sort((a, b) => {
        if (b.initiative !== a.initiative) return b.initiative - a.initiative;
        return (
          getAbilityModifier(b.stats.abilityScores.dex) -
          getAbilityModifier(a.stats.abilityScores.dex)
        );
      })
      .map(e => e.id);

    const state: CombatState = {
      id:                  randomUUID(),
      roomId,
      round:               1,
      phase:               "planning",
      entities,
      grid,
      initiativeOrder,
      pendingSubmissions:  playerEntities.map(e => e.id),
      submissions:         {},
      eventLog:            [],
    };

    this.combats.set(state.id, state);
    return state;
  }

  getState(id: string): CombatState | undefined {
    return this.combats.get(id);
  }

  /** Returns a personalised CombatStateView for one player. */
  getViewForPlayer(id: string, playerId: string): CombatStateView | undefined {
    const state = this.combats.get(id);
    return state ? buildView(state, playerId) : undefined;
  }

  /** Returns a non-personalised view for broadcasts that don't need per-player data. */
  getBroadcastView(id: string): CombatStateView | undefined {
    const state = this.combats.get(id);
    return state ? buildView(state) : undefined;
  }

  endCombat(id: string): void {
    this.combats.delete(id);
  }

  // ── Submission ─────────────────────────────────────────────────────────────

  submitAction(
    combatId: string,
    submission: CombatActionSubmission
  ): { allSubmitted: boolean; pendingPlayerIds: string[] } {
    const state = this.combats.get(combatId);
    if (!state || state.phase !== "planning") {
      return { allSubmitted: false, pendingPlayerIds: [] };
    }

    state.submissions[submission.entityId] = submission;
    state.pendingSubmissions = state.pendingSubmissions.filter(
      id => id !== submission.entityId
    );

    const pendingPlayerIds = state.pendingSubmissions
      .map(eid => state.entities.find(e => e.id === eid)?.playerId)
      .filter((pid): pid is string => pid !== undefined);

    return {
      allSubmitted: state.pendingSubmissions.length === 0,
      pendingPlayerIds,
    };
  }

  // ── Resolution ─────────────────────────────────────────────────────────────

  resolveRound(combatId: string): {
    events: CombatEvent[];
    isOver: boolean;
    outcome?: CombatOutcome;
  } {
    const state = this.combats.get(combatId);
    if (!state) return { events: [], isOver: false };

    state.phase = "resolving";
    const events: CombatEvent[] = [];

    // Burn tick at start of round
    for (const e of state.entities) {
      if (!e.isDead && !e.fled && e.conditions.includes("burning")) {
        const dmg = rollBurnDamage();
        e.hp = Math.max(0, e.hp - dmg);
        events.push({
          type: "burn_damage", round: state.round, entityId: e.id,
          value: dmg, text: `${e.name} takes ${dmg} fire damage.`,
        });
        if (e.hp <= 0) {
          e.isDead = true; setCell(state.grid, e.position, undefined);
          events.push({ type: "entity_dies", round: state.round, entityId: e.id, text: `${e.name} is defeated!` });
        }
        if (Math.random() < 0.5) {
          e.conditions = e.conditions.filter(c => c !== "burning");
          events.push({ type: "condition_removed", round: state.round, entityId: e.id, condition: "burning", text: `${e.name} is no longer burning.` });
        }
      }
    }

    // Process in initiative order. Players act on the plan they submitted;
    // each enemy's plan is generated AT ITS TURN so it works from the real,
    // current board (no stale targets, no two rats claiming the same tile).
    for (const entityId of state.initiativeOrder) {
      if (this.isOver(state)) break;
      const e = state.entities.find(x => x.id === entityId);
      if (!e || e.isDead || e.fled) continue;

      // One-turn stances (dodge, reckless) last until the entity next acts.
      e.conditions = e.conditions.filter(c => c !== "dodging" && c !== "reckless");

      const sub = e.type === "enemy"
        ? this.generateEnemyPlan(state, e)
        : state.submissions[entityId];
      if (!sub) continue;

      // Track movement spent this turn so an attack on a target that shifted
      // away can pursue with whatever movement is left.
      const budget = { spent: 0 };
      if (sub.move)   events.push(...this.processMove(state, e, sub.move, budget));
      if (sub.action && !e.isDead) events.push(...this.processAction(state, e, sub.action, budget));
    }

    const over = this.isOver(state);
    if (over) {
      const playersStanding = state.entities.some(e => e.type === "player" && !e.isDead && !e.fled);
      const anyoneFled      = state.entities.some(e => e.type === "player" && e.fled);
      state.outcome = playersStanding ? "players_win" : anyoneFled ? "fled" : "players_lose";
      state.phase   = "complete";
      events.push({
        type: "combat_ends", round: state.round, entityId: "",
        text: playersStanding
          ? "Victory! All enemies defeated."
          : anyoneFled
            ? "The fight is abandoned — you slip away into the dark."
            : "The party has fallen…",
      });
    } else {
      state.round++;
      state.phase           = "planning";
      state.submissions     = {};
      state.pendingSubmissions = state.entities
        .filter(e => e.type === "player" && !e.isDead && !e.fled)
        .map(e => e.id);
      // Simple cooldown tick: refund one use per ability that's on cooldown
      for (const e of state.entities) {
        for (const ability of e.stats.classAbilities ?? []) {
          if (ability.cooldownRounds > 0 && (e.abilityUses[ability.id] ?? 0) === 0) {
            e.abilityUses[ability.id] = 1;
          }
        }
      }
    }

    state.eventLog.push(...events);
    return { events, isOver: over, ...(state.outcome && { outcome: state.outcome }) };
  }

  // ── Move ───────────────────────────────────────────────────────────────────

  private processMove(
    state: CombatState,
    e: CombatEntity,
    dest: GridPosition,
    budget: { spent: number }
  ): CombatEvent[] {
    let route = findPath(state.grid, e.position, dest, e.stats.speed, e.id);
    let blocked = false;

    // The planned tile can be gone by the time this turn resolves (someone
    // faster took it, or the way closed). Reroute as close as possible instead
    // of silently standing still — and always SAY what happened.
    if (!route) {
      blocked = true;
      const detour = bestApproach(state.grid, e.position, dest, e.stats.speed, e.id);
      if (!detour) {
        return [{
          type: "action_fizzles", round: state.round, entityId: e.id,
          text: `${e.name} tries to move, but the way is blocked.`,
        }];
      }
      route = detour;
    }

    const arrive = route.path[route.path.length - 1]!;
    setCell(state.grid, e.position, undefined);
    e.position = arrive;
    setCell(state.grid, arrive, e.id);
    budget.spent += route.cost;

    const events: CombatEvent[] = [{
      type: "move", round: state.round, entityId: e.id, position: arrive,
      path: route.path,
      text: blocked
        ? `${e.name}'s way is blocked — they stop at (${arrive.x}, ${arrive.y}).`
        : `${e.name} moves to (${arrive.x}, ${arrive.y}).`,
    }];

    // Hazard terrain bites whatever ends its move standing on it.
    events.push(...this.applyHazard(state, e));
    return events;
  }

  /**
   * Apply fire-tile (embers) damage to an entity that has just settled onto a
   * hazard tile. Returns the resulting events (burn damage, and a death if it
   * drops them). No-op on safe ground, so it's cheap to call after any move.
   */
  private applyHazard(state: CombatState, e: CombatEntity): CombatEvent[] {
    const cell = getCell(state.grid, e.position);
    const dmg = cell ? hazardDamage(cell.type) : 0;
    if (dmg <= 0 || e.isDead) return [];

    e.hp = Math.max(0, e.hp - dmg);
    const events: CombatEvent[] = [{
      type: "burn_damage", round: state.round, entityId: e.id, value: dmg,
      text: `${e.name} steps into the embers and takes ${dmg} fire damage (${e.hp}/${e.maxHp}).`,
    }];
    if (e.hp <= 0) {
      e.isDead = true;
      setCell(state.grid, e.position, undefined);
      events.push({
        type: "entity_dies", round: state.round, entityId: e.id,
        text: `${e.name} falls in the embers.`,
      });
    }
    return events;
  }

  // ── Action ─────────────────────────────────────────────────────────────────

  private processAction(
    state: CombatState,
    e: CombatEntity,
    action: NonNullable<CombatActionSubmission["action"]>,
    budget: { spent: number }
  ): CombatEvent[] {
    switch (action.type) {
      case "attack":
        return action.targetEntityId
          ? this.processAttack(state, e, action.targetEntityId, budget)
          : [];
      case "ability":
        return action.abilityId
          ? this.processAbility(state, e, action.abilityId, action.targetEntityId)
          : [];
      case "dodge":
        e.conditions.push("dodging");
        return [{
          type: "condition_applied", round: state.round, entityId: e.id, condition: "dodging",
          text: `${e.name} weaves defensively — attacks against them are hindered until they next act.`,
        }];
      case "item":
        return action.itemId ? this.processItem(state, e, action.itemId) : [];
      case "flee":
        return this.processFlee(state, e);
      default:
        return [];
    }
  }

  // ── Attack ─────────────────────────────────────────────────────────────────

  /** Living combatants on the other side, nearest first. */
  private foesInReach(state: CombatState, e: CombatEntity, reach: number): CombatEntity[] {
    return state.entities
      .filter(x => x.type !== e.type && !x.isDead && !x.fled &&
                   chebyshev(e.position, x.position) <= reach)
      .sort((a, b) => chebyshev(e.position, a.position) - chebyshev(e.position, b.position));
  }

  /** Advantage/disadvantage granted by the TARGET's stance (dodge/reckless). */
  private targetEdge(target: CombatEntity, base: RollEdge = "normal"): RollEdge {
    let lean = base === "advantage" ? 1 : base === "disadvantage" ? -1 : 0;
    if (target.conditions.includes("reckless")) lean += 1;
    if (target.conditions.includes("dodging"))  lean -= 1;
    return lean > 0 ? "advantage" : lean < 0 ? "disadvantage" : "normal";
  }

  /**
   * A planned attack resolves against a board that may have changed: the target
   * can be dead or out of reach by now. Never fail silently — pursue with
   * leftover movement, fall back to whoever IS in reach, or say why nothing
   * happened. This is what makes the simultaneous-turn model readable.
   */
  private processAttack(
    state: CombatState,
    attacker: CombatEntity,
    targetId: string,
    budget: { spent: number }
  ): CombatEvent[] {
    const events: CombatEvent[] = [];
    const weapon = attacker.stats.equippedWeapon;
    let target = state.entities.find(e => e.id === targetId);

    // Quarry already down → swing at the nearest foe still standing instead.
    if (!target || target.isDead || target.fled) {
      const fallback = this.foesInReach(state, attacker, weapon.range)[0];
      if (!fallback) {
        events.push({
          type: "action_fizzles", round: state.round, entityId: attacker.id,
          text: `${attacker.name}'s quarry is already down — no one else is in reach.`,
        });
        return events;
      }
      events.push({
        type: "action_fizzles", round: state.round, entityId: attacker.id, targetId: fallback.id,
        text: `${attacker.name}'s quarry is already down — they turn on ${fallback.name} instead!`,
      });
      target = fallback;
    }

    // Quarry slipped out of reach → chase with unspent movement, else retarget.
    if (chebyshev(attacker.position, target.position) > weapon.range) {
      const remaining = attacker.stats.speed - budget.spent;
      let caught = false;

      if (remaining > 0) {
        const chase = bestApproach(state.grid, attacker.position, target.position, remaining, attacker.id);
        if (chase && chebyshev(chase.dest, target.position) <= weapon.range) {
          setCell(state.grid, attacker.position, undefined);
          attacker.position = chase.dest;
          setCell(state.grid, chase.dest, attacker.id);
          budget.spent += chase.cost;
          events.push({
            type: "move", round: state.round, entityId: attacker.id,
            position: chase.dest, path: chase.path,
            text: `${attacker.name} pursues ${target.name} to (${chase.dest.x}, ${chase.dest.y}).`,
          });
          events.push(...this.applyHazard(state, attacker));
          if (attacker.isDead) return events;
          caught = true;
        }
      }

      if (!caught) {
        const fallback = this.foesInReach(state, attacker, weapon.range)[0];
        if (!fallback) {
          events.push({
            type: "action_fizzles", round: state.round, entityId: attacker.id, targetId: target.id,
            text: `${attacker.name} lunges at ${target.name}, but they've slipped out of reach.`,
          });
          return events;
        }
        events.push({
          type: "action_fizzles", round: state.round, entityId: attacker.id, targetId: fallback.id,
          text: `${target.name} slips out of reach — ${attacker.name} turns on ${fallback.name} instead!`,
        });
        target = fallback;
      }
    }

    events.push(...this.weaponStrike(state, attacker, target, this.targetEdge(target)));
    return events;
  }

  /**
   * One weapon attack: roll vs AC (cover included), apply damage, sneak-attack
   * rider, and death. Shared by the attack action, extra-attack abilities, and
   * parting swipes at a fleeing target.
   */
  private weaponStrike(
    state: CombatState,
    attacker: CombatEntity,
    target: CombatEntity,
    edge: RollEdge = "normal"
  ): CombatEvent[] {
    const events: CombatEvent[] = [];
    const weapon = attacker.stats.equippedWeapon;

    // Cover: a target fighting from a cover tile is harder to hit.
    const targetCell = getCell(state.grid, target.position);
    const cover      = targetCell ? coverBonus(targetCell.type) : 0;
    const effectiveAc = target.stats.ac + cover;

    const result = rollAttack(attacker.stats, effectiveAc, weapon, edge);

    const coverNote = cover > 0 ? ` (+${cover} cover)` : "";
    const edgeNote  = edge === "advantage" ? " (advantage)" : edge === "disadvantage" ? " (disadvantage)" : "";
    events.push({
      type: "attack_roll", round: state.round,
      entityId: attacker.id, targetId: target.id,
      roll: { d20: result.roll.result, modifier: result.roll.modifier, total: result.roll.total, dc: effectiveAc },
      text: `${attacker.name} attacks ${target.name}: ${result.roll.result}+${result.roll.modifier}=${result.roll.total} vs AC ${effectiveAc}${coverNote}${edgeNote}`,
    });

    if (result.hit && result.damage) {
      // Sneak attack bonus for Thief
      let bonus = 0;
      const sneakAbility = attacker.stats.classAbilities?.find(a => a.id === "sneak_attack");
      if (sneakAbility) {
        const allyAdj = state.entities.some(
          e => e.type === "player" && e.id !== attacker.id && !e.isDead &&
               chebyshev(e.position, target.position) <= 1
        );
        if (allyAdj && sneakAbility.effect.damage) {
          bonus = rollDice(sneakAbility.effect.damage);
        }
      }
      const totalDmg = result.damage.total + bonus;
      target.hp = Math.max(0, target.hp - totalDmg);

      events.push({
        type: result.crit ? "attack_crit" : "attack_hit",
        round: state.round, entityId: attacker.id, targetId: target.id,
        value: totalDmg,
        text: result.crit
          ? `Critical hit! ${attacker.name} deals ${totalDmg} damage to ${target.name}.`
          : `${attacker.name} hits ${target.name} for ${totalDmg} damage.`,
      });
      events.push({
        type: "damage", round: state.round, entityId: attacker.id, targetId: target.id,
        value: totalDmg, text: `${target.name}: ${target.hp}/${target.maxHp} HP`,
      });

      if (target.hp <= 0) {
        target.isDead = true; setCell(state.grid, target.position, undefined);
        events.push({ type: "entity_dies", round: state.round, entityId: target.id, text: `${target.name} is defeated!` });
      }
    } else {
      events.push({
        type: "attack_miss", round: state.round, entityId: attacker.id, targetId: target.id,
        text: `${attacker.name} misses ${target.name}.`,
      });
    }
    return events;
  }

  // ── Ability ────────────────────────────────────────────────────────────────

  private processAbility(
    state: CombatState,
    caster: CombatEntity,
    abilityId: string,
    targetId?: string
  ): CombatEvent[] {
    const events: CombatEvent[] = [];
    const ability = caster.stats.classAbilities?.find(a => a.id === abilityId);
    if (!ability || ability.type !== "active") return events;
    if (ability.cooldownRounds > 0 && (caster.abilityUses[abilityId] ?? 0) <= 0) return events;

    const target = targetId ? state.entities.find(e => e.id === targetId) : undefined;

    // Range gate (safety net — the client already restricts targeting). A
    // targeted ability needs a living target within reach, measured from the
    // caster's CURRENT tile, which is their post-move position since moves
    // resolve before actions. Out of reach → the ability neither fires nor
    // expends its use.
    if (ability.targetType === "enemy" || ability.targetType === "ally") {
      const reach = abilityRange(ability, caster.stats.equippedWeapon.range);
      if (!target || target.isDead || chebyshev(caster.position, target.position) > reach) {
        events.push({
          type: "ability_used", round: state.round, entityId: caster.id,
          abilityId, text: `${caster.name} readies ${ability.name}, but the target is out of reach.`,
        });
        return events;
      }
    }

    if (ability.cooldownRounds > 0) caster.abilityUses[abilityId] = 0;

    events.push({
      type: "ability_used", round: state.round, entityId: caster.id,
      abilityId, text: `${caster.name} uses ${ability.name}!`,
    });

    // Healing
    if (ability.effect.heal) {
      const t = ability.targetType === "ally" && target ? target : caster;
      if (!t.isDead) {
        const amount = resolveHealingDice(ability.effect.heal, caster.stats);
        t.hp = Math.min(t.maxHp, t.hp + amount);
        events.push({ type: "heal", round: state.round, entityId: caster.id, targetId: t.id, value: amount, text: `${t.name} recovers ${amount} HP (${t.hp}/${t.maxHp}).` });
      }
    }

    // Magic Missile — always hits, 3 darts
    if (abilityId === "magic_missile" && target && !target.isDead) {
      let total = 0;
      for (let i = 0; i < 3; i++) total += rollDice(ability.effect.damage ?? "1d4+1");
      target.hp = Math.max(0, target.hp - total);
      events.push({ type: "damage", round: state.round, entityId: caster.id, targetId: target.id, value: total, text: `Magic Missile strikes ${target.name} for ${total} force damage.` });
      if (target.hp <= 0) {
        target.isDead = true; setCell(state.grid, target.position, undefined);
        events.push({ type: "entity_dies", round: state.round, entityId: target.id, text: `${target.name} is defeated!` });
      }
    }

    // Other damage abilities (require attack roll)
    if (ability.effect.damage && abilityId !== "magic_missile" && target && !target.isDead) {
      const targetCell  = getCell(state.grid, target.position);
      const cover       = targetCell ? coverBonus(targetCell.type) : 0;
      const effectiveAc = target.stats.ac + cover;
      const res = rollAttack(caster.stats, effectiveAc, caster.stats.equippedWeapon, this.targetEdge(target));
      events.push({ type: "attack_roll", round: state.round, entityId: caster.id, targetId: target.id, roll: { d20: res.roll.result, modifier: res.roll.modifier, total: res.roll.total, dc: effectiveAc }, text: `${caster.name} uses ${ability.name}: ${res.roll.total} vs AC ${effectiveAc}` });
      if (res.hit) {
        const dmg = rollDice(ability.effect.damage);
        target.hp = Math.max(0, target.hp - dmg);
        events.push({ type: "damage", round: state.round, entityId: caster.id, targetId: target.id, value: dmg, text: `${target.name} takes ${dmg} damage.` });
        if (ability.effect.condition && !target.conditions.includes(ability.effect.condition)) {
          target.conditions.push(ability.effect.condition);
          events.push({ type: "condition_applied", round: state.round, entityId: target.id, condition: ability.effect.condition, text: `${target.name} is now ${ability.effect.condition}.` });
        }
        if (target.hp <= 0) {
          target.isDead = true; setCell(state.grid, target.position, undefined);
          events.push({ type: "entity_dies", round: state.round, entityId: target.id, text: `${target.name} is defeated!` });
        }
      } else {
        events.push({ type: "attack_miss", round: state.round, entityId: caster.id, targetId: target.id, text: `${caster.name}'s ${ability.name} misses.` });
      }
    }

    // Extra weapon attacks (Reckless Attack, Battle Cry, Flurry of Blows,
    // Rapid Fire, Valiant Charge's follow-up). These are real strikes with the
    // equipped weapon — previously this flag was never read and the abilities
    // burned the turn doing nothing.
    if (ability.effect.extraAttack) {
      const reach = caster.stats.equippedWeapon.range;
      // Self-targeted battle-shouts strike whoever is nearest in reach.
      let struck = target && !target.isDead && target.type !== caster.type
        ? target
        : this.foesInReach(state, caster, reach)[0];

      if (!struck) {
        events.push({
          type: "action_fizzles", round: state.round, entityId: caster.id,
          text: `${caster.name}'s ${ability.name} finds no one in reach to strike.`,
        });
      } else {
        // Reckless swings and rallying cries land with advantage; the reckless
        // fighter drops their guard doing it (attacks on them get advantage too).
        const wild = abilityId === "reckless_attack" || abilityId === "battle_cry";
        const strikes = abilityId === "flurry_of_blows" || abilityId === "rapid_fire" ? 2 : 1;
        for (let i = 0; i < strikes && struck && !struck.isDead; i++) {
          events.push(...this.weaponStrike(
            state, caster, struck,
            this.targetEdge(struck, wild ? "advantage" : "normal")
          ));
        }
        if (abilityId === "reckless_attack" && !caster.conditions.includes("reckless")) {
          caster.conditions.push("reckless");
          events.push({
            type: "condition_applied", round: state.round, entityId: caster.id, condition: "reckless",
            text: `${caster.name} fights with abandon — attacks against them are emboldened until they next act.`,
          });
        }
      }
    }

    return events;
  }

  // ── Items ──────────────────────────────────────────────────────────────────

  /**
   * Spend a carried consumable as the turn's action. The real inventory was
   * already debited when the plan was submitted (index.ts); this applies the
   * effect to the combat entity and keeps the in-fight count in step.
   */
  private processItem(state: CombatState, e: CombatEntity, itemId: string): CombatEvent[] {
    const events: CombatEvent[] = [];
    const def = itemById(itemId);
    const have = e.consumables?.[itemId] ?? 0;
    if (!def?.consumable || have <= 0) {
      events.push({
        type: "action_fizzles", round: state.round, entityId: e.id,
        text: `${e.name} fumbles through their pack, but finds nothing to use.`,
      });
      return events;
    }
    e.consumables![itemId] = have - 1;

    events.push({
      type: "item_used", round: state.round, entityId: e.id,
      text: `${e.name} uses a ${def.name}.`,
    });

    if (def.consumable.heal) {
      const amount = rollDice(def.consumable.heal);
      e.hp = Math.min(e.maxHp, e.hp + amount);
      events.push({
        type: "heal", round: state.round, entityId: e.id, targetId: e.id, value: amount,
        text: `${e.name} recovers ${amount} HP (${e.hp}/${e.maxHp}).`,
      });
    }
    if (def.consumable.cure && e.conditions.includes(def.consumable.cure)) {
      e.conditions = e.conditions.filter(c => c !== def.consumable!.cure);
      events.push({
        type: "condition_removed", round: state.round, entityId: e.id, condition: def.consumable.cure,
        text: `${e.name} is no longer ${def.consumable.cure}.`,
      });
    }
    return events;
  }

  // ── Flee ───────────────────────────────────────────────────────────────────

  /**
   * Break from the fight. Every foe close enough gets one parting swipe as the
   * runner turns their back — escape is allowed, but never free. If they
   * survive the gauntlet they're out: alive, unlooted, unrewarded.
   */
  private processFlee(state: CombatState, e: CombatEntity): CombatEvent[] {
    const events: CombatEvent[] = [{
      type: "flee", round: state.round, entityId: e.id,
      text: `${e.name} breaks for the edge of the fight!`,
    }];

    for (const foe of state.entities.filter(x => x.type !== e.type && !x.isDead && !x.fled)) {
      if (chebyshev(foe.position, e.position) > foe.stats.equippedWeapon.range) continue;
      events.push(...this.weaponStrike(state, foe, e, this.targetEdge(e)));
      if (e.isDead) {
        events.push({
          type: "entity_dies", round: state.round, entityId: e.id,
          text: `${e.name} is cut down before they can escape!`,
        });
        return events;
      }
    }

    e.fled = true;
    setCell(state.grid, e.position, undefined);
    events.push({
      type: "flee", round: state.round, entityId: e.id,
      text: `${e.name} escapes the fight.`,
    });
    return events;
  }

  // ── Enemy AI ───────────────────────────────────────────────────────────────

  /**
   * One enemy's plan for this round, generated at its slot in the initiative
   * order so it sees the board as it truly is. Uses the creature's full speed
   * (the old AI shuffled one tile a round regardless of stats) and routes
   * around whatever is in the way.
   */
  private generateEnemyPlan(state: CombatState, enemy: CombatEntity): CombatActionSubmission | undefined {
    const players = state.entities.filter(e => e.type === "player" && !e.isDead && !e.fled);
    if (!players.length) return undefined;

    const nearest = players.reduce((best, p) =>
      chebyshev(enemy.position, p.position) < chebyshev(enemy.position, best.position) ? p : best
    , players[0]!);

    const reach = enemy.stats.equippedWeapon.range;
    if (chebyshev(enemy.position, nearest.position) <= reach) {
      return { entityId: enemy.id, action: { type: "attack", targetEntityId: nearest.id } };
    }

    const approach = bestApproach(state.grid, enemy.position, nearest.position, enemy.stats.speed, enemy.id);
    if (!approach) return { entityId: enemy.id };

    const inReachAfter = chebyshev(approach.dest, nearest.position) <= reach;
    return {
      entityId: enemy.id,
      move: approach.dest,
      ...(inReachAfter && { action: { type: "attack", targetEntityId: nearest.id } }),
    };
  }

  private isOver(state: CombatState): boolean {
    return (
      !state.entities.some(e => e.type === "player" && !e.isDead && !e.fled) ||
      !state.entities.some(e => e.type === "enemy"  && !e.isDead)
    );
  }
}

export const combatManager = new CombatManager();
