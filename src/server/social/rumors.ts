/**
 * rumors.ts — Town-wide knowledge that spreads NPC→NPC.
 *
 * disposition.ts is how ONE npc privately feels about you. This is the other
 * half of the social loop: things you do in front of one NPC become talk that
 * travels. Clear the cellar and the smith three rooms over has heard you're
 * reliable; lean on the guard and the merchant greets you cold before you've
 * said a word; get caught in a lie and word of it outruns you.
 *
 * Model (deliberately small and legible):
 *   - A Rumor is a fact ABOUT a player, born known to one origin NPC, carrying a
 *     reputation delta (how it colors anyone who's heard it).
 *   - Rumors spread one hop per "tick" (a tick = any player moves) along the NPC
 *     graph — two non-hostile NPCs are neighbours if they share a room or stand
 *     in rooms joined by an exit.
 *   - Rumors fade: after RUMOR_TTL_TICKS with no one new to tell, they're forgotten.
 *   - Effect is computed AT TALK TIME, never baked into stored disposition: a
 *     rumor transiently shifts how warmly an NPC who's heard it treats you, and
 *     feeds the LLM a "word's reached you" line. Direct dealings are what persist.
 *
 * The pure helpers (graph build, one propagation step, text/threshold math) are
 * unit-tested; RumorMill is the thin stateful singleton the server talks to.
 */

import type { NPC } from "../../types/npc";
import type { Room } from "../../types/game";
import { DISPOSITION_MIN, DISPOSITION_MAX } from "./disposition";
import { NPCS } from "../world/npcs";
import { ROOMS } from "../world/rooms";

// ─── Shapes ────────────────────────────────────────────────────────────────────

/** What kind of talk this is — drives the phrasing and the sign of the delta. */
export type RumorKind = "deed" | "charm" | "threat" | "lie";

export interface Rumor {
  id: string;
  /** Persistent identity of the player this rumor is about (Player.playerId). */
  subjectPlayerId: string;
  /** The player's display name, for phrasing the talk. */
  subjectName: string;
  kind: RumorKind;
  /** A neighbour-to-neighbour sentence an NPC who's heard it might repeat. */
  text: string;
  /** Reputation nudge (in disposition-score points) carried by anyone who knows it. */
  dispositionDelta: number;
  /** npcIds who currently know it. */
  knownBy: Set<string>;
  /** Tick at which it last reached someone new; drives fade. */
  lastSpreadTick: number;
}

/** NPC adjacency: npcId → set of neighbour npcIds it can gossip with. */
export type NpcGraph = Map<string, Set<string>>;

/** Ticks of stagnation (no new listener) after which a rumor is forgotten. */
export const RUMOR_TTL_TICKS = 40;

/** How far summed rumor reputation can swing a single conversation (±). */
export const RUMOR_INFLUENCE_CAP = 24;

// ─── Pure helpers ───────────────────────────────────────────────────────────────

/**
 * Build the gossip graph: non-hostile NPCs are neighbours when they share a room
 * or stand in rooms directly connected by an exit. Pure — derived entirely from
 * authored world data, so it's built once and reused.
 */
export function buildNpcGraph(npcs: NPC[], rooms: Record<string, Room>): NpcGraph {
  const folk = npcs.filter((n) => n.role !== "hostile");
  const byRoom = new Map<string, string[]>();
  for (const n of folk) {
    const list = byRoom.get(n.roomId) ?? [];
    list.push(n.id);
    byRoom.set(n.roomId, list);
  }

  const graph: NpcGraph = new Map(folk.map((n) => [n.id, new Set<string>()]));
  const link = (a: string, b: string) => {
    if (a === b) return;
    graph.get(a)?.add(b);
    graph.get(b)?.add(a);
  };

  for (const n of folk) {
    // Same-room neighbours.
    for (const other of byRoom.get(n.roomId) ?? []) link(n.id, other);
    // Adjacent-room neighbours (one exit away).
    const room = rooms[n.roomId];
    for (const destId of Object.values(room?.exits ?? {})) {
      if (!destId) continue;
      for (const other of byRoom.get(destId) ?? []) link(n.id, other);
    }
  }
  return graph;
}

/**
 * Advance every rumor one hop: each rumor's knowers tell their neighbours. Pure
 * over its inputs except that it grows the rumors' `knownBy` sets and stamps
 * `lastSpreadTick` when someone new learns. Returns the count of new learnings
 * (0 means the town has fully saturated or stalled), which the caller can use to
 * decide nothing more will happen.
 */
export function propagateOnce(rumors: Rumor[], graph: NpcGraph, tick: number): number {
  let learned = 0;
  for (const rumor of rumors) {
    const newcomers: string[] = [];
    for (const knower of rumor.knownBy) {
      for (const neighbour of graph.get(knower) ?? []) {
        if (!rumor.knownBy.has(neighbour)) newcomers.push(neighbour);
      }
    }
    if (newcomers.length) {
      for (const id of newcomers) rumor.knownBy.add(id);
      rumor.lastSpreadTick = tick;
      learned += newcomers.length;
    }
  }
  return learned;
}

