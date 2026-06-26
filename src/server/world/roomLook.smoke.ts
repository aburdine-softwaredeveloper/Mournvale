/**
 * roomLook.smoke.ts — Verifies the enriched `look` data layer:
 * every ROOM_DETAILS entry targets a real room, the field quests' objective
 * rooms have inspection detail (so a deliberate look is rewarding there), and
 * each quest lookClue is paired with a real objective room.
 *
 * Run with: npx tsx src/server/world/roomLook.smoke.ts
 */

import assert from "node:assert/strict";

import { ROOMS } from "./rooms";
import { ROOM_DETAILS } from "./roomDetails";
import { AUTHORED_QUESTS } from "../quest/questData";

let passed = 0;
function check(label: string, fn: () => void): void {
  fn();
  passed++;
  console.log(`  ok — ${label}`);
}

check("every ROOM_DETAILS entry targets a real room", () => {
  for (const id of Object.keys(ROOM_DETAILS)) {
    assert.ok(ROOMS[id], `room "${id}" exists`);
  }
});

check("each room detail provides at least detail or a feature", () => {
  for (const [id, d] of Object.entries(ROOM_DETAILS)) {
    assert.ok(d.detail || (d.features && d.features.length), `${id} has inspection content`);
  }
});

check("the non-combat objective rooms are worth inspecting", () => {
  for (const id of ["south_road", "graveyard", "chapel"]) {
    const d = ROOM_DETAILS[id];
    assert.ok(d && (d.features?.length ?? 0) > 0, `${id} surfaces notable objects on look`);
  }
});

check("every quest lookClue is paired with a real objective room", () => {
  for (const q of AUTHORED_QUESTS) {
    if (!q.lookClue) continue;
    assert.ok(q.objectiveRoomId, `${q.id} with a lookClue has an objective room`);
    assert.ok(ROOMS[q.objectiveRoomId!], `${q.id} objective room exists`);
  }
});

check("the scout/gather/investigate quests carry a story clue", () => {
  for (const id of ["authored-fog-scout", "authored-herbs", "authored-bell"]) {
    const q = AUTHORED_QUESTS.find((x) => x.id === id)!;
    assert.ok(q.lookClue && q.lookClue.length > 20, `${id} has a meaningful lookClue`);
  }
});

console.log(`\n✓ room look smoke: ${passed} checks passed`);
