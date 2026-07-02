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
  CombatOutcome, AbilityStatus,
} from "../../types/combat";
import {
  GRID_COLS, GRID_ROWS, entryCost, coverBonus, hazardDamage,
} from "../../types/combat";
import type { CharacterStats, CharacterClass } from "../../types/character";
import { buildCharacterStats, CLASS_DEFAULT_WEAPONS, abilityRange } from "../../types/character";
import type { Inventory } from "../../types/items";
import { applyEquipment, equipmentBonusHp } from "../../types/items";
import type { ProgressionState } from "../../types/progression";
import {
  applyProgression, equippedAbilityIds, talentBonusHp,
} from "../../types/progression";
import { CLASS_TALENT_TREES } from "../../types/talents";
import {
  rollDie, rollDice, rollAttack, rollInitiative,
  getAbilityModifier, resolveHealingDice, rollBurnDamage,
} from "../skills/SkillEngine";
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

function manhattan(a: GridPosition, b: GridPosition): number {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}

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
    isDead:     e.isDead,
    ...(e.playerId !== undefined && { playerId: e.playerId }),
    ...(e.sprite !== undefined && { sprite: e.sprite }),
    ...(isOwner && { weapon: e.stats.equippedWeapon, abilities }),
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
  if (params.inventory) {
    stats = applyEquipment(stats, params.inventory);
    maxHp += equipmentBonusHp(params.inventory);
  }

  return {
    id:          `player-${params.playerId}`,
    name:        params.name,
    type:        "player",
    playerId:    params.playerId,
    position:    params.position,
    hp:          maxHp,
    maxHp,
    stats,
    initiative:  0,
    conditions:  [],
    abilityUses: { ...stats.abilityUses },
    isDead:      false,
    // Sprite art key = the class name lowercased ("warrior", "mage", …).
    sprite:      params.characterClass.toLowerCase(),
  };
}

// ─── CombatManager ────────────────────────────────────────────────────────────

export class CombatManager {
  private readonly combats = new Map<string, CombatState>();

  // ── Lifecycle ──────────────────────────────────────────────────────────────

