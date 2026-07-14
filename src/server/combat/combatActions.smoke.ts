/**
 * combatActions.smoke.ts — Regression checks for the combat-readability pass:
 *   - duplicate enemy names get A/B suffixes so the log and turn order agree
 *   - a planned attack on a target that's out of reach is NEVER silent
 *     (pursuit, retarget, or a visible fizzle event)
 *   - extraAttack abilities (Reckless Attack & co.) actually strike
 *   - dodge is a real stance (condition applied)
 *   - consumables can be spent as a combat action and heal
 *   - flee exits the fight alive with the "fled" outcome
 *   - enemy AI uses its full movement speed (no more one-tile shuffle)
 *
 * Run with: npx tsx src/server/combat/combatActions.smoke.ts
 */

import assert from "node:assert/strict";

import { CombatManager, buildPlayerCombatEntity, buildEnemyFromTemplate } from "./CombatManager";
import { chebyshev } from "../../types/combat";
import { newInventory, addItem } from "../../types/items";

let passed = 0;
function check(label: string, fn: () => void): void {
  fn();
  passed++;
  console.log(`  ok — ${label}`);
}

function setup(opts: { ratPos: { x: number; y: number }; secondRat?: { x: number; y: number }; withPotion?: boolean }) {
  const mgr = new CombatManager();
  let inventory = newInventory(0);
  if (opts.withPotion) inventory = addItem(inventory, "healing_potion", 2);
  const player = buildPlayerCombatEntity({
    playerId: "p1", name: "Aelric", characterClass: "Warrior",
    hp: 40, position: { x: 0, y: 7 }, inventory,
  });
  const rats = [buildEnemyFromTemplate({ id: "e1", templateKey: "rat", position: opts.ratPos })];
  if (opts.secondRat) rats.push(buildEnemyFromTemplate({ id: "e2", templateKey: "rat", position: opts.secondRat }));
  const state = mgr.createCombat("cellar", [player], rats);
  const me  = state.entities.find(e => e.type === "player")!;
  const foes = state.entities.filter(e => e.type === "enemy");
  return { mgr, state, me, foes };
}

check("duplicate enemy names get letter suffixes", () => {
  const { foes } = setup({ ratPos: { x: 3, y: 0 }, secondRat: { x: 4, y: 0 } });
  const names = foes.map(f => f.name).sort();
  assert.deepEqual(names, ["Cellar Rat A", "Cellar Rat B"]);
});

check("an attack on an unreachable target is visibly reported, never silent", () => {
  const { mgr, state, me, foes } = setup({ ratPos: { x: 7, y: 0 } });
  mgr.submitAction(state.id, { entityId: me.id, action: { type: "attack", targetEntityId: foes[0]!.id } });
  const events = mgr.resolveRound(state.id).events.filter(e => e.entityId === me.id);
  assert.ok(events.length > 0, "the player's turn produced at least one event");
  assert.ok(
    events.some(e => e.type === "action_fizzles" || e.type === "move" || e.type === "attack_roll"),
    "the turn either pursued, struck, or explained itself"
  );
});

check("an attack pursues a target that is just out of reach", () => {
  // Rat 3 tiles away, Warrior speed ≥ 3 and no planned move → the attack
  // should close the gap and land a roll instead of fizzling. Initiative is
  // pinned player-first so the rat can't close the gap itself first.
  const { mgr, state, me, foes } = setup({ ratPos: { x: 0, y: 4 } });
  state.initiativeOrder = [me.id, ...foes.map(f => f.id)];
  mgr.submitAction(state.id, { entityId: me.id, action: { type: "attack", targetEntityId: foes[0]!.id } });
  const events = mgr.resolveRound(state.id).events.filter(e => e.entityId === me.id);
  assert.ok(events.some(e => e.type === "move" && /pursues/.test(e.text)), "a pursuit move happened");
  assert.ok(events.some(e => e.type === "attack_roll"), "the pursued attack rolled");
});

