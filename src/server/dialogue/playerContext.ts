/**
 * playerContext.ts — Per-conversation runtime knowledge about THIS visitor.
 *
 * The town codex (see world/townCodex.ts) is static — it never changes. This is
 * its dynamic counterpart: a small, in-character note built fresh for each reply
 * from the player's *live* state (the quest they've actually accepted, whether
 * they travel alone or with a party, how seasoned they are). Folded into the
 * NPC's prompt so an NPC can react to what the player is genuinely doing right
 * now — e.g. the barkeep who posted the cellar job can ask how it's going.
 *
 * Pure and string-producing, like buildNpcSystemPrompt: the caller (index.ts)
 * gathers the live state from the managers and hands it in, so this stays
 * testable with no server or socket.
 */

import type { NPC } from "../../types/npc";
import type { ActiveQuest } from "../../types/quest";

export interface PlayerSituation {
  /** The NPC the player is speaking to (to tailor "your task" vs gossip). */
  npc: NPC;
  /** The player's currently-accepted quest, or null. */
  activeQuest: ActiveQuest | null;
  /** Whether the player is traveling in a party. */
  inParty: boolean;
  /** The player's character level, if known (drives how seasoned they read). */
  level?: number;
}

/** A loose, in-character read on how seasoned the visitor looks. */
function standing(level: number | undefined, inParty: boolean): string {
  const company = inParty ? "traveling with companions" : "traveling alone";
  if (level === undefined) return `a wanderer, ${company}`;
  if (level <= 1) return `green and new to this work, ${company}`;
  if (level <= 4) return `a capable hand by the look of them, ${company}`;
  return `a seasoned veteran, ${company}`;
}

/** How this NPC knows of the player's active quest (gave it vs heard of it). */
function questNote(npc: NPC, active: ActiveQuest): string {
  const { title, description } = active.quest;
  const isGiver = (npc.questIds ?? []).includes(active.quest.id);

  if (isGiver) {
    return [
      `This visitor took up YOUR task, "${title}": ${description}`,
      `They have not yet reported it finished — you may ask how it goes, or press them if it suits you.`,
    ].join(" ");
  }

  // The board is "talked about around town", so a neighbour can plausibly have
  // heard — but only loosely, as rumor, never with details they couldn't know.
  return `Word around the village is this visitor has taken on "${title}" for ${active.quest.giver}. You may mention it if it fits, the way neighbours gossip — but you don't know the particulars.`;
}

/**
 * Builds the runtime "what you know of this visitor right now" block, or null
 * when there's nothing worth saying (so the prompt stays lean).
 */
export function buildPlayerContext(situation: PlayerSituation): string {
  const { npc, activeQuest, inParty, level } = situation;

  const lines: string[] = [
    `WHAT YOU NOTICE ABOUT THIS VISITOR RIGHT NOW:`,
    `- They seem ${standing(level, inParty)}.`,
  ];

  if (activeQuest) {
    lines.push(`- ${questNote(npc, activeQuest)}`);
  } else {
    lines.push(`- You've heard of no posted work they're carrying.`);
  }

  return lines.join("\n");
}
