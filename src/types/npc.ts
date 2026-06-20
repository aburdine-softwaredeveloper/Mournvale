/**
 * npc.ts — Types for the NPC system
 *
 * All NPCs share a BaseNPC shape and are distinguished by `role`. This
 * keeps placement, listing, and interaction uniform while allowing
 * role-specific behavior (vendors have stock, quest-givers have quests).
 *
 * NPCs are static world data placed by roomId. The WorldManager answers
 * "which NPCs are in room X." Clients receive a lightweight NpcView for
 * the room's "Here" list.
 */

/** What kind of NPC this is — drives interaction options. */
export type NpcRole =
  | "dialogue"   // just talks
  | "vendor"     // sells goods
  | "questgiver" // offers quests
  | "friendly"   // ambient friendly townsfolk
  | "hostile";   // hostile presence (combat hook for later)

/** A line (or branching set) the NPC can say when talked to. */
export interface NpcDialogue {
  /** What the NPC says */
  text: string;
}

/** A single item a vendor sells. Combat/economy come later; this is data-ready. */
export interface VendorItem {
  id: string;
  name: string;
  price: number;
  description: string;
}

/**
 * The full NPC definition — static world data.
 *
 * Role-specific fields are optional and only meaningful for that role:
 *   - questIds  → questgiver
 *   - stock     → vendor
 * Keeping them optional on one interface (rather than a union) makes
 * placement and listing code simpler; the role tells you what to read.
 */
export interface NPC {
  id: string;
  name: string;
  /** Short title shown under the name, e.g. "Barkeep", "Blacksmith" */
  title: string;
  role: NpcRole;
  /** Which room this NPC stands in */
  roomId: string;
  /** Lines shown when the player talks to them */
  dialogue: NpcDialogue[];
  /** Quest ids this NPC offers (questgiver role) */
  questIds?: string[];
  /** Goods for sale (vendor role) */
  stock?: VendorItem[];
}

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
