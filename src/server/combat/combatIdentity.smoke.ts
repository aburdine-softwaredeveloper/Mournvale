/**
 * combatIdentity.smoke.ts — Guards the combat identity contract that the
 * delivery bug violated: a player's combat entity must be keyed by the SAME id
 * the client uses (its persistent playerId), so getViewForPlayer resolves
 * myEntityId and emitToPlayer/pendingPlayerIds line up.
 *
 * Run with: npx tsx src/server/combat/combatIdentity.smoke.ts
 */

import assert from "node:assert/strict";

import {
  CombatManager, buildPlayerCombatEntity, buildEnemyCombatEntity,
} from "./CombatManager";

const PERSISTENT_ID = "persistent-player-abc123";

let passed = 0;
function check(label: string, fn: () => void): void {
  fn();
  passed++;
  console.log(`  ok — ${label}`);
}

const mgr = new CombatManager();

const player = buildPlayerCombatEntity({
  playerId: PERSISTENT_ID,
  name: "Aelric",
  characterClass: "Knight",
  hp: 30,
  position: { x: 0, y: 7 },
});
const enemy = buildEnemyCombatEntity({
  id: "goblin-1", name: "Goblin", position: { x: 3, y: 0 }, hp: 20, ac: 13,
});

const state = mgr.createCombat("tavern", [player], [enemy]);

check("entity id and playerId both derive from the persistent playerId", () => {
  assert.equal(player.playerId, PERSISTENT_ID);
  assert.equal(player.id, `player-${PERSISTENT_ID}`);
});

check("getViewForPlayer(persistentId) resolves myEntityId to the player entity", () => {
  const view = mgr.getViewForPlayer(state.id, PERSISTENT_ID);
  assert.ok(view, "view should exist");
  assert.equal(view!.myEntityId, player.id, "myEntityId must match the player's entity id");
  const me = view!.entities.find((e) => e.id === view!.myEntityId);
  assert.ok(me, "myEntityId must point at a real entity in the view");
  assert.equal(me!.playerId, PERSISTENT_ID);
});

check("a wrong (session-style) id does NOT resolve — proves keying matters", () => {
  const view = mgr.getViewForPlayer(state.id, "some-session-uuid");
  assert.ok(view, "view still builds");
  assert.equal(view!.myEntityId, undefined, "non-matching id yields no myEntity");
});

console.log(`\n✓ combat identity smoke: ${passed} checks passed`);
