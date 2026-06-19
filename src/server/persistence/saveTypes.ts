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

/** Current save format version. Bump when SaveData's shape changes. */
export const SAVE_VERSION = 1;

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
