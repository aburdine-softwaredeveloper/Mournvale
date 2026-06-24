/**
 * progression.smoke.ts — Standalone smoke test for the progression layer.
 *
 * No test framework required (none is installed). Run with:
 *   npx tsx src/types/progression.smoke.ts
 * Exits non-zero on the first failed assertion.
 */

import assert from "node:assert/strict";

import { CLASS_ABILITIES, baselineAbilityIds, abilityById } from "./character";
import { CLASS_TALENT_TREES } from "./talents";
import {
  ABILITY_SLOTS,
  newProgression,
  awardXp,
  xpForLevel,
  levelForXp,
  spendTalentPoint,
  spendAttributePoint,
  canRankUp,
  knownAbilityIds,
  equipAbility,
  unequipSlot,
  equippedAbilityIds,
  applyProgression,
  type ProgressionState,
} from "./progression";
import { buildCharacterStats, CHARACTER_CLASSES, CLASS_BASE_ABILITY_SCORES } from "./character";

let passed = 0;
function check(label: string, fn: () => void): void {
  fn();
  passed++;
  console.log(`  ok — ${label}`);
}

// ── Data integrity: every talent unlock points at a real, non-baseline ability ──
check("talent unlock_ability ids reference real, non-baseline abilities", () => {
  for (const charClass of CHARACTER_CLASSES) {
    const tree = CLASS_TALENT_TREES[charClass];
    const baselines = new Set(baselineAbilityIds(charClass));
    for (const node of tree.nodes) {
      if (node.reward.kind === "unlock_ability" || node.reward.kind === "rank_ability") {
        const ability = abilityById(charClass, node.reward.abilityId);
        assert.ok(ability, `${charClass}/${node.id} → missing ability "${node.reward.abilityId}"`);
        assert.ok(
          !baselines.has(node.reward.abilityId),
          `${charClass}/${node.id} unlocks baseline "${node.reward.abilityId}" (should be talent-only)`
        );
      }
    }
  }
});

check("every class has exactly 2 baseline abilities and a non-empty pool", () => {
  for (const charClass of CHARACTER_CLASSES) {
    assert.equal(baselineAbilityIds(charClass).length, 2, `${charClass} baseline count`);
    assert.ok(CLASS_ABILITIES[charClass].length > 2, `${charClass} should have unlockable extras`);
  }
});

check("talent node prerequisites reference real nodes in the same tree", () => {
  for (const charClass of CHARACTER_CLASSES) {
    const ids = new Set(CLASS_TALENT_TREES[charClass].nodes.map((n) => n.id));
    for (const node of CLASS_TALENT_TREES[charClass].nodes) {
      for (const req of node.requires) {
        assert.ok(ids.has(req.nodeId), `${charClass}/${node.id} requires unknown node "${req.nodeId}"`);
      }
    }
  }
});

// ── Leveling curve ──
check("xp/level curve is monotonic and round-trips", () => {
  for (let lvl = 1; lvl <= 20; lvl++) {
    assert.equal(levelForXp(xpForLevel(lvl)), lvl, `level ${lvl} round-trip`);
    if (lvl > 1) assert.ok(xpForLevel(lvl) > xpForLevel(lvl - 1), `xp increases at ${lvl}`);
  }
});

// ── New character seeds baselines into slots ──
check("newProgression seeds baseline abilities into the first slots", () => {
  const prog = newProgression("Knight");
  assert.equal(prog.equippedAbilityIds.length, ABILITY_SLOTS);
  assert.deepEqual(prog.equippedAbilityIds.slice(0, 2), baselineAbilityIds("Knight"));
  assert.deepEqual(prog.equippedAbilityIds.slice(2), Array(ABILITY_SLOTS - 2).fill(null));
  assert.equal(prog.unspentSkillPoints, 0, "level 1 has no skill points");
});

// ── Cost-weighted spend / award round-trip (the bug fix) ──
check("awardXp recomputes unspent points correctly after a cost-2 spend", () => {
  const tree = CLASS_TALENT_TREES.Knight;
  // Reach a level with enough lifetime points to buy the chain + capstone.
  let prog: ProgressionState = awardXp(newProgression("Knight"), xpForLevel(10));
  const lvl10Points = prog.unspentSkillPoints;
  assert.ok(lvl10Points >= 6, `expected >=6 points at L10, got ${lvl10Points}`);

  const byId = Object.fromEntries(tree.nodes.map((n) => [n.id, n]));
  // root(1) → guardian(1) → shieldwall(1) → unbreakable(1) → valiant(cost 2)
  for (const id of ["kn_bulwark", "kn_guardian", "kn_shieldwall", "kn_unbreakable", "kn_valiant"]) {
    const before = prog;
    prog = spendTalentPoint(prog, byId[id]!);
    assert.notEqual(prog, before, `spend on ${id} should succeed`);
  }
  // capstone cost 2 → total spent = 1+1+1+1+2 = 6
  assert.equal(prog.spentSkillPoints, 6, "cost-weighted spend total");
  assert.equal(prog.unspentSkillPoints, lvl10Points - 6, "unspent reflects cost-weighted spend");

  // Re-awarding 0 XP must be idempotent — not refund or double-grant.
  const reconciled = awardXp(prog, 0);
  assert.equal(reconciled.unspentSkillPoints, prog.unspentSkillPoints, "awardXp idempotent");
  assert.equal(reconciled.spentSkillPoints, 6, "spent preserved across awardXp");
});

