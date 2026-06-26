/**
 * fogLadder.smoke.ts — Verifies the combat quest ladder wiring:
 * the fog path rooms exist and link, each encounter holds the right hostiles
 * mapped to their monster templates, and the wolves + final-boss quests declare
 * their objective rooms so maybeCompleteRoomQuest can close them on a win.
 *
 * Run with: npx tsx src/server/world/fogLadder.smoke.ts
 */

import assert from "node:assert/strict";

import { ROOMS } from "./rooms";
import { worldManager } from "./WorldManager";
import { AUTHORED_QUESTS } from "../quest/questData";
import { ENEMY_TEMPLATES, getEnemyTemplate } from "../combat/enemyTemplates";

let passed = 0;
function check(label: string, fn: () => void): void {
  fn();
  passed++;
  console.log(`  ok — ${label}`);
}

check("the fog path links chapel → fog_road → fogheart and back", () => {
  assert.equal(ROOMS.chapel!.exits.north, "fog_road");
  assert.ok(ROOMS.fog_road, "fog_road exists");
  assert.equal(ROOMS.fog_road!.exits.south, "chapel");
  assert.equal(ROOMS.fog_road!.exits.north, "fogheart");
  assert.ok(ROOMS.fogheart, "fogheart exists");
  assert.equal(ROOMS.fogheart!.exits.south, "fog_road");
});

check("the fog road holds fog-wolves mapped to wolf templates", () => {
  const hostiles = worldManager.getHostileNpcsInRoom("fog_road");
  assert.ok(hostiles.length >= 1, "at least one hostile on the fog road");
  assert.ok(hostiles.every((n) => n.role === "hostile"));
  assert.ok(
    hostiles.every((n) => (n.enemyTemplate ?? "").startsWith("fog_wolf")),
    "every fog-road hostile uses a wolf template"
  );
});

check("the heart of the fog holds the Fogmother boss", () => {
  const hostiles = worldManager.getHostileNpcsInRoom("fogheart");
  assert.equal(hostiles.length, 1, "one boss in the fogheart");
  assert.equal(hostiles[0]!.enemyTemplate, "fog_boss");
});

check("every hostile NPC references a real, non-default-by-accident template", () => {
  for (const room of Object.keys(ROOMS)) {
    for (const npc of worldManager.getHostileNpcsInRoom(room)) {
      assert.ok(npc.enemyTemplate, `${npc.id} declares an enemyTemplate`);
      assert.ok(
        ENEMY_TEMPLATES[npc.enemyTemplate!],
        `${npc.id}'s template "${npc.enemyTemplate}" exists`
      );
    }
  }
});

check("the difficulty ladder is monotonic by template tier", () => {
  const rat = getEnemyTemplate("rat");
  const wolf = getEnemyTemplate("fog_wolf");
  const boss = getEnemyTemplate("fog_boss");
  assert.ok(rat.tier < wolf.tier, "rats are weaker than wolves");
  assert.ok(wolf.tier < boss.tier, "wolves are weaker than the boss");
  assert.ok(rat.hp < boss.hp && rat.xp < boss.xp, "boss is tankier and worth more");
});

check("the wolves and final-boss quests declare their objective rooms", () => {
  const wolves = AUTHORED_QUESTS.find((q) => q.id === "authored-wolves");
  assert.equal(wolves!.objectiveRoomId, "fog_road");
  const boss = AUTHORED_QUESTS.find((q) => q.id === "authored-fog-boss");
  assert.ok(boss, "final boss quest exists");
  assert.equal(boss!.objectiveRoomId, "fogheart");
});

console.log(`\n✓ fog ladder smoke: ${passed} checks passed`);
