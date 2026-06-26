/**
 * SaveStore.ts — Persistence layer for character saves
 *
 * Architecture: `SaveStore` is an interface so the storage backend can
 * be swapped (JSON files now → a database later) without touching any
 * caller. The JSON implementation writes to:
 *
 *   {baseDir}/{playerId}/slot-{n}.json
 *
 * Saves are scoped by playerId (a persistent ID the client generates
 * and stores in localStorage), so each player/browser gets its own
 * private set of MAX_SLOTS slots.
 *
 * All methods are async to keep the interface DB-ready — a SQL or
 * key-value backend would implement the same signatures.
 */

import { promises as fs } from "fs";
import * as path from "path";
import { rooms } from "../gameState";
import {
  SAVE_VERSION,
  MAX_SLOTS,
  type SaveData,
  type SaveSlotSummary,
} from "./saveTypes";
import type { CharacterClass } from "../../types/network";
import { newProgression } from "../../types/progression";
import { newSocialMemory } from "../social/disposition";

// ─────────────────────────────────────────────
// INTERFACE
// ─────────────────────────────────────────────

export interface SaveStore {
  /** Returns summaries for all MAX_SLOTS slots (occupied or not) */
  listSlots(playerId: string): Promise<SaveSlotSummary[]>;

  /** Loads full save data for one slot, or null if empty/invalid */
  load(playerId: string, slot: number): Promise<SaveData | null>;

  /** Writes save data to a slot, overwriting any existing save */
  save(playerId: string, slot: number, data: SaveData): Promise<void>;

  /** Deletes a slot's save, if present */
  delete(playerId: string, slot: number): Promise<void>;
}

// ─────────────────────────────────────────────
// JSON FILE IMPLEMENTATION
// ─────────────────────────────────────────────

export class JsonFileSaveStore implements SaveStore {
  private readonly baseDir: string;

  /**
   * @param baseDir root directory for all saves (default ./saves)
   */
  constructor(baseDir: string = path.resolve(process.cwd(), "saves")) {
    this.baseDir = baseDir;
  }

  // ── Path helpers ──

  /**
   * Sanitizes a playerId so it can't escape the saves directory.
   * Only allows characters safe for a folder name; anything else is
   * stripped. This prevents path-traversal via a malicious playerId.
   */
  private safePlayerDir(playerId: string): string {
    const safe = playerId.replace(/[^a-zA-Z0-9_-]/g, "");
    if (safe.length === 0) {
      throw new Error("Invalid playerId — no safe characters.");
    }
    return path.join(this.baseDir, safe);
  }

  private slotPath(playerId: string, slot: number): string {
    if (!Number.isInteger(slot) || slot < 1 || slot > MAX_SLOTS) {
      throw new Error(`Invalid slot: ${slot} (must be 1–${MAX_SLOTS})`);
    }
    return path.join(this.safePlayerDir(playerId), `slot-${slot}.json`);
  }

  // ── Interface methods ──

  public async listSlots(playerId: string): Promise<SaveSlotSummary[]> {
    const summaries: SaveSlotSummary[] = [];

    for (let slot = 1; slot <= MAX_SLOTS; slot++) {
      const data = await this.load(playerId, slot);

      if (!data) {
        summaries.push({ slot, occupied: false });
        continue;
      }

      const roomName = rooms[data.roomId]?.name ?? "Unknown";

      summaries.push({
        slot,
        occupied: true,
        characterName: data.character.name,
        characterClass: data.character.characterClass,
        roomName,
        savedAt: data.savedAt,
      });
    }

    return summaries;
  }

  public async load(playerId: string, slot: number): Promise<SaveData | null> {
    const file = this.slotPath(playerId, slot);

    let raw: string;
    try {
      raw = await fs.readFile(file, "utf-8");
    } catch {
      // File doesn't exist → empty slot
      return null;
    }

    try {
      const parsed = JSON.parse(raw) as SaveData;

      // Basic shape validation — guard against corrupt/old saves
      if (
        typeof parsed.version !== "number" ||
        !parsed.character ||
        typeof parsed.roomId !== "string"
      ) {
        console.warn(`[save] Slot ${slot} for ${playerId} is malformed.`);
        return null;
      }

      // Migration: v1 saves predate progression. Backfill a fresh level-1
      // progression seeded from the character's class so loaded data always
      // carries one. (A future deeper migration would go here too.)
      if (!parsed.progression) {
        parsed.progression = newProgression(
          parsed.character.characterClass as CharacterClass
        );
      }
      // Migration: v2 saves predate `social`. Backfill an empty relationship
      // memory so loaded data always carries one (a stranger to everyone).
      if (!parsed.social) {
        parsed.social = newSocialMemory();
      }
      parsed.version = SAVE_VERSION;

      return parsed;
    } catch {
      console.warn(`[save] Slot ${slot} for ${playerId} is not valid JSON.`);
      return null;
    }
  }

  public async save(
    playerId: string,
    slot: number,
    data: SaveData
  ): Promise<void> {
    const file = this.slotPath(playerId, slot);
    const dir = path.dirname(file);

    // Ensure the player's save directory exists
    await fs.mkdir(dir, { recursive: true });

    // Write atomically-ish: write to temp then rename, so a crash
    // mid-write can't corrupt an existing good save.
    const tmp = `${file}.tmp`;
    const payload = JSON.stringify(data, null, 2);

    await fs.writeFile(tmp, payload, "utf-8");
    await fs.rename(tmp, file);
  }

  public async delete(playerId: string, slot: number): Promise<void> {
    const file = this.slotPath(playerId, slot);
    try {
      await fs.unlink(file);
    } catch {
      // Already gone — nothing to do
    }
  }
}

// ─────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────

/**
 * Builds a SaveData object from the pieces the server holds.
 * Centralizes the SAVE_VERSION + timestamp so callers don't forget them.
 */
export function buildSaveData(
  character: SaveData["character"],
  roomId: string,
  progression?: SaveData["progression"],
  social?: SaveData["social"]
): SaveData {
  return {
    version: SAVE_VERSION,
    character,
    roomId,
    ...(progression && { progression }),
    ...(social && { social }),
    savedAt: Date.now(),
  };
}
