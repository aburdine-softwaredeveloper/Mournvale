/**
 * social.ts — Persisted shape for drifting NPC relationships.
 *
 * Kept here (the pure types layer) so both the save format (saveTypes.ts) and
 * the live Player (game.ts) can reference it without depending on server code.
 * The behavior — how relationships shift, what a score means in tone and DC —
 * lives in server/social/disposition.ts, which imports this type.
 */

export interface SocialMemory {
  /** npcId → rapport score in [-100, +100]. Absent key = 0 (strangers). */
  disposition: Record<string, number>;
}
