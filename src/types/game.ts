/**
 * game.ts — Core game entity types for Mournvale
 *
 * This is the single source of truth for all game entity shapes.
 * Previously Player was duplicated in types.ts and gameState.ts — that
 * duplication is eliminated here.
 *
 * Architecture note: PlayerState lives in network.ts because it is
 * part of the client/server communication contract. We import it here
 * to keep Player self-contained.
 */

import { WebSocket } from "ws";
import type { PlayerState, CharacterDraft, CharacterClass, Gender } from "./network";

// ─────────────────────────────────────────────
// PLAYER
// ─────────────────────────────────────────────

/**
 * The fully-created character data attached to a Player once
 * character creation is complete.
 */
export interface CharacterData {
  name: string;
  gender: Gender;
  characterClass: CharacterClass;
  hairStyle: string;
  hairColor: string;
  glasses: boolean;
}

/**
 * Player — the authoritative server-side representation of a connected player.
 *
 * `state` controls what the player can and cannot do:
 *   - pending          → connected, intro playing, no room assigned
 *   - character_creation → tavern keeper dialogue in progress
 *   - active           → full game access, assigned to a room
 *
 * `character` is undefined until creation is complete.
 * `draft` accumulates answers during creation, then is promoted to `character`.
 */
export interface Player {
  id: string;
  socket: WebSocket;
  state: PlayerState;

  /**
   * Persistent player identity, supplied by the client on connect via
   * the `identify` message. Used to scope save slots. Distinct from
   * `id`, which is a fresh per-session/per-socket identity. Two tabs
   * from the same browser share a playerId but have different ids.
   *
   * Undefined only in the brief window between connect and identify.
   */
  playerId?: string;

  /**
   * The save slot (1–5) this session is bound to. Set when the player
   * picks "New Game" or "Load Game" in a slot. Auto-save on disconnect
   * writes here. Undefined until a slot is chosen.
   */
  activeSlot?: number;

  /** Temporary display name used before character name is set */
  tempName: string;

  /** Accumulated character creation answers */
  draft: CharacterDraft;

  /**
   * Finalized character data — only present when state === "active"
   * Use optional chaining when accessing outside of active-state guards.
   */
  character?: CharacterData;

  /**
   * Room the player is currently in.
   * Only meaningful when state === "active".
   */
  roomId?: string;
}

// ─────────────────────────────────────────────
// ROOM
// ─────────────────────────────────────────────

export type Direction = "north" | "south" | "east" | "west";

/**
 * Room — a single location in the game world.
 *
 * `exits` maps direction strings to room IDs.
 * Keeping exits as Record<string, string> (not Direction) allows
 * future expansion without breaking existing room definitions.
 */
export interface Room {
  id: string;
  name: string;
  description: string;
  exits: Partial<Record<Direction, string>>;
  /**
   * Optional art asset key for the room scene. Maps to tiles/{artKey}.svg
   * via the AssetRegistry. Rooms without art show a placeholder.
   */
  artKey?: string;
}
