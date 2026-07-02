/**
 * items.ts — Items, the item catalog, and the inventory model.
 *
 * The missing economy layer: things a character can carry, equip, buy, sell, and
 * use. Mirrors the progression.ts conventions — a single authored data table
 * (ITEMS) plus pure, unit-testable functions that transform an Inventory. State
 * (Inventory) lives on the Player, is persisted per save slot, and is only ever
 * mutated through the helpers here.
 *
 * Design choices kept deliberately simple for v1:
 *   - Items are CATALOG entries (no per-instance random rolls yet), so an
 *     inventory is just counts of item ids + what's equipped + a gold purse. This
 *     serializes trivially and keeps the math legible.
 *   - Equippable items carry flat `modifiers` (AC, ability scores, HP, speed, or a
 *     replacement weapon) that are folded onto CharacterStats at combat time —
 *     the same "project onto stats" pattern as talents (see applyEquipment).
 */

import type { AbilityScore, Weapon, Condition, CharacterStats } from "./character";

// ─── Item shapes ────────────────────────────────────────────────────────────────

/** Equip slots — at most one item each. */
export type ItemSlot = "weapon" | "armor" | "trinket";

/** What kind of thing an item is (drives how it's used). */
export type ItemKind = "weapon" | "armor" | "trinket" | "consumable";

/** Quality tier — flavor + a hook for drop rates and shop pricing. */
export type ItemRarity = "common" | "uncommon" | "rare" | "epic";

/** Flat bonuses an equipped item grants, layered onto CharacterStats. */
export interface ItemModifiers {
  ac?: number;
  abilityScores?: Partial<Record<AbilityScore, number>>;
  maxHp?: number;
  speed?: number;
  /** Weapons replace the wielder's equipped weapon outright. */
  weapon?: Weapon;
}

/** What a consumable does when used. */
export interface ConsumableEffect {
  /** Dice healed, e.g. "2d4+2". Resolved at use time. */
  heal?: string;
  /** A condition the item cures. */
  cure?: Condition;
}

/** One catalog entry — static authored data. */
export interface ItemDef {
  id: string;
  name: string;
  description: string;
  kind: ItemKind;
  rarity: ItemRarity;
  /** Gold value; shops buy at ~value, sell back at sellValue() (half). */
  value: number;
  /** For equippable kinds — which slot it occupies. */
  slot?: ItemSlot;
  /** For equippable kinds — the bonuses it grants while worn/wielded. */
  modifiers?: ItemModifiers;
  /** For consumables — what using it does. */
  consumable?: ConsumableEffect;
}

// ─── The catalog ─────────────────────────────────────────────────────────────────

/**
 * Every item in the game, keyed by id. Add an item by adding an entry — drops,
 * shops, the inventory screen, and equipment math all read from here.
 */
