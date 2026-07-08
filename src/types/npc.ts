/**
 * npc.ts — Types for the NPC system
 *
 * All NPCs share a BaseNPC shape and are distinguished by `role`. This
 * keeps placement, listing, and interaction uniform while allowing
 * role-specific behavior (vendors have stock, quest-givers have quests).
 *
 * Phase 2 additions: TalkIntent, DialogueBranch, and DialogueOutcome
 * power the skill-check dialogue system. NPCs optionally define
 * `dialogueBranches` — if present, talking with an intent triggers a
 * d20 skill check and returns one of four outcome-keyed NPC lines.
 */

// ─── NPC roles ────────────────────────────────────────────────────────────────

/** What kind of NPC this is — drives interaction options. */
export type NpcRole =
  | "dialogue"   // just talks
  | "vendor"     // sells goods
  | "questgiver" // offers quests
  | "friendly"   // ambient friendly townsfolk
  | "hostile";   // hostile presence (triggers combat)

// ─── Talk intents (Phase 2) ───────────────────────────────────────────────────

/** The approach a player uses when initiating a skilled conversation. */
export type TalkIntent = "persuade" | "intimidate" | "inquire" | "deceive";

/** Maps each intent to the skill rolled against the NPC's DC. */
export const TALK_INTENT_SKILL: Record<TalkIntent, string> = {
  persuade:   "persuasion",
  intimidate: "intimidation",
  inquire:    "insight",
  deceive:    "deception",
};

/** Human-readable label used in the client intent-picker UI. */
export const TALK_INTENT_LABEL: Record<TalkIntent, string> = {
  persuade:   "Persuade",
  intimidate: "Intimidate",
  inquire:    "Inquire",
  deceive:    "Deceive",
};

// ─── Dialogue outcomes (Phase 2) ──────────────────────────────────────────────

/** The four result tiers of a skill check (mirrors SkillEngine.CheckTier). */
export type DialogueOutcome = "crit_fail" | "fail" | "success" | "crit_success";

/** What happens when a player achieves a particular outcome tier. */
export interface DialogueOutcomeData {
  /** The NPC's spoken response for this tier. */
  npcLine: string;
  /** Optional: unlocks this quest for the player (by quest id). */
  questUnlock?: string;
  /** Optional: reveals a piece of world lore displayed to the player. */
  infoReveal?: string;
  /**
   * Optional: the persistent lore key this tier teaches (see Quest.requiresLore).
   * Where infoReveal is the flavor the player reads, loreKey is the campaign
   * flag it sets — a hard-won conversation can open the next chapter.
   */
  loreKey?: string;
  /** Optional: changes the NPC's stance toward the player. */
  standing?: "hostile" | "neutral" | "friendly";
}

/**
 * One full intent branch: the DC the player must beat, and what the NPC
 * says on each of the four outcome tiers.
 */
export interface DialogueBranch {
  intent: TalkIntent;
  /** Difficulty class the player's skill check is compared against. */
  dc: number;
  outcomes: Record<DialogueOutcome, DialogueOutcomeData>;
}

// ─── Base NPC data ────────────────────────────────────────────────────────────

/** A single line the NPC can say. */
export interface NpcDialogue {
  text: string;
}

/**
 * One line of a vendor's authored stock — a reference to a catalog item
 * (types/items.ts) with an optional price override. When `price` is omitted the
 * shop charges the item's catalog `value`. Kept as a lean reference so the shop,
 * the item's stats, and its description all come from one source (the catalog).
 */
export interface StockEntry {
  itemId: string;
  price?: number;
}

/**
 * A vendor's stock resolved for display (used in the talk-interaction "selling:"
 * flavor line). Built from StockEntry + the catalog — name/description come from
 * the item, price from the entry or the catalog value.
 */
export interface VendorItem {
  id: string;
  name: string;
  price: number;
  description: string;
}

/**
 * The full NPC definition — static world data.
 *
 * Role-specific fields are optional:
 *   - questIds        → questgiver
 *   - stock           → vendor
 *   - dialogueBranches → any NPC that supports skilled conversation
 */
export interface NPC {
  id: string;
  name: string;
  /** Short title shown under the name, e.g. "Barkeep", "Blacksmith" */
  title: string;
  role: NpcRole;
  /** Which room this NPC stands in */
  roomId: string;
  /** Default lines shown when the player talks with no special intent */
  dialogue: NpcDialogue[];
  /** Quest ids this NPC offers (questgiver role) */
  questIds?: string[];
  /**
   * Lore taught simply by talking to this NPC at all (any talk/say path,
   * first time only per character). `key` is the campaign flag (see
   * Quest.requiresLore); `note` is the line shown when the player learns it.
   * This is the cheapest story reward for conversation: seek someone out,
   * hear them, and new work opens.
   */
  meetLore?: { key: string; note: string };
  /**
   * For hostile NPCs: which monster template (enemyTemplates.ts) supplies this
   * combatant's stats. Defaults to the weakest (rat) if omitted, so a hostile
   * is never accidentally spawned as a full Warrior.
   */
  enemyTemplate?: string;
  /** Goods for sale (vendor role) — catalog references, resolved for display. */
  stock?: StockEntry[];
  /**
   * Skilled conversation branches (Phase 2).
   * Each entry handles one TalkIntent and defines DC + four outcome lines.
   * If absent (or the chosen intent has no branch), the NPC's default
   * dialogue is returned without a skill check.
   */
  dialogueBranches?: DialogueBranch[];
}

// ─── Client-facing views ──────────────────────────────────────────────────────

/**
 * A lightweight NPC summary sent to clients for the room "Here" list.
 * Excludes full dialogue/stock — those are fetched on interaction.
 */
export interface NpcView {
  id: string;
  name: string;
  title: string;
  role: NpcRole;
}

/**
 * Sent when a player talks to an NPC — the NPC's lines plus, for
 * quest-givers, the ids of quests they offer (so the client can deep-link
 * to the board), and for vendors, their stock.
 */
export interface NpcInteractionView {
  id: string;
  name: string;
  title: string;
  role: NpcRole;
  dialogue: NpcDialogue[];
  questIds: string[];
  stock: VendorItem[];
}