check("Reckless Attack strikes and drops the guard (extraAttack works)", () => {
  const { mgr, state, me, foes } = setup({ ratPos: { x: 0, y: 6 } });
  mgr.submitAction(state.id, { entityId: me.id, action: { type: "ability", abilityId: "reckless_attack", targetEntityId: foes[0]!.id } });
  const events = mgr.resolveRound(state.id).events.filter(e => e.entityId === me.id);
  assert.ok(events.some(e => e.type === "attack_roll" && /advantage/.test(e.text)), "a weapon attack rolled with advantage");
  assert.ok(
    events.some(e => e.type === "condition_applied" && e.condition === "reckless"),
    "the caster took the reckless condition"
  );
});

check("dodge is a real stance", () => {
  const { mgr, state, me } = setup({ ratPos: { x: 7, y: 0 } });
  mgr.submitAction(state.id, { entityId: me.id, action: { type: "dodge" } });
  const events = mgr.resolveRound(state.id).events.filter(e => e.entityId === me.id);
  assert.ok(
    events.some(e => e.type === "condition_applied" && e.condition === "dodging"),
    "the dodging condition was applied"
  );
});

check("a healing potion can be drunk as the turn's action", () => {
  const { mgr, state, me } = setup({ ratPos: { x: 7, y: 0 }, withPotion: true });
  me.hp = 5; // wounded, so the heal is observable
  mgr.submitAction(state.id, { entityId: me.id, action: { type: "item", itemId: "healing_potion" } });
  const events = mgr.resolveRound(state.id).events.filter(e => e.entityId === me.id);
  assert.ok(events.some(e => e.type === "item_used"), "the item use was reported");
  assert.ok(events.some(e => e.type === "heal" && (e.value ?? 0) > 0), "it healed");
  assert.ok(me.hp > 5, "HP actually rose");
  assert.equal(me.consumables?.["healing_potion"], 1, "one potion was spent");
});

check("fleeing exits the fight alive with the fled outcome", () => {
  const { mgr, state, me } = setup({ ratPos: { x: 7, y: 0 } });
  mgr.submitAction(state.id, { entityId: me.id, action: { type: "flee" } });
  const { isOver, outcome, events } = mgr.resolveRound(state.id);
  const mine = events.filter(e => e.entityId === me.id);
  assert.ok(mine.some(e => e.type === "flee" && /escapes/.test(e.text)), "the escape was reported");
  assert.ok(me.fled === true && me.isDead === false, "the runner is out but alive");
  assert.equal(isOver, true, "the solo fight ended");
  assert.equal(outcome, "fled");
});

check("wounds carry into a fight (currentHp entry, clamped)", () => {
  const wounded = buildPlayerCombatEntity({
    playerId: "p2", name: "Sore", characterClass: "Warrior",
    hp: 30, position: { x: 1, y: 7 }, currentHp: 12,
  });
  assert.equal(wounded.hp, 12, "enters at their carried HP");
  assert.equal(wounded.maxHp, 30, "max is unchanged");
  const overfull = buildPlayerCombatEntity({
    playerId: "p3", name: "Brag", characterClass: "Warrior",
    hp: 30, position: { x: 2, y: 7 }, currentHp: 99,
  });
  assert.equal(overfull.hp, 30, "carried HP clamps to max");
});

check("enemy AI covers real ground (full speed, not one tile)", () => {
  const { mgr, state, me, foes } = setup({ ratPos: { x: 7, y: 0 } });
  const foe = foes[0]!;
  const before = chebyshev(foe.position, me.position);
  mgr.submitAction(state.id, { entityId: me.id, action: { type: "end_turn" } });
  mgr.resolveRound(state.id);
  const after = chebyshev(foe.position, me.position);
  // Rat speed is 3; allow one tile of slack for routing around cellar props.
  assert.ok(before - after >= 2, `the rat closed ${before - after} tiles (was 1 under the old AI)`);
});

console.log(`\ncombatActions.smoke: ${passed} checks passed.`);
