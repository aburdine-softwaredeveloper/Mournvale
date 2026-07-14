/**
 * saveTypes.ts — Shapes for persisted save data
 *
 * These types define exactly what gets written to disk. Keeping them
 * separate from the live `Player` type is deliberate: a save should
 * contain only serializable game state, never the live socket or
 * session-only fields.
 *
 * Versioning: `version` lets us migrate old saves if the shape changes.
 * Always bump SAVE_VERSION and handle migration when you change SaveData.
 */

import type { CharacterData } from "../../types/game";
import type { ProgressionState } from "../../types/progression";
import type { SocialMemory } from "../../types/social";
import type { Inventory } from "../../types/items";

/**
 * Current save format version. Bump when SaveData's shape changes.
 * v2 added `progression`; v3 added `social` (drifting NPC relationships);
 * v4 added `inventory` (gold, items, equipped gear); v5 added `lore`
 * (campaign knowledge learned from conversation, gates story quests).
 * Older saves are migrated on load (see SaveStore.load).
 */
export const SAVE_VERSION = 5;

/**
 * The full persisted state for a single character.
 * This is what lives in slot-{n}.json.
 */
export interface SaveData {
  version: number;
  /** The finalized character */
  character: CharacterData;
  /** Where the player was when they saved */
  roomId: string;
  /**
   * Persistent progression (XP, level, talents, ability loadout). Optional on
   * the type so v1 saves still parse; SaveStore.load backfills it from class
   * defaults when missing, so loaded data always carries it.
   */
  progression?: ProgressionState;
  /**
   * Per-character drifting relationships with NPCs (npcId → rapport score).
   * Optional on the type so v1/v2 saves still parse; SaveStore.load backfills an
   * empty memory when missing, so loaded data always carries one.
   */
  social?: SocialMemory;
  /**
   * The character's purse and pack (gold, items, equipped gear). Optional on the
   * type so older saves still parse; SaveStore.load backfills a fresh inventory
   * when missing, so loaded data always carries one.
   */
  inventory?: Inventory;
  /**
   * Campaign lore keys learned from conversation / quest completions — gates
   * which story quests appear on the board. Optional so older saves still
   * parse; SaveStore.load backfills an empty list when missing.
   */
  lore?: string[];
  /**
   * Current hit points at save time — wounds persist between sessions. Optional
   * and additive: a missing value simply means unhurt (full HP), so older saves
   * need no migration and no version bump.
   */
  hp?: number;
  /** Unix timestamp (ms) of when this save was written */
  savedAt: number;
}

/**
 * A lightweight summary of a slot, sent to the client for the
 * load-game menu. Does NOT include full save data — just enough
 * to render the slot list. Empty slots have `occupied: false`.
 */
export interface SaveSlotSummary {
  slot: number;
  occupied: boolean;
  /** Present only when occupied */
  characterName?: string;
  characterClass?: string;
  roomName?: string;
  savedAt?: number;
}

/** Number of save slots available per player */
export const MAX_SLOTS = 5;
