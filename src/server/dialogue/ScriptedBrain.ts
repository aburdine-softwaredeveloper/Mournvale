/**
 * ScriptedBrain.ts — Always-available, zero-dependency fallback backend.
 *
 * Renders an NPC reply without any LLM, using the authored content already in
 * npcs.ts: if the NPC has a dialogueBranch for the inferred intent, it returns
 * that branch's line for the rolled tier; otherwise it falls back to the NPC's
 * default lines (on a good roll) or a terse, tier-appropriate brush-off (on a
 * poor one). This is the floor the game always degrades to — it needs no
 * network, no model, and no configuration.
 */

import type { NpcBrain, NpcReplyContext } from "./NpcBrain";
import type { DialogueOutcome } from "../../types/npc";

export class ScriptedBrain implements NpcBrain {
  readonly name = "scripted";

  async isAvailable(): Promise<boolean> {
    return true;
  }

  async generateReply(ctx: NpcReplyContext): Promise<string> {
    // Best case: the NPC has authored outcomes for this exact approach.
    const branch = ctx.npc.dialogueBranches?.find((b) => b.intent === ctx.intent);
    if (branch) return branch.outcomes[ctx.tier].npcLine;

    return genericLine(ctx);
  }
}

/** A tier-flavored fallback when no authored branch matches the approach. */
function genericLine(ctx: NpcReplyContext): string {
  const succeeded: DialogueOutcome[] = ["success", "crit_success"];
  if (succeeded.includes(ctx.tier)) {
    // Lean on the NPC's own voice for a warm/neutral reply.
    const lines = ctx.npc.dialogue;
    const pick = lines[Math.floor(Math.random() * lines.length)]?.text;
    if (pick) return pick;
  }

  const brushOffs: Record<DialogueOutcome, string> = {
    crit_success: `${ctx.npc.name} brightens. "Aye — ask me what you like."`,
    success: `${ctx.npc.name} gives a measured nod. "I'll tell you what I can."`,
    fail: `${ctx.npc.name} looks away. "Haven't much to say on that."`,
    crit_fail: `${ctx.npc.name} frowns. "I think we're done talking."`,
  };
  return brushOffs[ctx.tier];
}
