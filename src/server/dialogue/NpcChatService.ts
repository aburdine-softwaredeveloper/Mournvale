/**
 * NpcChatService.ts — Orchestrates free-text NPC conversation.
 *
 * Holds the ordered list of backends (e.g. [OllamaBrain, ScriptedBrain]), picks
 * the first available one per reply, and keeps a short per-(player, npc) history
 * so a conversation feels continuous. The *last* brain in the list must always
 * be available (ScriptedBrain) — it's the guaranteed floor, used both when no
 * LLM is reachable and when a reachable backend throws mid-reply.
 *
 * The d20 roll itself happens in the caller (server-authoritative); this service
 * only turns a (tier + message + persona) into spoken words.
 */

import type { NpcBrain, NpcReplyContext, ChatTurn } from "./NpcBrain";

/** Turns of history kept per conversation (3 exchanges). */
const HISTORY_LIMIT = 6;

export interface NpcChatResult {
  reply: string;
  /** Which backend produced the reply ("ollama" / "scripted"). */
  brain: string;
}

export class NpcChatService {
  private readonly brains: NpcBrain[];
  private readonly fallback: NpcBrain;
  private readonly history = new Map<string, ChatTurn[]>();

  /** @param brains preference order; the last entry must always be available. */
  constructor(brains: NpcBrain[]) {
    if (brains.length === 0) throw new Error("NpcChatService needs at least one brain");
    this.brains = brains;
    this.fallback = brains[brains.length - 1]!;
  }

  private key(playerId: string, npcId: string): string {
    return `${playerId}:${npcId}`;
  }

  /** First backend reporting available, else the guaranteed fallback. */
  private async pickBrain(): Promise<NpcBrain> {
    for (const brain of this.brains) {
      if (await brain.isAvailable()) return brain;
    }
    return this.fallback;
  }

  /**
   * Produce an in-character reply and record it in the conversation history.
   * A throwing backend (e.g. Ollama dies mid-request) silently degrades to the
   * scripted fallback so the player always gets a line.
   */
  async respond(
    playerId: string,
    ctx: Omit<NpcReplyContext, "history">
  ): Promise<NpcChatResult> {
    const key = this.key(playerId, ctx.npc.id);
    const history = this.history.get(key) ?? [];

    const chosen = await this.pickBrain();
    let reply: string;
    let brainName = chosen.name;
    try {
      reply = await chosen.generateReply({ ...ctx, history });
    } catch (err) {
      console.warn(`[npc-brain] ${chosen.name} failed; falling back to scripted:`, err);
      reply = await this.fallback.generateReply({ ...ctx, history });
      brainName = this.fallback.name;
    }

    const next: ChatTurn[] = [
      ...history,
      { role: "user" as const, content: ctx.message },
      { role: "assistant" as const, content: reply },
    ].slice(-HISTORY_LIMIT);
    this.history.set(key, next);

    return { reply, brain: brainName };
  }

  /** Drops a player's conversation history (call on disconnect). */
  clearHistory(playerId: string): void {
    const prefix = `${playerId}:`;
    for (const key of this.history.keys()) {
      if (key.startsWith(prefix)) this.history.delete(key);
    }
  }
}
