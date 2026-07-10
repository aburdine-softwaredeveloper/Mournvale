/**
 * loreGate.smoke.ts — Verifies the conversation-driven quest gating:
 * story quests with `requiresLore` stay off the board (surfacing as rumor
 * teasers) until the lore is learned, can't be accepted early, and
 * unlockedBetween reports exactly what a new piece of lore opened.
 * Run with: npx tsx src/server/quest/loreGate.smoke.ts
 */

import assert from "node:assert/strict";
import { QuestManager } from "./QuestManager";
import { AUTHORED_QUESTS } from "./questData";
import { NPCS } from "../world/npcs";
import { LORE_CODEX } from "./loreCodex";

function main(): void {
  const qm = new QuestManager();
  const owner = "smoke-owner";
  const noLore = new Set<string>();

  // ── The campaign data is coherent ──────────────────────────────────────────
  // Every requiresLore key is teachable: by some NPC (meetLore / a dialogue
  // branch loreKey) or by completing a quest that grantsLore it.
  const teachable = new Set<string>();
  for (const npc of NPCS) {
    if (npc.meetLore) teachable.add(npc.meetLore.key);
    for (const branch of npc.dialogueBranches ?? []) {
      for (const outcome of Object.values(branch.outcomes)) {
        if (outcome.loreKey) teachable.add(outcome.loreKey);
      }
    }
  }
  for (const q of AUTHORED_QUESTS) {
    for (const key of q.grantsLore ?? []) teachable.add(key);
  }
  const gated = AUTHORED_QUESTS.filter((q) => q.requiresLore?.length);
  assert.ok(gated.length >= 3, "campaign has lore-gated chapters");
  for (const q of gated) {
    for (const key of q.requiresLore!) {
      assert.ok(teachable.has(key), `lore key "${key}" (required by ${q.id}) is teachable somewhere`);
    }
    assert.ok(q.rumorHint, `${q.id} carries a rumorHint so its lock reads as a thread to pull`);
  }
  console.log("  ok — every required lore key is teachable and every gate has a rumor");

  // Every teachable key must read well in the journal — a bare internal key
  // leaking into the player's notes means someone forgot the codex entry.
  for (const key of teachable) {
    assert.ok(LORE_CODEX[key], `lore key "${key}" has a journal codex entry`);
  }
  console.log("  ok — every teachable lore key has a journal entry");

  // ── Locked quests are withheld and surfaced as rumors ──────────────────────
  const coldView = qm.buildView(owner, noLore);
  for (const q of gated) {
    assert.ok(
      !coldView.available.some((a) => a.id === q.id),
      `${q.id} hidden from a player who knows nothing`
    );
  }
  assert.equal(coldView.rumors?.length, gated.length, "each locked quest becomes one rumor teaser");
  console.log("  ok — a stranger's board hides the story quests behind rumors");

  // ── Early acceptance is refused server-side ─────────────────────────────────
  const err = qm.accept(owner, "authored-wolves", false, null, noLore);
  assert.ok(err, "accepting a lore-locked quest without the lore is refused");
  console.log("  ok — the lore gate is server-authoritative on accept");

  // ── Learning the lore opens the quest ───────────────────────────────────────
  const knowsWolves = new Set(["wolves_at_gate"]);
  const warmView = qm.buildView(owner, knowsWolves);
  assert.ok(
    warmView.available.some((a) => a.id === "authored-wolves"),
    "wolves quest appears once its lore is known"
  );
  assert.equal(
    qm.accept(owner, "authored-wolves", false, null, knowsWolves),
    null,
    "and is acceptable"
  );
  qm.abandon(owner);
  console.log("  ok — talking to the Captain (meetLore) puts her quest on the board");

  // ── unlockedBetween reports exactly the fresh unlocks ───────────────────────
  const newly = qm.unlockedBetween(noLore, knowsWolves);
  assert.deepEqual(
    newly.map((q) => q.id),
    ["authored-wolves"],
    "unlockedBetween names the quest the new lore opened"
  );
  assert.equal(qm.unlockedBetween(knowsWolves, knowsWolves).length, 0, "no news, no announcement");
  console.log("  ok — unlockedBetween announces exactly what a conversation opened");

  // ── Back-compat: callers without lore (older smokes) see everything ─────────
  const ungated = qm.buildView(owner);
  for (const q of AUTHORED_QUESTS) {
    assert.ok(ungated.available.some((a) => a.id === q.id), `${q.id} visible without a lore filter`);
  }
  console.log("  ok — lore-less callers (tests) are ungated");

  console.log("\n✓ lore gate smoke: 7 checks passed");
}

main();
