/**
 * QuestManager.ts — Authoritative quest board + accepted-quest tracking
 *
 * Owns the list of available quests (authored + generated) and which
 * quests each player/party has accepted. Enforces the participation
 * rules: a "party" quest requires being in a party; "solo" requires not
 * being in one; "either" is always allowed.
 *
 * Architecture: Pure state + logic, like PartyManager. The caller does
 * socket sends. Quest acceptance is tracked per accepting unit — a solo
 * player by their id, a party by its party id — so party members share
 * one active quest.
 */

import type { Quest, ActiveQuest, QuestBoardView } from "../../types/quest";
import { AUTHORED_QUESTS, generateQuests } from "./questData";

/** How many random quests to keep on the board alongside authored ones */
const RANDOM_QUEST_COUNT = 2;

export class QuestManager {
  /** All quests currently on the board, keyed by id */
  private board = new Map<string, Quest>();

  /**
   * Active quests keyed by "owner" — either a solo player id or a party
   * id. Party members look up by their party id so they share a quest.
   */
  private activeByOwner = new Map<string, ActiveQuest>();

  constructor() {
    this.refreshBoard();
  }

  // ─────────────────────────────────────────────
  // BOARD
  // ─────────────────────────────────────────────

  /** Rebuilds the board: all authored quests + fresh random ones. */
  public refreshBoard(): void {
    this.board.clear();
    for (const q of AUTHORED_QUESTS) {
      this.board.set(q.id, q);
    }
    for (const q of generateQuests(RANDOM_QUEST_COUNT)) {
      this.board.set(q.id, q);
    }
  }

  /**
   * Builds the board view for a given owner key (solo player id or party
   * id). Shows all available quests and the owner's active quest, if any.
   */
  public buildView(ownerKey: string): QuestBoardView {
    return {
      available: [...this.board.values()],
      active: this.activeByOwner.get(ownerKey) ?? null,
    };
  }

  // ─────────────────────────────────────────────
  // ACCEPT / ABANDON
  // ─────────────────────────────────────────────

  /**
   * Accepts a quest for an owner.
   *
   * @param ownerKey   solo player id, or party id if in a party
   * @param questId    the quest to accept
   * @param inParty    whether the accepter is currently in a party
   * @param partyId    the party id (when inParty), else null
   * @returns error string, or null on success
   */
  public accept(
    ownerKey: string,
    questId: string,
    inParty: boolean,
    partyId: string | null
  ): string | null {
    if (this.activeByOwner.has(ownerKey)) {
      return "You already have an active quest. Abandon it first.";
    }

    const quest = this.board.get(questId);
    if (!quest) return "That quest is no longer on the board.";

    // Enforce participation rules
    if (quest.participation === "party" && !inParty) {
      return "This quest requires a party. Group up first.";
    }
    if (quest.participation === "solo" && inParty) {
      return "This is a solo quest — you can't take it while in a party.";
    }

    const active: ActiveQuest = {
      quest,
      partyId: inParty ? partyId : null,
      acceptedAt: Date.now(),
    };

    this.activeByOwner.set(ownerKey, active);

    // Remove from the board so it can't be double-taken
    this.board.delete(questId);

    return null;
  }

  /**
   * Abandons the owner's active quest, returning it to the board.
   * Returns an error if there's nothing to abandon.
   */
  public abandon(ownerKey: string): string | null {
    const active = this.activeByOwner.get(ownerKey);
    if (!active) return "You have no active quest to abandon.";

    this.activeByOwner.delete(ownerKey);
    // Return it to the board (authored quests reappear; generated ones too)
    this.board.set(active.quest.id, active.quest);

    return null;
  }

  /**
   * Returns the active quest for an owner key, or null.
   */
  public getActive(ownerKey: string): ActiveQuest | null {
    return this.activeByOwner.get(ownerKey) ?? null;
  }

  /**
   * Marks the owner's active field objective as met (e.g. they reached the
   * objective room and gathered/scouted/etc.). Returns true only on the
   * transition from not-met → met, so the caller can fire a one-time message.
   */
  public markObjectiveMet(ownerKey: string): boolean {
    const active = this.activeByOwner.get(ownerKey);
    if (!active || active.objectiveMet) return false;
    active.objectiveMet = true;
    return true;
  }

  /**
   * Completes the owner's active quest. Unlike abandon(), the quest is NOT
   * returned to the board — it's done. Returns the completed ActiveQuest (so
   * the caller can grant its reward), or null if the owner had no active quest.
   */
  public complete(ownerKey: string): ActiveQuest | null {
    const active = this.activeByOwner.get(ownerKey);
    if (!active) return null;
    this.activeByOwner.delete(ownerKey);
    return active;
  }

  /**
   * Migrates a solo player's active quest to a party owner key, used when
   * a player who holds a quest joins/forms a party. If both already have
   * quests, the solo one is dropped back to the board to avoid conflict.
   */
  public transferOwner(fromKey: string, toKey: string): void {
    const active = this.activeByOwner.get(fromKey);
    if (!active) return;

    if (this.activeByOwner.has(toKey)) {
      // Target already has a quest — return the solo one to the board
      this.activeByOwner.delete(fromKey);
      this.board.set(active.quest.id, active.quest);
      return;
    }

    this.activeByOwner.delete(fromKey);
    this.activeByOwner.set(toKey, { ...active });
  }
}
