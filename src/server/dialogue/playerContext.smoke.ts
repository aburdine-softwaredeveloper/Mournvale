/**
 * playerContext.smoke.ts — The per-conversation runtime note about the visitor.
 *
 * Verifies the giver of the player's active quest is told it's THEIR task (and
 * can ask after it), other NPCs only get loose "word around town" gossip, party
 * status and seasoning are reflected, and the questless case stays clean.
 *
 * Run with: npx tsx src/server/dialogue/playerContext.smoke.ts
 */

import assert from "node:assert/strict";

import { worldManager } from "../world/WorldManager";
import { AUTHORED_QUESTS } from "../quest/questData";
import type { ActiveQuest } from "../../types/quest";
import { buildPlayerContext } from "./playerContext";

let passed = 0;
function check(label: string, fn: () => void): void {
  fn();
  passed++;
  console.log(`  ok — ${label}`);
}

const ratsQuest = AUTHORED_QUESTS.find((q) => q.id === "authored-rats")!;
const active: ActiveQuest = { quest: ratsQuest, partyId: null, acceptedAt: Date.now() };

check("the quest-giver is told it's THEIR task and may ask after it", () => {
  const aldric = worldManager.getNpcById("aldric")!; // gives authored-rats
  const ctx = buildPlayerContext({ npc: aldric, activeQuest: active, inParty: false, level: 2 });
  assert.ok(/YOUR task/.test(ctx), "frames it as the giver's own task");
  assert.ok(ctx.includes(ratsQuest.title), "names the quest");
  assert.ok(/ask how it goes/i.test(ctx), "invites a progress check");
});

check("a non-giver only hears loose town gossip, no particulars", () => {
  const borin = worldManager.getNpcById("borin")!; // unrelated vendor
  const ctx = buildPlayerContext({ npc: borin, activeQuest: active, inParty: false, level: 2 });
  assert.ok(/Word around the village/i.test(ctx), "framed as rumor");
  assert.ok(/don't know the particulars/i.test(ctx), "disclaims detailed knowledge");
  assert.ok(!/YOUR task/.test(ctx), "not framed as their own task");
});

check("party status and seasoning are reflected", () => {
  const aldric = worldManager.getNpcById("aldric")!;
  const soloGreen = buildPlayerContext({ npc: aldric, activeQuest: null, inParty: false, level: 1 });
  assert.ok(/green/i.test(soloGreen) && /traveling alone/i.test(soloGreen));

  const partyVeteran = buildPlayerContext({ npc: aldric, activeQuest: null, inParty: true, level: 6 });
  assert.ok(/veteran/i.test(partyVeteran) && /companions/i.test(partyVeteran));
});

check("no active quest yields a clean, quest-free note", () => {
  const aldric = worldManager.getNpcById("aldric")!;
  const ctx = buildPlayerContext({ npc: aldric, activeQuest: null, inParty: false });
  assert.ok(/no posted work/i.test(ctx), "states there's no known work");
  assert.ok(!ctx.includes(ratsQuest.title), "mentions no quest");
});

console.log(`\n✓ player context smoke: ${passed} checks passed`);
