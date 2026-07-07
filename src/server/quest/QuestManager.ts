/**
 * QuestManager.ts — Authoritative quest board + accepted-quest tracking
 *
 * Owns the list of available quests (authored + generated) and which
 * quests each player/party has accepted. Enforces the participation
 * rules: a "party" quest requires being in a party; "solo" requires not
 * being in one; "either" is always allowed.
 *
 * Availability model:
 *   • AUTHORED quests are PER-OWNER. Every player (or party) sees the full
 *     authored campaign minus what THEY have active or already completed.
 *     One player taking or finishing "Cellar Vermin" never removes it from
 *     anyone else's board — this is what keeps the game fully playable for
 *     a new character on a long-running server.
 *   • GENERATED quests are shared odd jobs: first-come first-served while
 *     active, and replaced with a fresh one when completed, so the board
 *     never drains.
 *
 * Architecture: Pure state + logic, like PartyManager. The caller does
 * socket sends. Quest acceptance is tracked per accepting unit — a solo
 * player by their id, a party by its party id — so party members share
 * one active quest.
 */

import type { Quest, ActiveQuest, QuestBoardView } from "../../types/quest";
import { AUTHORED_QUESTS, generateQuests, generateQuest } from "./questData";

/** How many random quests to keep on the board alongside authored ones */
const RANDOM_QUEST_COUNT = 2;

export class QuestManager {
  /** Generated (shared, claimable) quests currently on the board, keyed by id. */
  private generatedBoard = new Map<string, Quest>();

  /**
   * Active quests keyed by "owner" — either a solo player id or a party
   * id. Party members look up by their party id so they share a quest.
   */
  private activeByOwner = new Map<string, ActiveQuest>();

  /** Authored quest ids each owner has finished (per-owner replay protection). */
  private completedByOwner = new Map<string, Set<string>>();

  constructor() {
    this.refreshBoard();
  }

  // ─────────────────────────────────────────────
  // BOARD
  // ─────────────────────────────────────────────

  /** Rebuilds the generated jobs (authored quests are constant, per-owner). */
  public refreshBoard(): void {
    this.generatedBoard.clear();
    for (const q of generateQuests(RANDOM_QUEST_COUNT)) {
      this.generatedBoard.set(q.id, q);
    }
  }

  /**
   * Builds the board view for a given owner key (solo player id or party
   * id): every authored quest this owner hasn't done or taken, the shared
   * generated jobs, and the owner's active quest, if any.
   */
  public buildView(ownerKey: string): QuestBoardView {
    const done = this.completedByOwner.get(ownerKey);
    const activeId = this.activeByOwner.get(ownerKey)?.quest.id;
    const authored = AUTHORED_QUESTS.filter(
      (q) => q.id !== activeId && !done?.has(q.id)
    );
    return {
      available: [...authored, ...this.generatedBoard.values()],
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

    const authored = AUTHORED_QUESTS.find((q) => q.id === questId);
    let quest: Quest | undefined;
    if (authored) {
      if (this.completedByOwner.get(ownerKey)?.has(questId)) {
        return "You've already seen that job through.";
      }
      quest = authored;
    } else {
      quest = this.generatedBoard.get(questId);
    }
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

    // Generated jobs are first-come first-served; authored quests stay
    // available to every OTHER owner (buildView hides this owner's active one).
    this.generatedBoard.delete(questId);

    return null;
  }

  /**
   * Abandons the owner's active quest. Generated jobs return to the shared
   * board; authored quests simply reappear on the owner's next board view.
   * Returns an error if there's nothing to abandon.
   */
  public abandon(ownerKey: string): string | null {
    const active = this.activeByOwner.get(ownerKey);
    if (!active) return "You have no active quest to abandon.";

    this.activeByOwner.delete(ownerKey);
    if (active.quest.generated) {
      this.generatedBoard.set(active.quest.id, active.quest);
    }

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
   * Completes the owner's active quest and returns it (so the caller can grant
   * its reward), or null if the owner had no active quest. Authored quests are
   * remembered as done for THIS owner only; a completed generated job is
   * replaced with a fresh one so the shared board never drains.
   */
  public complete(ownerKey: string): ActiveQuest | null {
    const active = this.activeByOwner.get(ownerKey);
    if (!active) return null;
    this.activeByOwner.delete(ownerKey);

    if (active.quest.generated) {
      const replacement = generateQuest();
      this.generatedBoard.set(replacement.id, replacement);
    } else {
      const done = this.completedByOwner.get(ownerKey) ?? new Set<string>();
      done.add(active.quest.id);
      this.completedByOwner.set(ownerKey, done);
    }

    return active;
  }

  /**
   * Migrates a solo player's active quest to a party owner key, used when
   * a player who holds a quest joins/forms a party. If both already have
   * quests, the solo one is dropped (generated jobs go back to the board).
   */
  public transferOwner(fromKey: string, toKey: string): void {
    const active = this.activeByOwner.get(fromKey);
    if (!active) return;

    if (this.activeByOwner.has(toKey)) {
      // Target already has a quest — release the solo one
      this.activeByOwner.delete(fromKey);
      if (active.quest.generated) {
        this.generatedBoard.set(active.quest.id, active.quest);
      }
      return;
    }

    this.activeByOwner.delete(fromKey);
    this.activeByOwner.set(toKey, { ...active });
  }
}
