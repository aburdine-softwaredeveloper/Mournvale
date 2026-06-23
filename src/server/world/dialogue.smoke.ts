/**
 * dialogue.smoke.ts — Verifies the skill-check dialogue content + that
 * resolveTalk actually rolls a check when an NPC has a branch for the chosen
 * intent (and falls back cleanly when it doesn't).
 *
 * Run with: npx tsx src/server/world/dialogue.smoke.ts
 */

import assert from "node:assert/strict";

import { NPCS } from "./npcs";
import { worldManager } from "./WorldManager";
import { TALK_INTENT_SKILL, type DialogueOutcome } from "../../types/npc";

const TIERS: DialogueOutcome[] = ["crit_fail", "fail", "success", "crit_success"];
const VALID_INTENTS = new Set(["persuade", "intimidate", "inquire", "deceive"]);

let passed = 0;
function check(label: string, fn: () => void): void {
  fn();
  passed++;
  console.log(`  ok — ${label}`);
}

check("every dialogue branch is well-formed (valid intent, all four tiers, non-empty lines)", () => {
  let branchCount = 0;
  for (const npc of NPCS) {
    for (const branch of npc.dialogueBranches ?? []) {
      branchCount++;
      assert.ok(VALID_INTENTS.has(branch.intent), `${npc.id}: bad intent "${branch.intent}"`);
      assert.ok(Number.isFinite(branch.dc) && branch.dc > 0, `${npc.id}/${branch.intent}: bad DC`);
      for (const tier of TIERS) {
        const data = branch.outcomes[tier];
        assert.ok(data, `${npc.id}/${branch.intent}: missing "${tier}" outcome`);
        assert.ok(data.npcLine.trim().length > 0, `${npc.id}/${branch.intent}/${tier}: empty line`);
      }
    }
  }
  assert.ok(branchCount >= 5, `expected several authored branches, found ${branchCount}`);
});

check("at least a few distinct NPCs now have skilled dialogue", () => {
  const withBranches = NPCS.filter((n) => (n.dialogueBranches?.length ?? 0) > 0);
  assert.ok(withBranches.length >= 3, `only ${withBranches.length} NPCs have branches`);
});

check("some branch outcomes carry an infoReveal (the chat lore-reveal payoff)", () => {
  // runNpcChat surfaces outcome.infoReveal on a matching intent+tier; if no
  // branch defines one, that mechanical payoff is silently dead.
  let reveals = 0;
  for (const npc of NPCS) {
    for (const branch of npc.dialogueBranches ?? []) {
      for (const tier of TIERS) {
        if (branch.outcomes[tier].infoReveal) reveals++;
      }
    }
  }
  assert.ok(reveals >= 3, `expected several infoReveal outcomes, found ${reveals}`);
});

check("resolveTalk rolls a check (dice) when the intent matches a branch", () => {
  const marta = worldManager.getNpcById("marta");
  assert.ok(marta, "marta exists");
  // Marta has an 'inquire' branch → insight check.
  const result = worldManager.resolveTalk("Healer", marta!, "inquire");
  const cd = result.checkDisplay;
  assert.ok(cd, "a check should have been rolled");
  assert.equal(cd!.skill, TALK_INTENT_SKILL.inquire, "rolled the right skill");
  assert.ok(cd!.d20Result >= 1 && cd!.d20Result <= 20, "d20 in range");
  assert.ok(result.view.dialogue[0]!.text.trim().length > 0, "returns an outcome line");
});

check("resolveTalk falls back (no dice) when the NPC has no branch for the intent", () => {
  const marta = worldManager.getNpcById("marta");
  // Marta has inquire + persuade, but NOT deceive → fallback, no check.
  const result = worldManager.resolveTalk("Thief", marta!, "deceive");
  assert.equal(result.checkDisplay, undefined, "no check for an unbranched intent");
  assert.ok(result.view.dialogue[0]!.text.trim().length > 0, "still returns a line");
});

check("resolveTalk with no intent returns default dialogue and no check", () => {
  const marta = worldManager.getNpcById("marta");
  const result = worldManager.resolveTalk("Mage", marta!, undefined);
  assert.equal(result.checkDisplay, undefined);
  assert.deepEqual(result.view.dialogue, marta!.dialogue, "default lines returned verbatim");
});

console.log(`\n✓ dialogue smoke: ${passed} checks passed`);