const KIND_DELTA: Record<RumorKind, number> = {
  deed: 6,
  charm: 5,
  threat: -6,
  lie: -10,
};

/** The default reputation delta for a kind of talk. */
export function deltaForKind(kind: RumorKind): number {
  return KIND_DELTA[kind];
}

/** Phrase a rumor as something a neighbour would actually say about the player. */
export function rumorText(kind: RumorKind, subjectName: string, detail: string): string {
  switch (kind) {
    case "deed":
      return `Word is ${subjectName} ${detail}. Folk speak well of them.`;
    case "charm":
      return `${subjectName} has a honeyed tongue — ${detail}, they say.`;
    case "threat":
      return `Careful of ${subjectName}. ${detail}.`;
    case "lie":
      return `Don't trust a word from ${subjectName} — ${detail}.`;
  }
}

/**
 * The transient reputation a set of known rumors confers, clamped so a pile of
 * gossip can't dominate a relationship built (or broken) face to face.
 */
export function rumorInfluence(rumors: Rumor[]): number {
  const sum = rumors.reduce((acc, r) => acc + r.dispositionDelta, 0);
  return Math.max(-RUMOR_INFLUENCE_CAP, Math.min(RUMOR_INFLUENCE_CAP, sum));
}

/** Clamp a (direct + rumor) reputation into the valid disposition range. */
export function clampReputation(score: number): number {
  return Math.max(DISPOSITION_MIN, Math.min(DISPOSITION_MAX, score));
}

/**
 * The "what you've heard about this stranger" prompt block, or null when the NPC
 * has heard nothing. Up to three lines so the prompt stays lean.
 */
export function buildRumorContext(rumors: Rumor[]): string | null {
  if (rumors.length === 0) return null;
  const lines = rumors.slice(0, 3).map((r) => `- ${r.text}`);
  return [
    `WHAT YOU'VE HEARD AROUND TOWN ABOUT THEM (rumor, not first-hand — treat it as gossip you half-believe):`,
    ...lines,
  ].join("\n");
}

// ─── The stateful town gossip mill ───────────────────────────────────────────────

let rumorSeq = 0;

export class RumorMill {
  private rumors: Rumor[] = [];
  private graph: NpcGraph;
  private tick = 0;

  constructor(npcs: NPC[], rooms: Record<string, Room>) {
    this.graph = buildNpcGraph(npcs, rooms);
  }

  /**
   * Plant a fresh rumor, born known to `originNpcId`. De-duplicates: a second
   * rumor of the same kind about the same player from the same origin is dropped
   * (and refreshes the existing one's fade clock) so a player can't spam the town
   * with identical talk. Returns the rumor (new or refreshed), or null if origin
   * isn't a gossiping NPC.
   */
  record(params: {
    subjectPlayerId: string;
    subjectName: string;
    originNpcId: string;
    kind: RumorKind;
    detail: string;
    delta?: number;
  }): Rumor | null {
    if (!this.graph.has(params.originNpcId)) return null;

    const existing = this.rumors.find(
      (r) =>
        r.subjectPlayerId === params.subjectPlayerId &&
        r.kind === params.kind &&
        r.knownBy.has(params.originNpcId)
    );
    if (existing) {
      existing.lastSpreadTick = this.tick;
      return existing;
    }

    const rumor: Rumor = {
      id: `rumor-${++rumorSeq}`,
      subjectPlayerId: params.subjectPlayerId,
      subjectName: params.subjectName,
      kind: params.kind,
      text: rumorText(params.kind, params.subjectName, params.detail),
      dispositionDelta: params.delta ?? deltaForKind(params.kind),
      knownBy: new Set([params.originNpcId]),
      lastSpreadTick: this.tick,
    };
    this.rumors.push(rumor);
    return rumor;
  }

  /** One spread step + fade sweep. Call when any player moves. */
  propagate(): void {
    this.tick++;
    propagateOnce(this.rumors, this.graph, this.tick);
    this.rumors = this.rumors.filter((r) => this.tick - r.lastSpreadTick < RUMOR_TTL_TICKS);
  }

  /** Rumors a given NPC currently knows about a given player. */
  knownBy(npcId: string, subjectPlayerId: string): Rumor[] {
    return this.rumors.filter(
      (r) => r.subjectPlayerId === subjectPlayerId && r.knownBy.has(npcId)
    );
  }

  /** Test/inspection helper: every live rumor. */
  all(): readonly Rumor[] {
    return this.rumors;
  }
}

/**
 * The town's single gossip mill, built from the authored world. In-memory and
 * session-scoped (rumors reset on server restart) — there's no global-state
 * persistence layer, and reputation that fades between sessions is acceptable
 * for v1. The server records into it and queries it from the dialogue path.
 */
export const rumorMill = new RumorMill(NPCS, ROOMS);
