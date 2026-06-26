/**
 * npcChat.smoke.ts — Verifies the free-text NPC dialogue layer without any
 * network: intent inference, the scripted fallback brain, persona-prompt
 * assembly, and the service's history/selection. (OllamaBrain needs a running
 * server, so it's exercised manually, not here.)
 *
 * Run with: npx tsx src/server/dialogue/npcChat.smoke.ts
 */

import assert from "node:assert/strict";

import { worldManager } from "../world/WorldManager";
import type { NPC, DialogueOutcome } from "../../types/npc";
import {
  inferIntent,
  skillForIntent,
  buildNpcSystemPrompt,
  type NpcReplyContext,
} from "./NpcBrain";
import { ScriptedBrain } from "./ScriptedBrain";
import { NpcChatService } from "./NpcChatService";

let passed = 0;
function check(label: string, fn: () => void | Promise<void>): Promise<void> {
  return Promise.resolve(fn()).then(() => {
    passed++;
    console.log(`  ok — ${label}`);
  });
}

function ctxFor(npc: NPC, message: string, tier: DialogueOutcome): Omit<NpcReplyContext, "history"> & { history: never[] } {
  const intent = inferIntent(message);
  return {
    npc,
    playerName: "Vessa",
    playerClass: "Mage",
    message,
    intent,
    skill: skillForIntent(intent),
    tier,
    roomName: "The Broken Lantern",
    history: [],
  };
}

async function main(): Promise<void> {
  await check("inferIntent classifies the four approaches from free text", () => {
    assert.equal(inferIntent("Tell me now or you'll regret it"), "intimidate");
    assert.equal(inferIntent("Trust me, I swear I'm a friend"), "deceive");
    assert.equal(inferIntent("Please, could you help me find the cellar?"), "persuade");
    assert.equal(inferIntent("What happened to this village?"), "inquire");
  });

  await check("skillForIntent maps intents to the right skill", () => {
    assert.equal(skillForIntent("inquire"), "insight");
    assert.equal(skillForIntent("persuade"), "persuasion");
    assert.equal(skillForIntent("intimidate"), "intimidation");
    assert.equal(skillForIntent("deceive"), "deception");
  });

  await check("ScriptedBrain returns the authored branch line for the rolled tier", async () => {
    const marta = worldManager.getNpcById("marta");
    assert.ok(marta, "marta exists");
    const brain = new ScriptedBrain();
    // "What do you know?" → inquire; Marta has an inquire branch.
    const ctx = { ...ctxFor(marta!, "What do you know about this place?", "crit_success" as DialogueOutcome) };
    const reply = await brain.generateReply(ctx);
    const branch = marta!.dialogueBranches!.find((b) => b.intent === "inquire")!;
    assert.equal(reply, branch.outcomes.crit_success.npcLine, "uses the tier's authored line");
  });

  await check("ScriptedBrain produces a non-empty line when no branch matches", async () => {
    const borin = worldManager.getNpcById("borin"); // vendor, no dialogueBranches
    assert.ok(borin, "borin exists");
    const brain = new ScriptedBrain();
    for (const tier of ["crit_fail", "fail", "success", "crit_success"] as DialogueOutcome[]) {
      const reply = await brain.generateReply(ctxFor(borin!, "Heard any rumors?", tier));
      assert.ok(reply.trim().length > 0, `non-empty fallback for ${tier}`);
    }
  });

  await check("buildNpcSystemPrompt embeds persona + tier guidance + guardrails", () => {
    const marta = worldManager.getNpcById("marta")!;
    const prompt = buildNpcSystemPrompt(ctxFor(marta, "hello", "fail"));
    assert.ok(prompt.includes("Marta"), "names the NPC");
    assert.ok(prompt.includes("Mournvale"), "sets the world");
    assert.ok(/never.*break character/i.test(prompt), "includes the stay-in-character guardrail");
    assert.ok(/evasive|unmoved/i.test(prompt), "folds in the fail-tier tone");
  });

  await check("buildNpcSystemPrompt folds in shared town knowledge when provided", () => {
    const marta = worldManager.getNpcById("marta")!;
    const base = ctxFor(marta, "Where's the blacksmith?", "success");
    // Without worldContext, the codex text is absent…
    assert.ok(!buildNpcSystemPrompt(base).includes("SHARED LOCAL KNOWLEDGE"));
    // …with it, the NPC's prompt carries the town layout it can reference.
    const withWorld = buildNpcSystemPrompt({
      ...base,
      worldContext: "SHARED LOCAL KNOWLEDGE — The Iron Hearth is west of Market Square.",
    });
    assert.ok(withWorld.includes("The Iron Hearth is west of Market Square"), "embeds the codex");
    assert.ok(/in your own voice/i.test(withWorld), "instructs the NPC to use it naturally");
  });

  await check("buildNpcSystemPrompt folds in disposition + rumor reputation when provided", () => {
    const marta = worldManager.getNpcById("marta")!;
    const base = ctxFor(marta, "Help me?", "success");
    // Absent by default…
    const bare = buildNpcSystemPrompt(base);
    assert.ok(!/HOW YOU FEEL ABOUT/i.test(bare), "no relationship block without disposition");
    assert.ok(!/HEARD AROUND TOWN/i.test(bare), "no rumor block without reputation");
    // …present and verbatim when supplied.
    const withSocial = buildNpcSystemPrompt({
      ...base,
      dispositionContext: "You trust this person almost as an old friend.",
      rumorContext: "WHAT YOU'VE HEARD AROUND TOWN ABOUT THEM:\n- Word is they saw the cellar job through.",
    });
    assert.ok(withSocial.includes("trust this person almost as an old friend"), "embeds disposition tone");
    assert.ok(withSocial.includes("saw the cellar job through"), "embeds the heard rumor");
    assert.ok(/half-trust gossip/i.test(withSocial), "frames rumor as gossip, not fact");
  });

  await check("NpcChatService(scripted only) responds and reports the brain", async () => {
    const marta = worldManager.getNpcById("marta")!;
    const service = new NpcChatService([new ScriptedBrain()]);
    const r1 = await service.respond("player-1", ctxFor(marta, "What do you know?", "success"));
    assert.equal(r1.brain, "scripted");
    assert.ok(r1.reply.trim().length > 0);
    // A second turn still works (history is threaded internally).
    const r2 = await service.respond("player-1", ctxFor(marta, "And the cellar?", "success"));
    assert.ok(r2.reply.trim().length > 0);
    // clearHistory is safe to call.
    service.clearHistory("player-1");
  });

  console.log(`\n✓ npc chat smoke: ${passed} checks passed`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
