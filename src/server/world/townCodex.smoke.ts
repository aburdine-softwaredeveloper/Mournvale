/**
 * townCodex.smoke.ts — The shared town knowledge an NPC may share in plain talk.
 *
 * Verifies the codex describes the layout (places + how they connect), lists the
 * townsfolk and where to find them, surfaces the quest board, and — crucially —
 * does NOT leak the secrets gated behind skill checks.
 *
 * Run with: npx tsx src/server/world/townCodex.smoke.ts
 */

import assert from "node:assert/strict";

import { TOWN_CODEX } from "./townCodex";
import { ROOMS } from "./rooms";
import { NPCS } from "./npcs";
import { AUTHORED_QUESTS } from "../quest/questData";

let passed = 0;
function check(label: string, fn: () => void): void {
  fn();
  passed++;
  console.log(`  ok — ${label}`);
}

check("lists every place and how it connects", () => {
  for (const room of Object.values(ROOMS)) {
    assert.ok(TOWN_CODEX.includes(room.name), `mentions ${room.name}`);
  }
  // Adjacency is rendered ("north to ...") so NPCs can give directions.
  assert.ok(/to The Iron Hearth/.test(TOWN_CODEX), "renders an exit toward the smithy");
});

check("lists the townsfolk and where to find them", () => {
  const folk = NPCS.filter((n) => n.role !== "hostile");
  for (const npc of folk) {
    assert.ok(TOWN_CODEX.includes(npc.name), `mentions ${npc.name}`);
  }
  // Reference-able: an NPC can point a player to Borin at the smithy.
  assert.ok(/Borin.*Iron Hearth/.test(TOWN_CODEX), "places Borin at the smithy");
});

check("does not list hostile vermin as townsfolk", () => {
  assert.ok(!/Cellar Rat|Bold Rat/.test(TOWN_CODEX), "hostiles are excluded");
});

check("surfaces the authored quest board", () => {
  for (const quest of AUTHORED_QUESTS) {
    assert.ok(TOWN_CODEX.includes(quest.title), `mentions quest "${quest.title}"`);
  }
});

check("keeps skill-gated secrets OUT of common knowledge", () => {
  // These lines are only earned via a successful skill-check branch; a townsperson
  // must not blurt them out just because the codex exists.
  assert.ok(!TOWN_CODEX.includes("bricked"), "bricked-over door stays secret");
  assert.ok(!/drove.*into the fog|of its own accord/i.test(TOWN_CODEX), "caravan secret stays secret");
  assert.ok(!/grave-dirt/i.test(TOWN_CODEX), "grave-dirt rumor stays secret");
});

console.log(`\n✓ town codex smoke: ${passed} checks passed`);
