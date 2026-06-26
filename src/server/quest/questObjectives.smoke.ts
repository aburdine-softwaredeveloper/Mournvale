/**
 * questObjectives.smoke.ts — Verifies the non-combat ("field") quest loop:
 * every authored quest declares a coherent objective, each turn-in NPC and
 * objective room actually exists, combat quests stay "clear", and the
 * QuestManager objective-progress transition behaves once-only.
 *
 * Run with: npx tsx src/server/quest/questObjectives.smoke.ts
 */

import assert from "node:assert/strict";

import { AUTHORED_QUESTS } from "./questData";
import { QuestManager } from "./QuestManager";
import { worldManager } from "../world/WorldManager";
import { ROOMS } from "../world/rooms";

let passed = 0;
function check(label: string, fn: () => void): void {
  fn();
  passed++;
  console.log(`  ok — ${label}`);
}

const byId = (id: string) => AUTHORED_QUESTS.find((q) => q.id === id)!;

check("every authored quest with an objective room declares a kind", () => {
  for (const q of AUTHORED_QUESTS) {
    if (q.objectiveRoomId) {
      assert.ok(q.objectiveKind, `${q.id} has objectiveKind`);
      assert.ok(ROOMS[q.objectiveRoomId], `${q.id} objective room "${q.objectiveRoomId}" exists`);
    }
  }
});

check("the four non-combat quests are wired as field tasks", () => {
  const herbs = byId("authored-herbs");
  assert.equal(herbs.objectiveKind, "gather");
  assert.equal(herbs.objectiveRoomId, "graveyard");
  assert.equal(herbs.turnInNpcId, "sister_mara");

  const bell = byId("authored-bell");
  assert.equal(bell.objectiveKind, "investigate");
  assert.equal(bell.objectiveRoomId, "chapel");
  assert.equal(bell.turnInNpcId, "old_hollis");

  const scout = byId("authored-fog-scout");
  assert.equal(scout.objectiveKind, "scout");
  assert.equal(scout.objectiveRoomId, "south_road");
  assert.equal(scout.turnInNpcId, "captain_vey");

  const delivery = byId("authored-delivery");
  assert.equal(delivery.objectiveKind, "deliver");
  assert.equal(delivery.objectiveRoomId, "market_square");
  assert.ok(!delivery.turnInNpcId, "delivery auto-completes (no turn-in)");
});

check("every turn-in NPC exists and stands in a real room", () => {
  for (const q of AUTHORED_QUESTS) {
    if (!q.turnInNpcId) continue;
    const npc = worldManager.getNpcById(q.turnInNpcId);
    assert.ok(npc, `${q.id} turn-in NPC "${q.turnInNpcId}" exists`);
    assert.ok(ROOMS[npc!.roomId], `${npc!.id} stands in a real room`);
  }
});

check("combat quests stay objectiveKind 'clear'", () => {
  for (const id of ["authored-rats", "authored-wolves", "authored-fog-boss"]) {
    assert.equal(byId(id).objectiveKind, "clear");
  }
});

check("markObjectiveMet transitions exactly once", () => {
  const qm = new QuestManager();
  const owner = "solo-player";
  // authored-herbs is "either", so a solo player can take it.
  const err = qm.accept(owner, "authored-herbs", false, null);
  assert.equal(err, null, "accepted the herbs quest");

  assert.equal(qm.getActive(owner)!.objectiveMet ?? false, false, "starts not-met");
  assert.equal(qm.markObjectiveMet(owner), true, "first mark transitions");
  assert.equal(qm.markObjectiveMet(owner), false, "second mark is a no-op");
  assert.equal(qm.getActive(owner)!.objectiveMet, true, "stays met");
});

check("a met quest still completes and clears from tracking", () => {
  const qm = new QuestManager();
  const owner = "solo-player-2";
  qm.accept(owner, "authored-delivery", false, null);
  qm.markObjectiveMet(owner);
  const done = qm.complete(owner);
  assert.ok(done, "complete returned the active quest");
  assert.equal(qm.getActive(owner), null, "no longer tracked after completion");
});

console.log(`\n✓ quest objectives smoke: ${passed} checks passed`);
