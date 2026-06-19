/**
 * roomUtils.ts — Room-scoped broadcast and query utilities
 *
 * Fixes from original:
 *   - Object.values(players) → players.values() (players is a Map, not an object)
 *   - Removed `any` cast — socket is now properly typed via Player interface
 *   - broadcastToRoom now sends structured ServerMessage, not raw strings
 *
 * Architecture note: This module only handles the "who is in a room"
 * concern. Message formatting belongs in the caller.
 */

import { WebSocket } from "ws";
import { players, getActivePlayersInRoom } from "./gameState";
import type { ServerMessage } from "../types/network";

/**
 * Sends a structured ServerMessage to every active player in a room,
 * optionally excluding one player (e.g. the sender).
 */
export function broadcastToRoom(
  roomId: string,
  message: ServerMessage,
  excludePlayerId?: string
): void {
  const roomPlayers = getActivePlayersInRoom(roomId);

  for (const player of roomPlayers) {
    if (player.id === excludePlayerId) continue;

    if (player.socket.readyState === WebSocket.OPEN) {
      player.socket.send(JSON.stringify(message));
    }
  }
}

/**
 * Sends a structured ServerMessage to a single player by socket.
 * Checks readyState before sending to avoid errors on closed sockets.
 */
export function sendToPlayer(
  socket: WebSocket,
  message: ServerMessage
): void {
  if (socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(message));
  }
}
