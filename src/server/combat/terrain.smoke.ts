/**
 * terrain.smoke.ts — Verifies tactical terrain end-to-end:
 *   - the TERRAIN table is self-consistent (passability ↔ entry cost),
 *   - a fresh encounter has terrain scattered into its midfield,
 *   - a move emits the actual tile-by-tile PATH (origin→dest, contiguous),
 *   - ending a move on embers burns the mover,
 *   - a target standing on cover is harder to hit (effective AC includes the bonus).
 *
 * Drives the real CombatManager so the server math and the shared TERRAIN data
 * can't drift apart. Run with: npx tsx src/server/combat/terrain.smoke.ts
 */

import assert from "node:assert/strict";

import {
  CombatManager, buildPlayerCombatEntity, buildEnemyCombatEntity,
} from "./CombatManager";
import {
  TERRAIN, entryCost, coverBonus, hazardDamage,
  type GridCellType, type GridPosition, type CombatEvent,
} from "../../types/combat";

let passed = 0;
function check(label: string, fn: () => void): void {
  fn();
  passed++;
  console.log(`  ok — ${label}`);
}

check("TERRAIN table is self-consistent", () => {
  assert.equal(entryCost("floor"), 1);
  assert.equal(entryCost("rubble"), 2, "rubble is difficult terrain");
  assert.equal(entryCost("wall"), Infinity, "impassable tiles cost ∞");
  assert.equal(entryCost("obstacle"), Infinity);
  assert.equal(coverBonus("cover"), 2);
  assert.equal(coverBonus("floor"), 0);
  assert.equal(hazardDamage("embers"), 4);
  assert.equal(hazardDamage("floor"), 0);
  // Every entry: impassable ⇔ infinite cost.
  for (const [type, meta] of Object.entries(TERRAIN)) {
    assert.equal(
      meta.passable, entryCost(type as GridCellType) !== Infinity,
      `${type} passability matches its cost`
    );
  }
});

function freshCombat(roomId = "cellar") {
  const mgr = new CombatManager();
  const player = buildPlayerCombatEntity({
    playerId: "p1", name: "Aelric", characterClass: "Knight",
    hp: 40, position: { x: 0, y: 7 },
  });
  const enemy = buildEnemyCombatEntity({
    id: "e1", name: "Rat", position: { x: 7, y: 0 },
  });
  const state = mgr.createCombat(roomId, [player], [enemy]);
  return { mgr, state, player, enemy };
}

function terrainKinds(grid: { type: GridCellType }[][]): Set<GridCellType> {
  const kinds = new Set<GridCellType>();
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
    const t = grid[y]![x]!.type;
    if (t !== "floor") kinds.add(t);
    if (y === 7 || y === 0) assert.equal(t, "floor", `spawn row (${x},${y}) is floor`);
  }
  return kinds;
}

check("the cellar gets plain basement props — barrels/crates, no hazards", () => {
  const { state } = freshCombat("cellar");
  const kinds = terrainKinds(state.grid as { type: GridCellType }[][]);
  assert.ok(kinds.has("barrel") || kinds.has("crate"), "cellar has barrels/crates");
  for (const banned of ["embers", "cover", "rubble"] as GridCellType[]) {
    assert.ok(!kinds.has(banned), `cellar has no ${banned}`);
  }
});

check("a fog battle earns dramatic tactical terrain", () => {
  const { state } = freshCombat("fog_road");
  const kinds = terrainKinds(state.grid as { type: GridCellType }[][]);
  for (const want of ["cover", "rubble", "embers"] as GridCellType[]) {
    assert.ok(kinds.has(want), `fog_road has ${want}`);
  }
});

function playerMoveEvents(dest: GridPosition): CombatEvent[] {
  const { mgr, state, player } = freshCombat();
  mgr.submitAction(state.id, { entityId: player.id, move: dest });
  return mgr.resolveRound(state.id).events.filter(e => e.entityId === player.id);
}

check("a move emits the actual contiguous path (origin → destination)", () => {
  const dest = { x: 2, y: 7 };
  const move = playerMoveEvents(dest).find(e => e.type === "move");
  assert.ok(move, "a move event was emitted");
  const path = move!.path!;
  assert.ok(Array.isArray(path) && path.length >= 2, "path has ≥2 cells");
  assert.deepEqual(path[0], { x: 0, y: 7 }, "path starts at the origin");
  assert.deepEqual(path[path.length - 1], dest, "path ends at the destination");
  for (let i = 1; i < path.length; i++) {
    const step = Math.max(Math.abs(path[i]!.x - path[i - 1]!.x), Math.abs(path[i]!.y - path[i - 1]!.y));
    assert.equal(step, 1, "each path step is to an adjacent cell");
  }
});

check("ending a move on embers burns the mover", () => {
  const mgr = new CombatManager();
  const player = buildPlayerCombatEntity({
    playerId: "p1", name: "Aelric", characterClass: "Knight",
    hp: 40, position: { x: 0, y: 7 },
  });
  const enemy = buildEnemyCombatEntity({ id: "e1", name: "Rat", position: { x: 7, y: 0 } });
  const state = mgr.createCombat("tavern", [player], [enemy]);

  // Plant embers on a free spawn-row tile next to the player and step onto it.
  const cell = state.grid[7]![1]!;
  cell.type = "embers"; cell.passable = true;

  mgr.submitAction(state.id, { entityId: player.id, move: { x: 1, y: 7 } });
  const events = mgr.resolveRound(state.id).events.filter(e => e.entityId === player.id);
  const burn = events.find(e => e.type === "burn_damage");
  assert.ok(burn, "embers dealt burn damage");
  assert.equal(burn!.value, hazardDamage("embers"), "burn equals the tile's hazard damage");
});

check("a target on cover is harder to hit (effective AC includes the bonus)", () => {
  const mgr = new CombatManager();
  const player = buildPlayerCombatEntity({
    playerId: "p1", name: "Aelric", characterClass: "Knight",
    hp: 40, position: { x: 1, y: 7 },
  });
  const enemy = buildEnemyCombatEntity({ id: "e1", name: "Rat", position: { x: 2, y: 7 } });
  const state = mgr.createCombat("tavern", [player], [enemy]);

  const baseAc = enemy.stats.ac;
  // Put the enemy on cover, then attack it from melee range.
  const cell = state.grid[7]![2]!;
  cell.type = "cover"; cell.passable = true;

  mgr.submitAction(state.id, { entityId: player.id, action: { type: "attack", targetEntityId: enemy.id } });
  const roll = mgr.resolveRound(state.id).events.find(
    e => e.type === "attack_roll" && e.entityId === player.id && e.targetId === enemy.id
  );
  assert.ok(roll, "an attack roll was made");
  assert.equal(roll!.roll!.dc, baseAc + coverBonus("cover"), "AC is raised by the cover bonus");
});

console.log(`\nterrain.smoke: ${passed} checks passed.`);
