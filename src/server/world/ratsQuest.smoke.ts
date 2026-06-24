/**
 * ratsQuest.smoke.ts — Verifies the Cellar Vermin quest loop wiring:
 * cellar room + hostile rats exist, hostiles clear after a win, and the quest
 * completes (with its reward) rather than returning to the board.
 *
 * Run with: npx tsx src/server/world/ratsQuest.smoke.ts
 */

import assert from "node:assert/strict";

import { ROOMS } from "./rooms";
import { worldManager } from "./WorldManager";
import { QuestManager } from "../quest/QuestManager";
import { AUTHORED_QUESTS } from "../quest/questData";

let passed = 0;
function check(label: string, fn: () => void): void {
  fn();
  passed++;
  console.log(`  ok — ${label}`);
}

check("tavern links down to the cellar and back up", () => {
  assert.equal(ROOMS.tavern!.exits.down, "cellar");
  assert.ok(ROOMS.cellar, "cellar room exists");
  assert.equal(ROOMS.cellar!.exits.up, "tavern");
});

check("the cellar holds hostile rats", () => {
  const hostiles = worldManager.getHostileNpcsInRoom("cellar");
  assert.ok(hostiles.length >= 1, "at least one hostile in the cellar");
  assert.ok(hostiles.every((n) => n.role === "hostile"));
});

check("the rats quest declares the cellar as its objective room", () => {
  const rats = AUTHORED_QUESTS.find((q) => q.id === "authored-rats");
  assert.ok(rats, "authored-rats quest exists");
  assert.equal(rats!.objectiveRoomId, "cellar");
});

check("clearHostiles removes the rats and is idempotent", () => {
  const removed = worldManager.clearHostiles("cellar");
  assert.ok(removed.length >= 1, "removed the hostiles");
  assert.equal(worldManager.getHostileNpcsInRoom("cellar").length, 0, "none remain");
  assert.equal(worldManager.clearHostiles("cellar").length, 0, "second call is a no-op");
});

check("completing the quest grants reward and does NOT return it to the board", () => {
  const qm = new QuestManager();
  const owner = "solo-player-1";

  assert.equal(qm.accept(owner, "authored-rats", false, null), null, "accept succeeds");
  assert.ok(qm.getActive(owner), "quest is active");

  const completed = qm.complete(owner);
  assert.ok(completed, "complete returns the active quest");
  assert.equal(completed!.quest.id, "authored-rats");
  assert.equal(completed!.quest.reward.xp, 25);
  assert.equal(completed!.quest.reward.gold, 15);

  assert.equal(qm.getActive(owner), null, "no longer active after completion");
  const board = qm.buildView(owner);
  assert.ok(
    !board.available.some((q) => q.id === "authored-rats"),
    "completed quest is gone from the board (not abandoned back onto it)"
  );

  // Completing again is a safe no-op.
  assert.equal(qm.complete(owner), null, "second complete returns null");
});

console.log(`\n✓ rats quest smoke: ${passed} checks passed`);
