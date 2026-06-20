/**
 * WorldManager.ts — Read-only access to static world content
 *
 * Owns the room map and NPC roster. Engine/handler code asks the
 * WorldManager "what room is this / who is here," keeping content
 * (rooms.ts, npcs.ts) separate from live session state (gameState.ts).
 *
 * Architecture: Pure lookups over static data. No mutation, no sockets.
 * Indexes NPCs by room once at construction for O(1) "who's here."
 */

import type { Room } from "../../types/game";
import type { NPC, NpcView, NpcInteractionView } from "../../types/npc";
import { ROOMS } from "./rooms";
import { NPCS } from "./npcs";

export class WorldManager {
  private readonly rooms: Record<string, Room>;
  private readonly npcsById = new Map<string, NPC>();
  private readonly npcsByRoom = new Map<string, NPC[]>();

  constructor(
    rooms: Record<string, Room> = ROOMS,
    npcs: NPC[] = NPCS
  ) {
    this.rooms = rooms;

    for (const npc of npcs) {
      this.npcsById.set(npc.id, npc);
      const list = this.npcsByRoom.get(npc.roomId) ?? [];
      list.push(npc);
      this.npcsByRoom.set(npc.roomId, list);
    }
  }

  // ── Rooms ──

  /** Returns the room with the given id, or undefined. */
  public getRoom(roomId: string): Room | undefined {
    return this.rooms[roomId];
  }

  /** Returns the full room map (read-only use). */
  public getRooms(): Record<string, Room> {
    return this.rooms;
  }

  /** True if a room id exists in the world. */
  public hasRoom(roomId: string): boolean {
    return roomId in this.rooms;
  }

  // ── NPCs ──

  /** Returns the NPC with the given id, or undefined. */
  public getNpc(npcId: string): NPC | undefined {
    return this.npcsById.get(npcId);
  }

  /** Returns the NPCs standing in a room (empty array if none). */
  public getNpcsInRoom(roomId: string): NPC[] {
    return this.npcsByRoom.get(roomId) ?? [];
  }

  /** Lightweight NPC summaries for a room's "Here" list. */
  public getNpcViewsInRoom(roomId: string): NpcView[] {
    return this.getNpcsInRoom(roomId).map((n) => ({
      id: n.id,
      name: n.name,
      title: n.title,
      role: n.role,
    }));
  }

  /**
   * Finds an NPC in a room by name (case-insensitive), for "talk to X".
   * Matches on first name so "talk aldric" works.
   */
  public findNpcInRoomByName(roomId: string, name: string): NPC | undefined {
    const target = name.trim().toLowerCase();
    return this.getNpcsInRoom(roomId).find(
      (n) => n.name.toLowerCase() === target
    );
  }

  /** Builds the full interaction view for talking to an NPC. */
  public buildInteractionView(npc: NPC): NpcInteractionView {
    return {
      id: npc.id,
      name: npc.name,
      title: npc.title,
      role: npc.role,
      dialogue: npc.dialogue,
      questIds: npc.questIds ?? [],
      stock: npc.stock ?? [],
    };
  }
}

/** Shared world instance. */
export const worldManager = new WorldManager();