  createCombat(
    roomId: string,
    playerEntities: CombatEntity[],
    enemyEntities: CombatEntity[]
  ): CombatState {
    const entities = [...playerEntities, ...enemyEntities];
    const grid     = buildEmptyGrid();

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
      if (!e.isDead && e.conditions.includes("burning")) {
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

    // Generate AI submissions for enemies
    this.generateEnemySubmissions(state);

    // Process in initiative order
    for (const entityId of state.initiativeOrder) {
      if (this.isOver(state)) break;
      const e = state.entities.find(x => x.id === entityId);
      if (!e || e.isDead) continue;
      const sub = state.submissions[entityId];
      if (!sub) continue;
      if (sub.move)   events.push(...this.processMove(state, e, sub.move));
      if (sub.action) events.push(...this.processAction(state, e, sub.action));
    }

    const over = this.isOver(state);
    if (over) {
      const playersAlive = state.entities.some(e => e.type === "player" && !e.isDead);
      state.outcome = playersAlive ? "players_win" : "players_lose";
      state.phase   = "complete";
      events.push({
        type: "combat_ends", round: state.round, entityId: "",
        text: playersAlive ? "Victory! All enemies defeated." : "The party has fallen…",
      });
    } else {
      state.round++;
      state.phase           = "planning";
      state.submissions     = {};
      state.pendingSubmissions = state.entities
        .filter(e => e.type === "player" && !e.isDead)
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
    dest: GridPosition
  ): CombatEvent[] {
    const route = findPath(state.grid, e.position, dest, e.stats.speed, e.id);
    if (!route) return [];

    setCell(state.grid, e.position, undefined);
    e.position = dest;
    setCell(state.grid, dest, e.id);

    const events: CombatEvent[] = [{
      type: "move", round: state.round, entityId: e.id, position: dest,
      path: route.path,
      text: `${e.name} moves to (${dest.x}, ${dest.y}).`,
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
    action: NonNullable<CombatActionSubmission["action"]>
  ): CombatEvent[] {
    switch (action.type) {
      case "attack":
        return action.targetEntityId
          ? this.processAttack(state, e, action.targetEntityId)
          : [];
      case "ability":
        return action.abilityId
          ? this.processAbility(state, e, action.abilityId, action.targetEntityId)
          : [];
      case "dodge":
        return [{ type: "ability_used", round: state.round, entityId: e.id, text: `${e.name} takes the dodge action.` }];
      default:
        return [];
    }
  }

  // ── Attack ─────────────────────────────────────────────────────────────────

  private processAttack(
    state: CombatState,
    attacker: CombatEntity,
    targetId: string
  ): CombatEvent[] {
    const events: CombatEvent[] = [];
    const target = state.entities.find(e => e.id === targetId);
    if (!target || target.isDead) return events;

    const weapon = attacker.stats.equippedWeapon;
    if (manhattan(attacker.position, target.position) > weapon.range) return events;

    // Cover: a target fighting from a cover tile is harder to hit.
    const targetCell = getCell(state.grid, target.position);
    const cover      = targetCell ? coverBonus(targetCell.type) : 0;
    const effectiveAc = target.stats.ac + cover;

    const result = rollAttack(attacker.stats, effectiveAc, weapon);

    const coverNote = cover > 0 ? ` (+${cover} cover)` : "";
    events.push({
      type: "attack_roll", round: state.round,
      entityId: attacker.id, targetId: target.id,
      roll: { d20: result.roll.result, modifier: result.roll.modifier, total: result.roll.total, dc: effectiveAc },
      text: `${attacker.name} attacks ${target.name}: ${result.roll.result}+${result.roll.modifier}=${result.roll.total} vs AC ${effectiveAc}${coverNote}`,
    });

    if (result.hit && result.damage) {
      // Sneak attack bonus for Thief
      let bonus = 0;
      const sneakAbility = attacker.stats.classAbilities?.find(a => a.id === "sneak_attack");
      if (sneakAbility) {
        const allyAdj = state.entities.some(
          e => e.type === "player" && e.id !== attacker.id && !e.isDead &&
               manhattan(e.position, target.position) <= 1
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
      if (!target || target.isDead || manhattan(caster.position, target.position) > reach) {
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
      const res = rollAttack(caster.stats, target.stats.ac, caster.stats.equippedWeapon);
      events.push({ type: "attack_roll", round: state.round, entityId: caster.id, targetId: target.id, roll: { d20: res.roll.result, modifier: res.roll.modifier, total: res.roll.total, dc: target.stats.ac }, text: `${caster.name} uses ${ability.name}: ${res.roll.total} vs AC ${target.stats.ac}` });
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

    return events;
  }

  // ── Enemy AI ───────────────────────────────────────────────────────────────

  private generateEnemySubmissions(state: CombatState): void {
    const enemies = state.entities.filter(e => e.type === "enemy" && !e.isDead);
    const players = state.entities.filter(e => e.type === "player" && !e.isDead);
    if (!players.length) return;

    for (const enemy of enemies) {
      if (state.submissions[enemy.id]) continue;
      const nearest = players.reduce((best, p) =>
        manhattan(enemy.position, p.position) < manhattan(enemy.position, best.position) ? p : best
      , players[0]!);

      const dist  = manhattan(enemy.position, nearest.position);
      const range = enemy.stats.equippedWeapon.range;
      let move: GridPosition | undefined;
      let action: CombatActionSubmission["action"];

      if (dist > range) {
        move = this.stepToward(state, enemy, nearest.position);
        const distAfterMove = move ? manhattan(move, nearest.position) : dist;
        if (distAfterMove <= range) action = { type: "attack", targetEntityId: nearest.id };
      } else {
        action = { type: "attack", targetEntityId: nearest.id };
      }

      state.submissions[enemy.id] = {
        entityId: enemy.id,
        ...(move && { move }),
        ...(action && { action }),
      };
    }
  }

  private stepToward(
    state: CombatState,
    e: CombatEntity,
    target: GridPosition
  ): GridPosition | undefined {
    const dirs: Array<[number, number]> = [[-1,0],[1,0],[0,-1],[0,1],[-1,-1],[1,-1],[-1,1],[1,1]];
    let best: GridPosition | undefined;
    let bestDist = Infinity;
    for (const [dx, dy] of dirs) {
      const nx = e.position.x + dx, ny = e.position.y + dy;
      if (nx < 0 || ny < 0 || ny >= GRID_ROWS || nx >= GRID_COLS) continue;
      const cell = state.grid[ny]?.[nx];
      if (!cell?.passable || cell.entityId) continue;
      const d = manhattan({ x: nx, y: ny }, target);
      if (d < bestDist) { bestDist = d; best = { x: nx, y: ny }; }
    }
    return best;
  }

  private isOver(state: CombatState): boolean {
    return (
      !state.entities.some(e => e.type === "player" && !e.isDead) ||
      !state.entities.some(e => e.type === "enemy"  && !e.isDead)
    );
  }
}

export const combatManager = new CombatManager();
