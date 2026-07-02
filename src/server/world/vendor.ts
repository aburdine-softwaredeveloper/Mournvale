/**
 * vendor.ts — Resolving a vendor's authored stock against the item catalog.
 *
 * NPC.stock is a lean list of StockEntry (catalog itemId + optional price
 * override); this turns it into concrete prices and display rows by reading the
 * catalog (types/items.ts). Shared by the talk-interaction "selling:" flavor line
 * and the shop screen so a vendor's prices and descriptions come from one place.
 */

import type { NPC, VendorItem, StockEntry } from "../../types/npc";
import { itemById } from "../../types/items";

/** What a vendor charges for a stock line — the override, else the catalog value. */
export function stockPrice(entry: StockEntry): number {
  return entry.price ?? itemById(entry.itemId)?.value ?? 0;
}

/** The price this vendor charges for `itemId`, or null if they don't stock it. */
export function vendorPrice(npc: NPC, itemId: string): number | null {
  const entry = (npc.stock ?? []).find(s => s.itemId === itemId);
  return entry ? stockPrice(entry) : null;
}

/** Resolve a vendor's stock into display rows (name/description from the catalog). */
export function resolveStock(npc: NPC): VendorItem[] {
  const out: VendorItem[] = [];
  for (const entry of npc.stock ?? []) {
    const def = itemById(entry.itemId);
    if (!def) continue;
    out.push({ id: def.id, name: def.name, price: stockPrice(entry), description: def.description });
  }
  return out;
}
