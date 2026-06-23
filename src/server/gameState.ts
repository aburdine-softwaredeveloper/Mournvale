/**
 * gameState.ts — Authoritative server-side game state
 *
 * This module owns all mutable game state. No other module should
 * mutate players or rooms directly — go through the helper functions
 * exported here.
 *
 * Architecture note: `players` is keyed by WebSocket (not player ID)
 * because WebSocket is the natural lookup key on message receipt.
 * Use `getPlayerById` when you only have an ID.
 */

import { WebSocket } from "ws";
import type { Player } from "../types/game";
import { worldManager } from "./world/WorldManager";

// ─────────────────────────────────────────────
// WORLD DATA
// ─────────────────────────────────────────────

/**
 * The room registry. World content now lives in src/server/world/rooms.ts
 * and is owned by the WorldManager; this re-export preserves the existing
 * `rooms[roomId]` access pattern used across command handlers and index.ts.
 */
export const rooms = worldManager.getRooms();

// ─────────────────────────────────────────────
// PLAYER REGISTRY
// ─────────────────────────────────────────────

/**
 * The authoritative player map.
 * Keyed by WebSocket instance for O(1) lookup on message receipt.
 */
export const players = new Map<WebSocket, Player>();

// ─────────────────────────────────────────────
// PLAYER HELPERS
// ─────────────────────────────────────────────

/**
 * Look up a player by their per-session UUID (`Player.id`).
 * Used when you only have a session id (e.g. in command handlers).
 */
export function getPlayerById(playerId: string): Player | undefined {
  for (const player of players.values()) {
    if (player.id === playerId) return player;
  }
  return undefined;
}

/**
 * Look up a player by their persistent identity (`Player.playerId`, supplied
 * via the identify message and used to key sockets and combat entities).
 * Returns the first match — two tabs sharing a playerId is an edge case the
 * combat/save flow does not support concurrently.
 */
export function getPlayerByPlayerId(playerId: string): Player | undefined {
  for (const player of players.values()) {
    if (player.playerId === playerId) return player;
  }
  return undefined;
}

/**
 * Returns all players currently in a given room.
 * Only returns players in "active" state — pending and creating
 * players are invisible to the game world.
 */
export function getActivePlayersInRoom(roomId: string): Player[] {
  const result: Player[] = [];
  for (const player of players.values()) {
    if (player.state === "active" && player.roomId === roomId) {
      result.push(player);
    }
  }
  return result;
}

/**
 * Returns the display name for a player.
 * Active players use their character name; others use tempName.
 */
export function getDisplayName(player: Player): string {
  return player.character?.name ?? player.tempName;
}
