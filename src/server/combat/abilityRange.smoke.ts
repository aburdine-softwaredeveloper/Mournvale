/**
 * abilityRange.smoke.ts — Verifies ability range: the resolver's defaults and
 * overrides, and the server gate that stops an out-of-reach ability from firing
 * (the fix for "Shield Bash across the map") while still letting an in-reach one
 * land. Drives the real CombatManager so the data and the gate stay in sync.
 *
 * Run with: npx tsx src/server/combat/abilityRange.smoke.ts
 */

import assert from "node:assert/strict";

import { CombatManager, buildPlayerCombatEntity, buildEnemyCombatEntity } from "./CombatManager";
import { abilityRange, abilityById, DEFAULT_SUPPORT_RANGE } from "../../types/character";

let passed = 0;
function check(label: string, fn: () => void): void {
  fn();
  passed++;
  console.log(`  ok — ${label}`);
}

check("abilityRange resolves defaults and overrides", () => {
  // Self abilities ignore range.
  assert.equal(abilityRange({ targetType: "self" }, 1), Infinity);
  // Explicit range wins (Healer's ranged radiant spells set their own).
  assert.equal(abilityRange(abilityById("Healer", "sacred_flame")!, 1), 5);
  assert.equal(abilityRange(abilityById("Healer", "guiding_bolt")!, 1), 6);
  // Touch heal overrides the support default down to 1.
  assert.equal(abilityRange(abilityById("Healer", "cure_wounds")!, 1), 1);
  // Offensive abilities with no explicit range default to weapon reach…
  assert.equal(abilityRange(abilityById("Knight", "shield_bash")!, 1), 1);
  assert.equal(abilityRange(abilityById("Archer", "piercing_shot")!, 6), 6);
  // …and support abilities default to a short throw.
  assert.equal(abilityRange(abilityById("Healer", "healing_word")!, 1), DEFAULT_SUPPORT_RANGE);
});

function combatWithRatAt(ratPos: { x: number; y: number }) {
  const mgr = new CombatManager();
  const player = buildPlayerCombatEntity({
    playerId: "p1", name: "Aelric", characterClass: "Knight",
    hp: 40, position: { x: 0, y: 7 },
  });
  const rat = buildEnemyCombatEntity({ id: "e1", name: "Rat", position: ratPos });
  const state = mgr.createCombat("cellar", [player], [rat]);
  // Entity ids are namespaced ("player-…" / "enemy-…"); read the real ones back.
  const me = state.entities.find(e => e.type === "player")!;
  const foe = state.entities.find(e => e.type === "enemy")!;
  return { mgr, state, me, foe };
}

check("an out-of-reach ability is gated — it neither fires nor expends", () => {
  // Shield Bash (range 1) cast at a rat across the board.
  const { mgr, state, me, foe } = combatWithRatAt({ x: 7, y: 0 });
  const hpBefore = foe.hp;
  mgr.submitAction(state.id, { entityId: me.id, action: { type: "ability", abilityId: "shield_bash", targetEntityId: foe.id } });
  const events = mgr.resolveRound(state.id).events.filter(e => e.entityId === me.id);
  const note = events.find(e => e.type === "ability_used");
  assert.ok(note && /out of reach/i.test(note.text), "got an out-of-reach note");
  assert.ok(!events.some(e => e.type === "damage" || e.type === "condition_applied"),
    "no damage/condition was applied by the player");
  assert.equal(foe.hp, hpBefore, "the rat took no damage");
});

check("an in-reach ability fires normally", () => {
  // Rat adjacent to the Knight → Shield Bash is in range and resolves.
  const { mgr, state, me, foe } = combatWithRatAt({ x: 1, y: 7 });
  mgr.submitAction(state.id, { entityId: me.id, action: { type: "ability", abilityId: "shield_bash", targetEntityId: foe.id } });
  const events = mgr.resolveRound(state.id).events.filter(e => e.entityId === me.id);
  const note = events.find(e => e.type === "ability_used");
  assert.ok(note && /uses Shield Bash/i.test(note.text), "the ability actually fired");
});

console.log(`\nabilityRange.smoke: ${passed} checks passed.`);