export const ITEMS: Record<string, ItemDef> = {
  // ── Weapons (replace the equipped weapon) ──
  iron_sword: {
    id: "iron_sword", name: "Iron Sword", description: "A plain but reliable blade, a cut above militia steel.",
    kind: "weapon", rarity: "common", value: 30, slot: "weapon",
    modifiers: { weapon: { id: "iron_sword", name: "Iron Sword", damageDice: "1d8+1", range: 1, abilityScore: "str" } },
  },
  fogsteel_axe: {
    id: "fogsteel_axe", name: "Fogsteel Axe", description: "Forged in the Greyfall's chill; it bites deep and never dulls.",
    kind: "weapon", rarity: "rare", value: 120, slot: "weapon",
    modifiers: { weapon: { id: "fogsteel_axe", name: "Fogsteel Axe", damageDice: "1d12", range: 1, abilityScore: "str" } },
  },
  hunting_bow: {
    id: "hunting_bow", name: "Hunting Bow", description: "A supple yew bow that reaches across the field.",
    kind: "weapon", rarity: "uncommon", value: 70, slot: "weapon",
    modifiers: { weapon: { id: "hunting_bow", name: "Hunting Bow", damageDice: "1d8", range: 5, abilityScore: "dex" } },
  },

  // ── Armor (slot: armor) ──
  leather_jerkin: {
    id: "leather_jerkin", name: "Leather Jerkin", description: "Boiled hide that turns a glancing blow.",
    kind: "armor", rarity: "common", value: 25, slot: "armor", modifiers: { ac: 1 },
  },
  chainmail: {
    id: "chainmail", name: "Chainmail", description: "Interlinked rings, heavy but trustworthy.",
    kind: "armor", rarity: "uncommon", value: 80, slot: "armor", modifiers: { ac: 2 },
  },
  warden_plate: {
    id: "warden_plate", name: "Warden's Plate", description: "Old watch armor, dented by a hundred fights it survived.",
    kind: "armor", rarity: "rare", value: 180, slot: "armor", modifiers: { ac: 3, maxHp: 6 },
  },

  // ── Trinkets (slot: trinket) ──
  vigor_ring: {
    id: "vigor_ring", name: "Ring of Vigor", description: "A warm band that steadies the heart and stretches the breath.",
    kind: "trinket", rarity: "uncommon", value: 90, slot: "trinket", modifiers: { maxHp: 8 },
  },
  might_amulet: {
    id: "might_amulet", name: "Amulet of Might", description: "Heavy on the neck, heavier in the swing.",
    kind: "trinket", rarity: "rare", value: 130, slot: "trinket", modifiers: { abilityScores: { str: 2 } },
  },
  swift_boots: {
    id: "swift_boots", name: "Boots of the Swift", description: "Worn soft; the ground seems to hurry beneath them.",
    kind: "trinket", rarity: "uncommon", value: 85, slot: "trinket", modifiers: { speed: 1 },
  },

  // ── Consumables ──
  healing_potion: {
    id: "healing_potion", name: "Healing Potion", description: "A red draught that knits flesh in moments.",
    kind: "consumable", rarity: "common", value: 25, consumable: { heal: "2d4+2" },
  },
  greater_healing_potion: {
    id: "greater_healing_potion", name: "Greater Healing Potion", description: "Thicker, darker, and far more potent.",
    kind: "consumable", rarity: "uncommon", value: 60, consumable: { heal: "4d4+4" },
  },
  antidote: {
    id: "antidote", name: "Antidote", description: "Bitter herbs steeped to draw out venom.",
    kind: "consumable", rarity: "common", value: 20, consumable: { cure: "poisoned" },
  },

  // ── Named quest rewards (granted by completing specific quests) ──
  lantern_of_warding: {
    id: "lantern_of_warding", name: "Lantern of Warding", description: "Its pale flame never gutters; the dark leans away from it.",
    kind: "trinket", rarity: "uncommon", value: 100, slot: "trinket", modifiers: { abilityScores: { wis: 1 }, maxHp: 4 },
  },
  bellringers_seal: {
    id: "bellringers_seal", name: "Bellringer's Seal", description: "An old chapel sigil that steadies the hand and the heart.",
    kind: "trinket", rarity: "rare", value: 160, slot: "trinket", modifiers: { abilityScores: { con: 1 }, ac: 1 },
  },
  fogbreakers_crown: {
    id: "fogbreakers_crown", name: "Fogbreaker's Crown", description: "Won from the Fogmother herself; the Greyfall remembers its weight.",
    kind: "trinket", rarity: "epic", value: 500, slot: "trinket", modifiers: { abilityScores: { str: 2 }, maxHp: 12, ac: 1 },
  },
};

/** Catalog lookup. */
export function itemById(id: string): ItemDef | undefined {
  return ITEMS[id];
}

/** Catalog lookup by display name (used to resolve authored quest reward items). */
export function itemByName(name: string): ItemDef | undefined {
  return Object.values(ITEMS).find(i => i.name === name);
}

/** Sale price when selling back to a shop — half value, floor 1. */
export function sellValue(item: ItemDef): number {
  return Math.max(1, Math.floor(item.value / 2));
}

// ─── Inventory state (persisted per save slot) ──────────────────────────────────

/**
 * One character's purse and pack. `items` counts UNEQUIPPED stock by id;
 * `equipped` names the worn item per slot (or null). Equipping moves an id from
 * `items` into `equipped`; unequipping moves it back — so a given physical item
 * is in exactly one place.
 */
export interface Inventory {
  gold: number;
  items: Record<string, number>;
  equipped: Record<ItemSlot, string | null>;
}

const ALL_SLOTS: ItemSlot[] = ["weapon", "armor", "trinket"];

/** A fresh purse for a new character. */
export function newInventory(startingGold = 0): Inventory {
  return { gold: startingGold, items: {}, equipped: { weapon: null, armor: null, trinket: null } };
}

/** How many of an unequipped item the character is carrying. */
export function heldCount(inv: Inventory, itemId: string): number {
  return inv.items[itemId] ?? 0;
}

/** Add `qty` of an item to the pack. Pure. Unknown ids are ignored. */
export function addItem(inv: Inventory, itemId: string, qty = 1): Inventory {
  if (qty <= 0 || !itemById(itemId)) return inv;
  return { ...inv, items: { ...inv.items, [itemId]: heldCount(inv, itemId) + qty } };
}

/** Remove `qty` of an item from the pack. Returns the SAME inventory if there
 * aren't that many to remove (so callers can detect rejection by reference). */
