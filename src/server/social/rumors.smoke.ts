/**
 * rumors.smoke.ts — Verifies town gossip: the NPC graph links neighbours,
 * rumors spread one hop per tick and eventually saturate, fade after their TTL,
 * the influence sum is capped, dedup refreshes rather than duplicates, and
 * RumorMill.knownBy answers correctly. Runs against the REAL world data so the
 * graph is meaningful.
 *
 * Run with: npx tsx src/server/social/rumors.smoke.ts
 */

import assert from "node:assert/strict";

import {
  buildNpcGraph,
  propagateOnce,
  rumorInfluence,
  deltaForKind,
  RumorMill,
  RUMOR_INFLUENCE_CAP,
  RUMOR_TTL_TICKS,
  type Rumor,
} from "./rumors";
import { NPCS } from "../world/npcs";
import { ROOMS } from "../world/rooms";

let passed = 0;
function check(label: string, fn: () => void): void {
  fn();
  passed++;
  console.log(`  ok — ${label}`);
}

const townNpcIds = NPCS.filter((n) => n.role !== "hostile").map((n) => n.id);

check("graph links non-hostile NPCs and excludes hostiles", () => {
  const graph = buildNpcGraph(NPCS, ROOMS);
  for (const id of townNpcIds) assert.ok(graph.has(id), `${id} in graph`);
  for (const n of NPCS.filter((x) => x.role === "hostile")) {
    assert.ok(!graph.has(n.id), `hostile ${n.id} excluded`);
  }
  // Edges are symmetric.
  for (const [a, neighbours] of graph) {
    for (const b of neighbours) assert.ok(graph.get(b)?.has(a), `edge ${a}↔${b} symmetric`);
  }
});

check("a rumor spreads one hop per tick and reaches beyond its origin", () => {
  const graph = buildNpcGraph(NPCS, ROOMS);
  // Pick an origin that actually has neighbours.
  const origin = townNpcIds.find((id) => (graph.get(id)?.size ?? 0) > 0)!;
  const rumor: Rumor = {
    id: "r1", subjectPlayerId: "p1", subjectName: "Ash", kind: "deed",
    text: "…", dispositionDelta: 6, knownBy: new Set([origin]), lastSpreadTick: 0,
  };

  const before = rumor.knownBy.size;
  const learned = propagateOnce([rumor], graph, 1);
  assert.ok(learned > 0, "someone new heard it");
  assert.ok(rumor.knownBy.size > before, "knownBy grew");

  // Run it to saturation; it should stop producing new learners.
  let guard = 0;
  while (propagateOnce([rumor], graph, ++guard + 1) > 0 && guard < 100) { /* spread */ }
  assert.ok(guard < 100, "propagation terminates (no infinite spread)");
  assert.ok(rumor.knownBy.size > 1, "spread past the origin");
});

check("influence is the delta sum, clamped", () => {
  const mk = (delta: number): Rumor => ({
    id: "x", subjectPlayerId: "p", subjectName: "n", kind: "threat",
    text: "", dispositionDelta: delta, knownBy: new Set(), lastSpreadTick: 0,
  });
  assert.equal(rumorInfluence([mk(-6), mk(-10)]), -16);
  assert.ok(rumorInfluence([mk(-50), mk(-50)]) === -RUMOR_INFLUENCE_CAP, "clamped low");
  assert.ok(rumorInfluence([mk(50), mk(50)]) === RUMOR_INFLUENCE_CAP, "clamped high");
  assert.equal(deltaForKind("lie"), -10);
  assert.ok(deltaForKind("deed") > 0 && deltaForKind("charm") > 0);
});

check("RumorMill records, propagates, answers knownBy, and dedups", () => {
  const mill = new RumorMill(NPCS, ROOMS);
  const graph = buildNpcGraph(NPCS, ROOMS);
  const origin = townNpcIds.find((id) => (graph.get(id)?.size ?? 0) > 0)!;

  const r = mill.record({ subjectPlayerId: "p1", subjectName: "Ash", originNpcId: origin, kind: "threat", detail: "they leaned on the watch" });
  assert.ok(r, "rumor recorded");
  assert.deepEqual(mill.knownBy(origin, "p1").map((x) => x.id), [r!.id], "origin knows it immediately");

  // Dedup: same kind, same subject, same origin → no second rumor.
  const dup = mill.record({ subjectPlayerId: "p1", subjectName: "Ash", originNpcId: origin, kind: "threat", detail: "again" });
  assert.equal(dup!.id, r!.id, "dedup refreshes the existing rumor");
  assert.equal(mill.all().length, 1, "no duplicate created");

  // Recording from a hostile / unknown origin is rejected.
  const bad = mill.record({ subjectPlayerId: "p1", subjectName: "Ash", originNpcId: "no-such-npc", kind: "deed", detail: "x" });
  assert.equal(bad, null, "unknown origin rejected");

  // A neighbour learns it after a propagate tick.
  mill.propagate();
  const neighbour = [...(graph.get(origin) ?? [])][0]!;
  assert.ok(mill.knownBy(neighbour, "p1").length === 1, "neighbour heard it after a tick");
});

check("rumors fade after their TTL of stagnation", () => {
  // A lone origin with no neighbours never spreads, so it goes stagnant and is swept.
  const isolatedRooms = { lonely: { id: "lonely", name: "Lonely", description: "x", exits: {} } };
  const isolatedNpcs = [{ id: "hermit", name: "Hermit", title: "h", role: "dialogue" as const, roomId: "lonely", dialogue: [] }];
  const mill = new RumorMill(isolatedNpcs, isolatedRooms);
  mill.record({ subjectPlayerId: "p", subjectName: "n", originNpcId: "hermit", kind: "deed", detail: "did a thing" });
  assert.equal(mill.all().length, 1);
  for (let i = 0; i < RUMOR_TTL_TICKS; i++) mill.propagate();
  assert.equal(mill.all().length, 0, "stagnant rumor forgotten after TTL");
});

console.log(`\nrumors.smoke: ${passed} checks passed.`);
