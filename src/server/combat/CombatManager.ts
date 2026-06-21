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
  CombatStateView, CombatEntityView, GridCell, GridPosition,
  CombatOutcome, AbilityStatus,
} from "../../types/combat";
import { GRID_COLS, GRID_ROWS } from "../../types/combat";
import type { CharacterStats, CharacterClass } from "../../types/character";
import { buildCharacterStats, CLASS_DEFAULT_WEAPONS } from "../../types/character";
import {
  rollDie, rollDice, rollAttack, rollInitiative,
  getAbilityModifier, resolveHealingDice, rollBurnDamage,
} from "../skills/SkillEngine";

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

function setCell(
  grid: GridCell[][],
  pos: GridPosition,
  entityId: string | undefined
): void {
  const cell = getCell(grid, pos);
  if (cell) cell.entityId = entityId;
}

function manhattan(a: GridPosition, b: GridPosition): number {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}

/** BFS reachability; diagonal costs 1. Returns true if destination reachable. */
function canReach(
  grid: GridCell[][],
  from: GridPosition,
  to: GridPosition,
  maxSteps: number,
  ownId: string
): boolean {
  if (from.x === to.x && from.y === to.y) return true;
  const visited = new Set<string>();
  const q: Array<{ pos: GridPosition; steps: number }> = [{ pos: from, steps: 0 }];
  const dirs = [[-1,0],[1,0],[0,-1],[0,1],[-1,-1],[1,-1],[-1,1],[1,1]];
  while (q.length) {
    const { pos, steps } = q.shift()!;
    const key = `${pos.x},${pos.y}`;
    if (visited.has(key)) continue;
    visited.add(key);
    if (pos.x === to.x && pos.y === to.y) return true;
    if (steps >= maxSteps) continue;
    for (const [dx, dy] of dirs) {
      const nx = pos.x + dx, ny = pos.y + dy;
      if (nx < 0 || ny < 0 || ny >= GRID_ROWS || nx >= GRID_COLS) continue;
      const cell = grid[ny]?.[nx];
      if (!cell?.passable) continue;
      if (cell.entityId && cell.entityId !== ownId) continue;
      q.push({ pos: { x: nx, y: ny }, steps: steps + 1 });
    }
  }
  return false;
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
          targetType:    a.targetType,
        }))
    : [];
  return {
    id:         e.id,
    name:       e.name,
    type:       e.type,
    playerId:   e.playerId,
    position:   e.position,
    hp:         e.hp,
    maxHp:      e.maxHp,
    ac:         e.stats.ac,
    speed:      e.stats.speed,
    initiative: e.initiative,
    conditions: e.conditions,
    isDead:     e.isDead,
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
    myEntityId: myEntity?.id,
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

/** Builds a combat entity from a player character. */
export function buildPlayerCombatEntity(params: {
  playerId: string;
  name: string;
  characterClass: CharacterClass;
  hp: number;
  position: GridPosition;
}): CombatEntity {
  const stats = buildCharacterStats(params.characterClass, 1);
  return {
    id:          `player-${params.playerId}`,
    name:        params.name,
    type:        "player",
    playerId:    params.playerId,
    position:    params.position,
    hp:          params.hp,
    maxHp:       params.hp,
    stats,
    initiative:  0,
    conditions:  [],
    abilityUses: { ...stats.abilityUses },
    isDead:      false,
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
    return { events, isOver: over, outcome: state.outcome };
  }

  // ── Move ───────────────────────────────────────────────────────────────────

  private processMove(
    state: CombatState,
    e: CombatEntity,
    dest: GridPosition
  ): CombatEvent[] {
    if (!canReach(state.grid, e.position, dest, e.stats.speed, e.id)) return [];
    setCell(state.grid, e.position, undefined);
    e.position = dest;
    setCell(state.grid, dest, e.id);
    return [{
      type: "move", round: state.round, entityId: e.id, position: dest,
      text: `${e.name} moves to (${dest.x}, ${dest.y}).`,
    }];
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

    const result = rollAttack(attacker.stats, target.stats.ac, weapon);

    events.push({
      type: "attack_roll", round: state.round,
      entityId: attacker.id, targetId: target.id,
      roll: { d20: result.roll.result, modifier: result.roll.modifier, total: result.roll.total, dc: target.stats.ac },
      text: `${attacker.name} attacks ${target.name}: ${result.roll.result}+${result.roll.modifier}=${result.roll.total} vs AC ${target.stats.ac}`,
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
    if (ability.cooldownRounds > 0) caster.abilityUses[abilityId] = 0;

    events.push({
      type: "ability_used", round: state.round, entityId: caster.id,
      abilityId, text: `${caster.name} uses ${ability.name}!`,
    });

    const target = targetId ? state.entities.find(e => e.id === targetId) : undefined;

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

      state.submissions[enemy.id] = { entityId: enemy.id, move, action };
    }
  }

  private stepToward(
    state: CombatState,
    e: CombatEntity,
    target: GridPosition
  ): GridPosition | undefined {
    const dirs = [[-1,0],[1,0],[0,-1],[0,1],[-1,-1],[1,-1],[-1,1],[1,1]];
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