check("canRankUp blocks unaffordable or prereq-missing nodes", () => {
  const tree = CLASS_TALENT_TREES.Mage;
  const fresh = newProgression("Mage"); // 0 points
  const root = tree.nodes.find((n) => n.id === "ma_arcana")!;
  assert.equal(canRankUp(root, fresh), false, "no points → cannot rank");

  const funded = awardXp(fresh, xpForLevel(3));
  const capstone = tree.nodes.find((n) => n.id === "ma_fireball")!;
  assert.equal(canRankUp(capstone, funded), false, "prereqs unmet → cannot rank capstone");
  assert.equal(canRankUp(root, funded), true, "root affordable with points");
});

// ── Known abilities = baselines + unlocked ──
check("knownAbilityIds unions baselines with talent unlocks", () => {
  const tree = CLASS_TALENT_TREES.Mage;
  let prog = awardXp(newProgression("Mage"), xpForLevel(5));
  const byId = Object.fromEntries(tree.nodes.map((n) => [n.id, n]));
  const baseKnown = knownAbilityIds(prog, tree);
  assert.deepEqual([...baseKnown].sort(), baselineAbilityIds("Mage").sort(), "starts as baselines only");

  prog = spendTalentPoint(prog, byId["ma_arcana"]!);
  prog = spendTalentPoint(prog, byId["ma_frost_ray"]!);
  assert.ok(knownAbilityIds(prog, tree).has("frost_ray"), "unlocked ability becomes known");
});

// ── Ability slots ──
check("equipAbility slots a known ability and never duplicates it", () => {
  const tree = CLASS_TALENT_TREES.Mage;
  let prog = awardXp(newProgression("Mage"), xpForLevel(5));
  const byId = Object.fromEntries(tree.nodes.map((n) => [n.id, n]));
  prog = spendTalentPoint(prog, byId["ma_arcana"]!);
  prog = spendTalentPoint(prog, byId["ma_frost_ray"]!);

  // Swap frost_ray into an empty slot (index 2).
  prog = equipAbility(prog, tree, "frost_ray", 2);
  assert.equal(prog.equippedAbilityIds[2], "frost_ray");

  // Move it to slot 0 — must not remain in slot 2.
  prog = equipAbility(prog, tree, "frost_ray", 0);
  assert.equal(prog.equippedAbilityIds[0], "frost_ray");
  assert.equal(prog.equippedAbilityIds[2], null, "no duplicate slot");

  // Unknown ability is rejected by reference.
  const before = prog;
  assert.equal(equipAbility(prog, tree, "fireball", 1), before, "cannot equip unknown ability");

  assert.equal(equippedAbilityIds(prog).includes("frost_ray"), true);
  prog = unequipSlot(prog, 0);
  assert.equal(prog.equippedAbilityIds[0], null, "unequip clears the slot");
});

// ── Attribute points ──
check("spendAttributePoint allocates a point and awardXp stays consistent", () => {
  // Level 4 grants the first attribute point (ATTRIBUTE_POINT_LEVELS).
  let prog = awardXp(newProgression("Warrior"), xpForLevel(4));
  assert.equal(prog.unspentAttributePoints, 1, "L4 grants 1 attribute point");

  const before = prog;
  prog = spendAttributePoint(prog, "str");
  assert.notEqual(prog, before, "spend should produce new state");
  assert.equal(prog.attributeAllocations.str, 1, "allocation recorded");
  assert.equal(prog.unspentAttributePoints, 0, "point consumed");

  // No points left → rejected by reference.
  assert.equal(spendAttributePoint(prog, "str"), prog, "no points → no-op");

  // Re-awarding XP must not refund the spent point.
  const reconciled = awardXp(prog, 0);
  assert.equal(reconciled.unspentAttributePoints, 0, "awardXp keeps allocation accounted");

  // The allocation shows up in projected stats.
  const stats = applyProgression(buildCharacterStats("Warrior", prog.level), prog, CLASS_TALENT_TREES.Warrior);
  assert.equal(stats.abilityScores.str, CLASS_BASE_ABILITY_SCORES.Warrior.str + 1);
});

// ── applyProgression folds passives + allocations into stats ──
check("applyProgression adds passive stats and manual allocations", () => {
  const tree = CLASS_TALENT_TREES.Knight;
  let prog = awardXp(newProgression("Knight"), xpForLevel(6));
  const byId = Object.fromEntries(tree.nodes.map((n) => [n.id, n]));
  prog = spendTalentPoint(prog, byId["kn_bulwark"]!); // +1 con
  prog = { ...prog, attributeAllocations: { ...prog.attributeAllocations, str: 2 } };

  const base = buildCharacterStats("Knight", prog.level);
  const projected = applyProgression(base, prog, tree);
  assert.equal(projected.abilityScores.con, base.abilityScores.con + 1, "passive con applied");
  assert.equal(projected.abilityScores.str, base.abilityScores.str + 2, "allocation applied");
  assert.equal(projected.level, prog.level, "level carried through");
});

console.log(`\n✓ progression smoke: ${passed} checks passed`);
