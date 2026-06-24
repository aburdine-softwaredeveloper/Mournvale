/**
 * migration.smoke.ts — Verifies the v1 → v2 save migration backfills
 * progression on load. No framework; run with:
 *   npx tsx src/server/persistence/migration.smoke.ts
 */

import assert from "node:assert/strict";
import { promises as fs } from "fs";
import * as os from "os";
import * as path from "path";

import { JsonFileSaveStore, buildSaveData } from "./SaveStore";
import { SAVE_VERSION } from "./saveTypes";
import { baselineAbilityIds } from "../../types/character";

async function main(): Promise<void> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "mournvale-save-"));
  const store = new JsonFileSaveStore(dir);
  const playerId = "test-player-0001";

  // ── Write a legacy v1 save by hand (no `progression` field) ──
  const v1 = {
    version: 1,
    character: {
      name: "Old Hero", gender: "Male",
      characterClass: "Mage", hairColor: "#333", glasses: false,
    },
    roomId: "tavern",
    savedAt: Date.now(),
  };
  await fs.mkdir(path.join(dir, playerId), { recursive: true });
  await fs.writeFile(path.join(dir, playerId, "slot-1.json"), JSON.stringify(v1), "utf-8");

  const loaded = await store.load(playerId, 1);
  assert.ok(loaded, "v1 save should load");
  assert.equal(loaded!.version, SAVE_VERSION, "version bumped on migration");
  assert.ok(loaded!.progression, "progression backfilled");
  assert.equal(loaded!.progression!.level, 1, "migrated to level 1");
  assert.deepEqual(
    loaded!.progression!.equippedAbilityIds.slice(0, 2),
    baselineAbilityIds("Mage"),
    "baseline Mage abilities seeded"
  );
  console.log("  ok — v1 save migrates and backfills progression");

  // ── Round-trip a v2 save with progression ──
  const prog = loaded!.progression!;
  prog.xp = 1234;
  await store.save(playerId, 2, buildSaveData(loaded!.character, "tavern", prog));
  const reloaded = await store.load(playerId, 2);
  assert.equal(reloaded!.progression!.xp, 1234, "progression persists across save/load");
  assert.equal(reloaded!.version, SAVE_VERSION);
  console.log("  ok — v2 save round-trips progression");

  await fs.rm(dir, { recursive: true, force: true });
  console.log("\n✓ migration smoke: 2 checks passed");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
