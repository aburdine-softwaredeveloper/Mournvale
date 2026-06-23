/**
 * quest.ts — Types for the quest board system
 *
 * Quests come from two sources (per design): authored quests in a static
 * data file, and template-generated random quests. Both produce the same
 * Quest shape so the board treats them identically.
 *
 * A quest can be accepted by a solo player or by a party. Once accepted,
 * it's tracked as an ActiveQuest on the player (and shared by the party).
 *
 * Architecture: Shared client/server shapes. The server owns the board
 * and which quests are taken; the client renders QuestView snapshots.
 */

/** Difficulty tier — affects rewards and recommended party size */
export type QuestDifficulty = "Trivial" | "Easy" | "Moderate" | "Hard" | "Perilous";

/** Who can take a quest on */
export type QuestParticipation = "solo" | "party" | "either";

/** Reward granted on completion */
export interface QuestReward {
  /** Gold pieces */
  gold: number;
  /** Experience points */
  xp: number;
  /** Optional named item reward */
  item?: string;
}

/**
 * A quest definition as shown on the board. Authored and generated
 * quests share this shape.
 */
export interface Quest {
  id: string;
  title: string;
  /** Flavor text describing the job */
  description: string;
  /** Who gives the quest (NPC name) */
  giver: string;
  difficulty: QuestDifficulty;
  participation: QuestParticipation;
  reward: QuestReward;
  /** Recommended number of adventurers (informational) */
  recommendedSize: number;
  /** True if this quest was procedurally generated (vs authored) */
  generated: boolean;
  /**
   * Optional combat objective: defeating all hostiles in this room completes
   * the quest. The single hook that turns a board quest into a clearable one
   * (see QuestManager.complete + the combat-end handler). Absent = no combat
   * objective (board-only flavor or future objective types).
   */
  objectiveRoomId?: string;
}

/**
 * A quest the player (or their party) has accepted. Wraps the Quest with
 * who accepted it and when.
 */
export interface ActiveQuest {
  quest: Quest;
  /** Party id if taken as a party, otherwise null for solo */
  partyId: string | null;
  /** Unix ms when accepted */
  acceptedAt: number;
}

/**
 * A board snapshot sent to the client — the list of available quests
 * plus the player's currently accepted quest (if any).
 */
export interface QuestBoardView {
  available: Quest[];
  active: ActiveQuest | null;
}
