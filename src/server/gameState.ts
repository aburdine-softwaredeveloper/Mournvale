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
import type { Player, Room } from "../types/game";

// ─────────────────────────────────────────────
// WORLD DATA
// ─────────────────────────────────────────────

/**
 * The room registry — all rooms in the game world.
 * Will be moved to /world/ once the world system is built out.
 * Kept here temporarily for bootstrapping.
 */
export const rooms: Record<string, Room> = {
  tavern: {
    id: "tavern",
    name: "The Broken Lantern",
    description:
      "A dimly lit tavern filled with the smell of ale and wet wood. " +
      "Candles flicker on rough-hewn tables. Behind the bar, the keeper " +
      "eyes you with a weathered curiosity.",
    exits: {
      north: "street",
    },
  },

  street: {
    id: "street",
    name: "Cobblestone Street",
    description:
      "A narrow street outside the tavern. Iron lanterns flicker in the fog. " +
      "The cobblestones glisten with recent rain.",
    exits: {
      south: "tavern",
    },
  },
};

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
 * Look up a player by their UUID.
 * Used when you only have a player ID (e.g. in command handlers).
 */
export function getPlayerById(playerId: string): Player | undefined {
  for (const player of players.values()) {
    if (player.id === playerId) return player;
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
