/**
 * loot.smoke.ts — Guards the acquisition wiring: every enemy drop and every
 * authored quest reward item must resolve to a real catalog entry, and drop
 * chances must be sane probabilities. Catches a typo'd itemId or a renamed quest
 * reward before it silently vanishes at runtime.
 *
 * Run with: npx tsx src/server/combat/loot.smoke.ts
 */

import assert from "node:assert/strict";

import { ENEMY_TEMPLATES } from "./enemyTemplates";
import { AUTHORED_QUESTS } from "../quest/questData";
import { itemById, itemByName } from "../../types/items";

let passed = 0;
function check(label: string, fn: () => void): void {
  fn();
  passed++;
  console.log(`  ok — ${label}`);
}

check("every enemy loot drop references a real item at a valid chance", () => {
  for (const t of Object.values(ENEMY_TEMPLATES)) {
    for (const drop of t.loot ?? []) {
      assert.ok(itemById(drop.itemId), `${t.key} drops unknown item "${drop.itemId}"`);
      assert.ok(drop.chance > 0 && drop.chance <= 1, `${t.key} drop chance in (0,1]`);
    }
  }
});

check("every authored quest reward item resolves to a catalog entry", () => {
  for (const q of AUTHORED_QUESTS) {
    if (q.reward.item) {
      assert.ok(itemByName(q.reward.item), `quest "${q.id}" reward item "${q.reward.item}" not in catalog`);
    }
  }
});

check("the boss carries its signature spoils", () => {
  const boss = ENEMY_TEMPLATES.fog_boss!;
  const ids = (boss.loot ?? []).map(d => d.itemId);
  assert.ok(ids.includes("fogsteel_axe"), "Fogmother drops the Fogsteel Axe");
});

console.log(`\nloot.smoke: ${passed} checks passed.`);
