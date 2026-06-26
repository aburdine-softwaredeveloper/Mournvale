/**
 * disposition.smoke.ts — Verifies the drifting-relationship core:
 * bands map correctly, the (intent, tier) deltas encode the intended social
 * trade-offs (kindness compounds, intimidation costs rapport, a caught lie
 * craters it), scores clamp, the DC modifier tracks warmth, and band-change
 * notices fire only on a real transition.
 *
 * Run with: npx tsx src/server/social/disposition.smoke.ts
 */

import assert from "node:assert/strict";

import {
  bandFor,
  outcomeDelta,
  newSocialMemory,
  dispositionWith,
  applyTalkOutcome,
  dispositionDcModifier,
  dispositionGuidance,
  bandChangeNotice,
  DISPOSITION_MAX,
  DISPOSITION_MIN,
} from "./disposition";

let passed = 0;
function check(label: string, fn: () => void): void {
  fn();
  passed++;
  console.log(`  ok — ${label}`);
}

check("bands map across the range coldest→warmest", () => {
  assert.equal(bandFor(-100), "hostile");
  assert.equal(bandFor(-50), "hostile");
  assert.equal(bandFor(-49), "wary");
  assert.equal(bandFor(-20), "wary");
  assert.equal(bandFor(-19), "neutral");
  assert.equal(bandFor(0), "neutral");
  assert.equal(bandFor(19), "neutral");
  assert.equal(bandFor(20), "warm");
  assert.equal(bandFor(49), "warm");
  assert.equal(bandFor(50), "trusting");
  assert.equal(bandFor(100), "trusting");
});

check("deltas encode the social contract", () => {
  // Kindness compounds, failure stings a little.
  assert.ok(outcomeDelta("persuade", "crit_success") > 0);
  assert.ok(outcomeDelta("inquire", "success") > 0);
  // Intimidation is net-negative on rapport at EVERY tier — fear ≠ friendship.
  for (const tier of ["crit_success", "success", "fail", "crit_fail"] as const) {
    assert.ok(outcomeDelta("intimidate", tier) < 0, `intimidate/${tier} costs rapport`);
  }
  // A caught lie is the single most damaging outcome in the game.
  const worst = outcomeDelta("deceive", "crit_fail");
  const allDeltas = (["persuade", "inquire", "deceive", "intimidate"] as const).flatMap((i) =>
    (["crit_success", "success", "fail", "crit_fail"] as const).map((t) => outcomeDelta(i, t))
  );
  assert.equal(worst, Math.min(...allDeltas), "deceive/crit_fail is the harshest delta");
});

check("applying outcomes accumulates and clamps", () => {
  let mem = newSocialMemory();
  assert.equal(dispositionWith(mem, "vey"), 0);

  // Several good persuades warm the relationship.
  for (let i = 0; i < 3; i++) mem = applyTalkOutcome(mem, "vey", "persuade", "success").memory;
  assert.equal(dispositionWith(mem, "vey"), 18);
  assert.equal(bandFor(dispositionWith(mem, "vey")), "neutral");

  // Clamp at the ceiling.
  for (let i = 0; i < 50; i++) mem = applyTalkOutcome(mem, "vey", "persuade", "crit_success").memory;
  assert.equal(dispositionWith(mem, "vey"), DISPOSITION_MAX);

  // Clamp at the floor for a different NPC.
  let mem2 = newSocialMemory();
  for (let i = 0; i < 50; i++) mem2 = applyTalkOutcome(mem2, "mara", "intimidate", "crit_fail").memory;
  assert.equal(dispositionWith(mem2, "mara"), DISPOSITION_MIN);
});

check("applyTalkOutcome is pure (does not mutate input)", () => {
  const mem = newSocialMemory();
  const shift = applyTalkOutcome(mem, "vey", "persuade", "success");
  assert.equal(dispositionWith(mem, "vey"), 0, "original memory unchanged");
  assert.equal(dispositionWith(shift.memory, "vey"), 6, "new memory carries the change");
});

check("DC modifier makes warm NPCs easier and cold ones harder, capped", () => {
  assert.ok(dispositionDcModifier(60) < 0, "warm → lower DC");
  assert.ok(dispositionDcModifier(-60) > 0, "cold → higher DC");
  assert.equal(dispositionDcModifier(0), 0, "strangers → no shift");
  assert.ok(Math.abs(dispositionDcModifier(DISPOSITION_MAX)) <= 4, "swing is capped");
  assert.ok(Math.abs(dispositionDcModifier(DISPOSITION_MIN)) <= 4, "swing is capped");
});

check("guidance text exists for every band", () => {
  for (const score of [-100, -30, 0, 30, 100]) {
    assert.ok(dispositionGuidance(score).length > 0);
  }
});

check("band-change notice fires only on a real transition", () => {
  const mem = newSocialMemory();
  // crit_success persuade is +12: 0 → 12, still neutral, no notice.
  const small = applyTalkOutcome(mem, "vey", "persuade", "success");
  assert.equal(bandChangeNotice("Captain Vey", small), null);

  // Push to 20 to cross neutral→warm.
  let m = mem;
  for (let i = 0; i < 4; i++) m = applyTalkOutcome(m, "vey", "persuade", "success").memory; // 24
  const crossing = applyTalkOutcome(
    // rewind: build a shift that crosses by starting at 18 → 24
    { disposition: { vey: 18 } },
    "vey",
    "persuade",
    "success"
  );
  assert.ok(crossing.bandChanged);
  const notice = bandChangeNotice("Captain Vey", crossing);
  assert.ok(notice && notice.includes("Captain Vey"), "warming notice names the NPC");
});

console.log(`\ndisposition.smoke: ${passed} checks passed.`);
