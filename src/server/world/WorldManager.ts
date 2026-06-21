/**
 * WorldManager.ts — Authoritative source for room and NPC data
 *
 * Room and NPC data live in sibling files:
 *   src/server/world/rooms.ts  → exports ROOMS: Record<string, Room>
 *   src/server/world/npcs.ts   → exports NPCS: NPC[]
 *
 * The Room type is defined in src/types/game.ts (shared with the rest
 * of the server). WorldManager imports it from there, not locally.
 *
 * Exports:
 *   worldManager — singleton with all lookup + interaction methods
 *
 * Called by gameState.ts:
 *   export const rooms = worldManager.getRooms();
 */

import { ROOMS } from "./rooms";
import { NPCS  } from "./npcs";
import type { Room } from "../../types/game";
import type { NPC, NpcView, NpcInteractionView, TalkIntent } from "../../types/npc";
import { TALK_INTENT_SKILL } from "../../types/npc";
import type { CharacterStats, Skill } from "../../types/character";
import { buildCharacterStats } from "../../types/character";
import { rollSkillCheck } from "../skills/SkillEngine";
import type { SkillCheckDisplay } from "../../types/network";

// ─── TalkResult ───────────────────────────────────────────────────────────────

export interface TalkResult {
  view: NpcInteractionView;
  checkDisplay?: SkillCheckDisplay;
  infoReveal?: string;
}

// ─── WorldManager ─────────────────────────────────────────────────────────────

class WorldManager {
  private readonly byId:   Map<string, NPC>;
  private readonly byRoom: Map<string, NPC[]>;

  constructor(npcs: NPC[]) {
    this.byId   = new Map(npcs.map(n => [n.id, n]));
    this.byRoom = new Map();
    for (const npc of npcs) {
      const list = this.byRoom.get(npc.roomId) ?? [];
      list.push(npc);
      this.byRoom.set(npc.roomId, list);
    }
  }

  // ── Room access ───────────────────────────────────────────────────────────

  /** Returns the full room map. Called by gameState.ts. */
  getRooms(): Record<string, Room> {
    return ROOMS;
  }

  // ── NPC lookups ───────────────────────────────────────────────────────────

  getNpcViewsInRoom(roomId: string): NpcView[] {
    return (this.byRoom.get(roomId) ?? []).map(n => ({
      id:    n.id,
      name:  n.name,
      title: n.title,
      role:  n.role,
    }));
  }

  findNpcInRoomByName(roomId: string, name: string): NPC | undefined {
    const lower = name.toLowerCase();
    return (this.byRoom.get(roomId) ?? []).find(
      n => n.name.toLowerCase().startsWith(lower)
    );
  }

  getNpcById(id: string): NPC | undefined {
    return this.byId.get(id);
  }

  getNpcsInRoom(roomId: string): NPC[] {
    return this.byRoom.get(roomId) ?? [];
  }

  getHostileNpcsInRoom(roomId: string): NPC[] {
    return this.getNpcsInRoom(roomId).filter(n => n.role === "hostile");
  }

  // ── Interaction views ─────────────────────────────────────────────────────

  buildInteractionView(npc: NPC): NpcInteractionView {
    return {
      id:       npc.id,
      name:     npc.name,
      title:    npc.title,
      role:     npc.role,
      dialogue: npc.dialogue,
      questIds: npc.questIds ?? [],
      stock:    npc.stock    ?? [],
    };
  }

  /**
   * Phase 2 — Resolve a skill-check talk interaction.
   *
   * If the NPC has a DialogueBranch matching the given intent, runs a d20
   * skill check and returns the outcome-specific NPC line plus a
   * SkillCheckDisplay for the client roll-reveal UI.
   *
   * Falls back to default dialogue (no check) when:
   *   - intent is undefined
   *   - the NPC has no dialogueBranches
   *   - the NPC has no branch for this intent
   */
  resolveTalk(
    characterClass: string,
    npc: NPC,
    intent: TalkIntent | undefined
  ): TalkResult {
    const baseView = this.buildInteractionView(npc);

    if (!intent || !npc.dialogueBranches?.length) {
      return { view: baseView };
    }

    const branch = npc.dialogueBranches.find(b => b.intent === intent);
    if (!branch) {
      const fallback: Record<TalkIntent, string> = {
        persuade:   "Your silver tongue doesn't seem to move them.",
        intimidate: "They don't seem threatened.",
        inquire:    "They shrug and look away.",
        deceive:    "They see right through you.",
      };
      return {
        view: { ...baseView, dialogue: [{ text: fallback[intent] }] },
      };
    }

    // ── Run the skill check ──────────────────────────────────────────────────
    const stats: CharacterStats = buildCharacterStats(
      characterClass as Parameters<typeof buildCharacterStats>[0],
      1
    );
    const skill       = TALK_INTENT_SKILL[intent] as Skill;
    const result      = rollSkillCheck(stats, skill, branch.dc);
    const outcome     = result.tier;
    const outcomeData = branch.outcomes[outcome];

    const checkDisplay: SkillCheckDisplay = {
      skill,
      intent,
      d20Result:     result.roll.result,
      modifier:      result.roll.modifier,
      total:         result.roll.total,
      dc:            branch.dc,
      outcome,
      wasProficient: result.wasProficient,
    };

    return {
      view: {
        ...baseView,
        dialogue: [{ text: outcomeData.npcLine }],
        questIds: [
          ...baseView.questIds,
          ...(outcomeData.questUnlock ? [outcomeData.questUnlock] : []),
        ],
      },
      checkDisplay,
      // Conditional spread avoids exactOptionalPropertyTypes violation
      ...(outcomeData.infoReveal !== undefined ? { infoReveal: outcomeData.infoReveal } : {}),
    };
  }
}

// ─── Singleton ────────────────────────────────────────────────────────────────

export const worldManager = new WorldManager(NPCS);
