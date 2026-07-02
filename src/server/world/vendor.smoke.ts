/**
 * vendor.smoke.ts — Guards the shop: every vendor stocks real catalog items,
 * prices resolve, the shop view lists wares with correct affordability, and a
 * buy/sell round-trip through the pure helpers moves gold and goods correctly.
 *
 * Run with: npx tsx src/server/world/vendor.smoke.ts
 */

import assert from "node:assert/strict";

import { NPCS } from "./npcs";
import { resolveStock, vendorPrice, stockPrice } from "./vendor";
import { buildShopView } from "../character/inventoryScreen";
import { newInventory, addItem, buy, sell, equip, itemById, sellValue } from "../../types/items";

let passed = 0;
function check(label: string, fn: () => void): void {
  fn();
  passed++;
  console.log(`  ok — ${label}`);
}

const vendors = NPCS.filter(n => n.role === "vendor");

check("every vendor stocks only real catalog items at positive prices", () => {
  assert.ok(vendors.length > 0, "there are vendors");
  for (const v of vendors) {
    for (const entry of v.stock ?? []) {
      assert.ok(itemById(entry.itemId), `${v.id} stocks unknown item "${entry.itemId}"`);
      assert.ok(stockPrice(entry) > 0, `${v.id} charges a positive price for ${entry.itemId}`);
    }
    // Resolved display rows carry a name + price from the catalog.
    for (const row of resolveStock(v)) {
      assert.ok(row.name && row.price > 0, `${v.id} row ${row.id} resolved`);
    }
  }
});

check("shop view marks affordability against the purse", () => {
  const borin = vendors.find(v => v.id === "borin")!;
  const poor = buildShopView(borin, newInventory(0));
  assert.ok(poor.forSale.every(e => e.affordable === false), "broke → nothing affordable");
  const rich = buildShopView(borin, newInventory(9999));
  assert.ok(rich.forSale.every(e => e.affordable === true), "flush → all affordable");
});

check("buying deducts the vendor's price and adds the item", () => {
  const isolde = vendors.find(v => v.id === "isolde")!;
  const potionId = "healing_potion";
  const price = vendorPrice(isolde, potionId)!;
  assert.equal(price, itemById(potionId)!.value, "default price is the catalog value");

  const inv = newInventory(price + 5);
  const after = buy(inv, potionId, price)!;
  assert.equal(after.gold, 5, "gold deducted by price");
  assert.equal(after.items[potionId], 1, "item added to pack");
});

check("selling a carried item credits its sell value", () => {
  const def = itemById("iron_sword")!;
  const inv = addItem(newInventory(0), "iron_sword", 1);
  const after = sell(inv, "iron_sword")!;
  assert.equal(after.gold, sellValue(def), "credited at sell value");
  assert.ok(!after.items.iron_sword, "item left the pack");
});

check("sell list offers only unequipped stock", () => {
  const isolde = vendors.find(v => v.id === "isolde")!;
  let inv = addItem(newInventory(0), "iron_sword", 1);
  // Equip the sword — it should then NOT be sellable.
  inv = equip(inv, "iron_sword");
  const view = buildShopView(isolde, inv);
  assert.ok(!view.sellable.some(e => e.itemId === "iron_sword"), "equipped gear isn't in the sell list");
});

console.log(`\nvendor.smoke: ${passed} checks passed.`);
