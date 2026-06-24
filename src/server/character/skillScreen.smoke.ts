/**
 * skillScreen.smoke.ts — Verifies buildSkillScreenView reflects progression.
 * Run with: npx tsx src/server/character/skillScreen.smoke.ts
 */

import assert from "node:assert/strict";

import type { CharacterData } from "../../types/game";
import { CLASS_TALENT_TREES } from "../../types/talents";
import { baselineAbilityIds } from "../../types/character";
import {
  newProgression, awardXp, xpForLevel, spendTalentPoint, equipAbility,
} from "../../types/progression";
import { buildSkillScreenView } from "./skillScreen";

const character: CharacterData = {
  name: "Vessa", gender: "Female",
  characterClass: "Mage", hairColor: "#111", glasses: true,
};

let passed = 0;
function check(label: string, fn: () => void): void {
  fn();
  passed++;
  console.log(`  ok — ${label}`);
}

check("fresh character: baselines known + slotted, no unspent points", () => {
  const view = buildSkillScreenView(character, newProgression("Mage"));
  assert.equal(view.level, 1);
  assert.equal(view.unspentSkillPoints, 0);
  assert.deepEqual(view.abilitySlots.slice(0, 2), baselineAbilityIds("Mage"));
  const known = view.knownAbilities.map((a) => a.id).sort();
  assert.deepEqual(known, baselineAbilityIds("Mage").sort());
  assert.ok(view.knownAbilities.every((a) => a.equipped), "baselines start equipped");
  // Root node should be available, capstone locked.
  assert.equal(view.nodes.find((n) => n.id === "ma_arcana")!.state, "available");
  assert.equal(view.nodes.find((n) => n.id === "ma_fireball")!.state, "locked");
});

check("after leveling + spending: node state + ability scores update", () => {
  const tree = CLASS_TALENT_TREES.Mage;
  const byId = Object.fromEntries(tree.nodes.map((n) => [n.id, n]));
  let prog = awardXp(newProgression("Mage"), xpForLevel(5));
  prog = spendTalentPoint(prog, byId["ma_arcana"]!);   // +1 INT
  prog = spendTalentPoint(prog, byId["ma_frost_ray"]!); // unlock frost_ray

  const view = buildSkillScreenView(character, prog);
  assert.ok(view.unspentSkillPoints >= 1, "still has points to spend");
  assert.equal(view.nodes.find((n) => n.id === "ma_arcana")!.rank, 1);
  assert.equal(view.nodes.find((n) => n.id === "ma_frost_ray")!.state, "maxed");
  assert.ok(view.knownAbilities.some((a) => a.id === "frost_ray"), "unlocked ability appears");
  assert.equal(
    view.knownAbilities.find((a) => a.id === "frost_ray")!.equipped,
    false,
    "newly unlocked ability is not auto-equipped"
  );

  // Base Mage INT is 16; +1 from Arcane Focus rank 1.
  assert.equal(view.abilityScores.int, 17, "passive INT folded into scores");
});

check("equipping an unlocked ability surfaces its slot in the view", () => {
  const tree = CLASS_TALENT_TREES.Mage;
  const byId = Object.fromEntries(tree.nodes.map((n) => [n.id, n]));
  let prog = awardXp(newProgression("Mage"), xpForLevel(5));
  prog = spendTalentPoint(prog, byId["ma_arcana"]!);
  prog = spendTalentPoint(prog, byId["ma_frost_ray"]!);
  prog = equipAbility(prog, tree, "frost_ray", 2);

  const view = buildSkillScreenView(character, prog);
  assert.equal(view.abilitySlots[2], "frost_ray");
  const fr = view.knownAbilities.find((a) => a.id === "frost_ray")!;
  assert.equal(fr.equipped, true);
  assert.equal(fr.slotIndex, 2);
});

console.log(`\n✓ skillScreen smoke: ${passed} checks passed`);