export function removeItem(inv: Inventory, itemId: string, qty = 1): Inventory {
  const have = heldCount(inv, itemId);
  if (qty <= 0 || have < qty) return inv;
  const next = { ...inv.items };
  if (have - qty <= 0) delete next[itemId];
  else next[itemId] = have - qty;
  return { ...inv, items: next };
}

/** Whether an item can be equipped right now: it's equippable and in the pack. */
export function canEquip(inv: Inventory, itemId: string): boolean {
  const def = itemById(itemId);
  return !!def && !!def.slot && heldCount(inv, itemId) > 0;
}

/**
 * Equip an item into its slot. The newly-equipped item leaves the pack; whatever
 * was in that slot returns to the pack. Returns the SAME inventory if the item
 * isn't equippable or isn't held.
 */
export function equip(inv: Inventory, itemId: string): Inventory {
  const def = itemById(itemId);
  if (!def?.slot || heldCount(inv, itemId) <= 0) return inv;
  const slot = def.slot;
  let next = removeItem(inv, itemId, 1);
  const previously = next.equipped[slot];
  if (previously) next = addItem(next, previously, 1);
  return { ...next, equipped: { ...next.equipped, [slot]: itemId } };
}

/** Take whatever is in a slot off and return it to the pack. */
export function unequip(inv: Inventory, slot: ItemSlot): Inventory {
  const current = inv.equipped[slot];
  if (!current) return inv;
  const next = addItem(inv, current, 1);
  return { ...next, equipped: { ...next.equipped, [slot]: null } };
}

/** The defs of all currently-equipped items, in slot order. */
export function equippedItems(inv: Inventory): ItemDef[] {
  return ALL_SLOTS
    .map(s => inv.equipped[s])
    .filter((id): id is string => id !== null)
    .map(id => itemById(id))
    .filter((d): d is ItemDef => d !== undefined);
}

// ─── Buying & selling ────────────────────────────────────────────────────────────

/** Buy one of an item at `price`. Returns null if the gold isn't there. */
export function buy(inv: Inventory, itemId: string, price: number): Inventory | null {
  if (!itemById(itemId) || inv.gold < price) return null;
  return addItem({ ...inv, gold: inv.gold - price }, itemId, 1);
}

/** Sell one held item back for its sellValue. Returns null if none are held. */
export function sell(inv: Inventory, itemId: string): Inventory | null {
  const def = itemById(itemId);
  if (!def || heldCount(inv, itemId) <= 0) return null;
  return { ...removeItem(inv, itemId, 1), gold: inv.gold + sellValue(def) };
}

// ─── Projecting equipment onto stats ─────────────────────────────────────────────

/** The combined effect of everything currently equipped. */
export interface AggregatedModifiers {
  ac: number;
  maxHp: number;
  speed: number;
  abilityScores: Partial<Record<AbilityScore, number>>;
  weapon: Weapon | undefined;
}

/** The summed flat bonuses from everything currently equipped. */
export function aggregateModifiers(inv: Inventory): AggregatedModifiers {
  const out: AggregatedModifiers = { ac: 0, maxHp: 0, speed: 0, abilityScores: {}, weapon: undefined };
  for (const def of equippedItems(inv)) {
    const m = def.modifiers;
    if (!m) continue;
    if (m.ac) out.ac += m.ac;
    if (m.maxHp) out.maxHp += m.maxHp;
    if (m.speed) out.speed += m.speed;
    if (m.weapon) out.weapon = m.weapon;
    if (m.abilityScores) {
      for (const key of Object.keys(m.abilityScores) as AbilityScore[]) {
        out.abilityScores[key] = (out.abilityScores[key] ?? 0) + (m.abilityScores[key] ?? 0);
      }
    }
  }
  return out;
}

/**
 * Layer equipped-gear bonuses onto a CharacterStats block. Pure: returns new
 * stats with AC, ability scores, speed, and the wielded weapon updated. The same
 * "project onto stats" shape as applyProgression in progression.ts — call it
 * after applyProgression when building a combat entity. (maxHp lives on the
 * combat entity, not stats, so it's surfaced separately via equipmentBonusHp.)
 */
export function applyEquipment(stats: CharacterStats, inv: Inventory): CharacterStats {
  const m = aggregateModifiers(inv);
  const abilityScores = { ...stats.abilityScores };
  for (const key of Object.keys(m.abilityScores) as AbilityScore[]) {
    abilityScores[key] += m.abilityScores[key] ?? 0;
  }
  return {
    ...stats,
    abilityScores,
    ac: stats.ac + m.ac,
    speed: stats.speed + m.speed,
    ...(m.weapon ? { equippedWeapon: m.weapon } : {}),
  };
}

/** Flat HP granted by equipped gear, added to a combat entity's maxHp. */
export function equipmentBonusHp(inv: Inventory): number {
  return aggregateModifiers(inv).maxHp;
}
