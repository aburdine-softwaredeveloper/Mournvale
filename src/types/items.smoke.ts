/**
 * items.smoke.ts — Verifies the inventory model: add/remove counts, equip moves
 * an item between pack and slot (and swaps the old one back), buy/sell respect
 * gold, the catalog is well-formed, and equipped modifiers aggregate correctly.
 *
 * Run with: npx tsx src/types/items.smoke.ts
 */

import assert from "node:assert/strict";

import {
  ITEMS, itemById, sellValue, newInventory, heldCount,
  addItem, removeItem, canEquip, equip, unequip, equippedItems,
  buy, sell, aggregateModifiers, applyEquipment, equipmentBonusHp,
} from "./items";
import { buildCharacterStats } from "./character";

let passed = 0;
function check(label: string, fn: () => void): void {
  fn();
  passed++;
  console.log(`  ok — ${label}`);
}

check("catalog is well-formed (equippables have a slot + modifiers; consumables an effect)", () => {
  for (const [id, def] of Object.entries(ITEMS)) {
    assert.equal(def.id, id, `${id} id matches key`);
    assert.ok(def.value >= 0, `${id} has a value`);
    if (def.kind === "consumable") {
      assert.ok(def.consumable, `${id} (consumable) has an effect`);
    } else {
      assert.ok(def.slot, `${id} (equippable) has a slot`);
      assert.ok(def.modifiers, `${id} (equippable) has modifiers`);
      // A weapon item's slot must be "weapon" and carry a replacement weapon.
      if (def.kind === "weapon") {
        assert.equal(def.slot, "weapon");
        assert.ok(def.modifiers!.weapon, `${id} carries a weapon`);
      }
    }
  }
});

check("add/remove track counts and are pure", () => {
  const inv = newInventory();
  const a = addItem(inv, "healing_potion", 3);
  assert.equal(heldCount(a, "healing_potion"), 3);
  assert.equal(heldCount(inv, "healing_potion"), 0, "original untouched");
  const b = removeItem(a, "healing_potion", 2);
  assert.equal(heldCount(b, "healing_potion"), 1);
  // Over-remove is rejected by reference.
  assert.equal(removeItem(b, "healing_potion", 5), b, "can't remove more than held");
  // Removing the last one clears the key.
  const c = removeItem(b, "healing_potion", 1);
  assert.equal(heldCount(c, "healing_potion"), 0);
  assert.ok(!("healing_potion" in c.items), "empty stack key deleted");
  // Unknown ids ignored.
  assert.equal(addItem(inv, "no_such_item", 1), inv);
});

check("equip moves item to its slot and swaps the previous one back", () => {
  let inv = newInventory();
  inv = addItem(inv, "leather_jerkin", 1);
  inv = addItem(inv, "chainmail", 1);
  assert.ok(canEquip(inv, "leather_jerkin"));

  inv = equip(inv, "leather_jerkin");
  assert.equal(inv.equipped.armor, "leather_jerkin");
  assert.equal(heldCount(inv, "leather_jerkin"), 0, "equipped item left the pack");

  // Equipping a second armor swaps the first back into the pack.
  inv = equip(inv, "chainmail");
  assert.equal(inv.equipped.armor, "chainmail");
  assert.equal(heldCount(inv, "leather_jerkin"), 1, "old armor returned to pack");

  inv = unequip(inv, "armor");
  assert.equal(inv.equipped.armor, null);
  assert.equal(heldCount(inv, "chainmail"), 1, "unequipped item back in pack");

  // Can't equip something you don't hold — returns the same inventory by ref.
  const empty = newInventory();
  assert.equal(equip(empty, "chainmail"), empty);
});

check("buy and sell respect the gold purse", () => {
  let inv = newInventory(50);
  assert.equal(buy(inv, "warden_plate", 180), null, "can't afford it");
  const bought = buy(inv, "healing_potion", 25)!;
  assert.equal(bought.gold, 25);
  assert.equal(heldCount(bought, "healing_potion"), 1);

  const sold = sell(bought, "healing_potion")!;
  assert.equal(heldCount(sold, "healing_potion"), 0);
  assert.equal(sold.gold, 25 + sellValue(itemById("healing_potion")!), "gold credited at sell value");
  // Selling what you don't have is rejected.
  assert.equal(sell(inv, "iron_sword"), null);
});

check("equipped modifiers aggregate across slots", () => {
  let inv = newInventory();
  for (const id of ["fogsteel_axe", "warden_plate", "might_amulet"]) inv = addItem(inv, id, 1);
  inv = equip(inv, "fogsteel_axe");
  inv = equip(inv, "warden_plate");
  inv = equip(inv, "might_amulet");

  assert.equal(equippedItems(inv).length, 3);
  const mods = aggregateModifiers(inv);
  assert.equal(mods.ac, 3, "warden plate AC");
  assert.equal(mods.maxHp, 6, "warden plate HP");
  assert.equal(mods.abilityScores.str, 2, "amulet str");
  assert.equal(mods.weapon?.id, "fogsteel_axe", "weapon replaced");
  assert.equal(mods.weapon?.damageDice, "1d12");
});

check("applyEquipment projects gear onto a stat block", () => {
  let inv = newInventory();
  for (const id of ["fogsteel_axe", "warden_plate", "might_amulet"]) inv = addItem(inv, id, 1);
  inv = equip(inv, "fogsteel_axe");
  inv = equip(inv, "warden_plate");
  inv = equip(inv, "might_amulet");

  const base = buildCharacterStats("Knight", 1);
  const geared = applyEquipment(base, inv);
  assert.equal(geared.ac, base.ac + 3, "AC raised by plate");
  assert.equal(geared.abilityScores.str, base.abilityScores.str + 2, "STR raised by amulet");
  assert.equal(geared.equippedWeapon.id, "fogsteel_axe", "weapon swapped to the axe");
  assert.equal(equipmentBonusHp(inv), 6, "plate grants flat HP");
  // Pure — base untouched.
  assert.notEqual(base.equippedWeapon.id, "fogsteel_axe");
});

console.log(`\nitems.smoke: ${passed} checks passed.`);
