/**
 * inventoryScreen.ts — Builds the client-facing InventoryView from an Inventory.
 *
 * Pure and string-producing, like buildSkillScreenView: turns the persisted
 * counts/equipped ids into a display list (equipped pieces first, then carried
 * stacks) with a readable effect line per item and a one-line summary of the
 * total combat bonus from gear. The server sends this on open and after every
 * validated mutation, so the client never renders a stale pack.
 */

import type { InventoryView, InventoryItemView, ShopView, ShopEntryView } from "../../types/network";
import type { Inventory, ItemDef, AggregatedModifiers } from "../../types/items";
import type { NPC } from "../../types/npc";
import {
  ITEMS, itemById, sellValue, equippedItems, aggregateModifiers,
} from "../../types/items";
import { ABILITY_SCORE_NAMES } from "../../types/character";
import { resolveStock } from "../world/vendor";

/** A short, readable description of what an item does. */
function statLine(def: ItemDef): string {
  if (def.consumable) {
    const parts: string[] = [];
    if (def.consumable.heal) parts.push(`Heals ${def.consumable.heal}`);
    if (def.consumable.cure) parts.push(`Cures ${def.consumable.cure}`);
    return parts.join(", ") || "—";
  }
  const m = def.modifiers;
  if (!m) return "—";
  if (m.weapon) {
    const reach = m.weapon.range === 1 ? "melee" : `range ${m.weapon.range}`;
    return `${m.weapon.damageDice} · ${reach}`;
  }
  const parts: string[] = [];
  if (m.ac) parts.push(`+${m.ac} AC`);
  if (m.maxHp) parts.push(`+${m.maxHp} HP`);
  if (m.speed) parts.push(`+${m.speed} Speed`);
  if (m.abilityScores) {
    for (const key of ABILITY_SCORE_NAMES) {
      const v = m.abilityScores[key];
      if (v) parts.push(`${key.toUpperCase()} +${v}`);
    }
  }
  return parts.join(", ") || "—";
}

/** A one-line summary of the combined bonus from everything equipped. */
function bonusSummary(mods: AggregatedModifiers): string {
  const parts: string[] = [];
  if (mods.ac) parts.push(`+${mods.ac} AC`);
  if (mods.maxHp) parts.push(`+${mods.maxHp} HP`);
  if (mods.speed) parts.push(`+${mods.speed} Speed`);
  for (const key of ABILITY_SCORE_NAMES) {
    const v = mods.abilityScores[key];
    if (v) parts.push(`${key.toUpperCase()} +${v}`);
  }
  if (mods.weapon) parts.push(`Weapon: ${mods.weapon.name}`);
  return parts.length ? parts.join(" · ") : "No gear equipped.";
}

function row(def: ItemDef, count: number, equipped: boolean): InventoryItemView {
  return {
    id: def.id,
    name: def.name,
    description: def.description,
    kind: def.kind,
    rarity: def.rarity,
    ...(def.slot ? { slot: def.slot } : {}),
    count,
    equipped,
    usable: def.kind === "consumable",
    statLine: statLine(def),
    sellValue: sellValue(def),
  };
}

export function buildInventoryView(inv: Inventory): InventoryView {
  const rows: InventoryItemView[] = [];

  // Equipped pieces first (worn, so count is shown as 0 held).
  for (const def of equippedItems(inv)) rows.push(row(def, 0, true));

  // Then carried stacks, ordered by the catalog for stable display.
  for (const id of Object.keys(ITEMS)) {
    const count = inv.items[id] ?? 0;
    if (count <= 0) continue;
    const def = itemById(id);
    if (def) rows.push(row(def, count, false));
  }

  return { gold: inv.gold, items: rows, bonusSummary: bonusSummary(aggregateModifiers(inv)) };
}

function shopEntry(def: ItemDef, price: number, affordable?: boolean): ShopEntryView {
  return {
    itemId: def.id,
    name: def.name,
    description: def.description,
    statLine: statLine(def),
    rarity: def.rarity,
    price,
    ...(affordable !== undefined ? { affordable } : {}),
  };
}

/**
 * Builds a vendor's shop view: what they sell (with buy prices + affordability)
 * and what the player can sell back from their unequipped stock (at sellValue).
 * Equipped gear isn't offered for sale — take it off first.
 */
export function buildShopView(npc: NPC, inv: Inventory): ShopView {
  const forSale: ShopEntryView[] = resolveStock(npc).map(v => {
    const def = itemById(v.id)!;
    return shopEntry(def, v.price, inv.gold >= v.price);
  });

  const sellable: ShopEntryView[] = [];
  for (const id of Object.keys(ITEMS)) {
    if ((inv.items[id] ?? 0) <= 0) continue;
    const def = itemById(id);
    if (def) sellable.push(shopEntry(def, sellValue(def)));
  }

  return { vendorId: npc.id, vendorName: npc.name, gold: inv.gold, forSale, sellable };
}
