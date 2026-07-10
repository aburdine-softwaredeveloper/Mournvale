/**
 * loreCodex.ts — The journal text for every campaign lore key.
 *
 * Lore keys are the campaign's story flags (Player.lore, taught via
 * NPC.meetLore, dialogue loreKey outcomes, and Quest.grantsLore). The moment
 * of learning shows a one-off line in the log; this codex is the durable
 * version — what the character actually wrote down — rendered by the client's
 * Journal panel (journal command).
 *
 * Every key that can be taught anywhere MUST have an entry here (enforced by
 * loreGate.smoke.ts), or the journal would show a bare internal key.
 */

export interface LoreEntry {
  /** Short heading, written like a chapter note. */
  title: string;
  /** The note itself, in the character's voice. */
  text: string;
}

export const LORE_CODEX: Record<string, LoreEntry> = {
  wolves_at_gate: {
    title: "Wolves at the Gate",
    text: "Fog-wolves circle the north gate after dark. Captain Vey wants the pack thinned before it breaches the wall — the watch can't spare the blades.",
  },
  bell_silenced: {
    title: "The Silent Bell",
    text: "The chapel bell hasn't rung since the Greyfall came. Old Hollis swears something up in that tower is wrong — and he's not a man given to fancy.",
  },
  fogheart_path: {
    title: "The Heart of the Greyfall",
    text: "The fog has a middle, same as a storm has an eye. North, past the chapel, past where the road ought to end — that's where it sleeps. And breathes.",
  },
};

/** Journal entry for a lore key, with a safe fallback for unknown keys. */
export function loreEntryFor(key: string): LoreEntry {
  return (
    LORE_CODEX[key] ?? {
      title: key.replace(/_/g, " "),
      text: "You remember noting this down, but the details escape you.",
    }
  );
}
