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
   * The room where this quest's objective is carried out. For "clear" quests,
   * defeating all hostiles here completes it (the combat-end handler). For the
   * non-combat kinds below, simply entering this room performs the field task
   * (gather/scout/investigate/deliver). Absent = board-only flavor.
   */
  objectiveRoomId?: string;
  /**
   * What kind of objective `objectiveRoomId` represents.
   *   "clear"       → defeat all hostiles in the room (combat).
   *   "gather"      → collect something found in the room.
   *   "scout"       → observe/recon the room.
   *   "investigate" → search the room for what's wrong.
   *   "deliver"     → carry an item to the room (one-way; auto-completes).
   * Defaults to "clear" when omitted (back-compat with combat quests).
   */
  objectiveKind?: "clear" | "gather" | "scout" | "investigate" | "deliver";
  /**
   * For non-combat quests with a return step: the NPC id the player reports
   * back to (usually the giver) to claim the reward, once the field objective
   * is met. Absent = the quest auto-completes the moment the objective is met
   * (used for "deliver", which ends at the destination).
   */
  turnInNpcId?: string;
  /**
   * Quest-specific clue surfaced when the player uses `look` while standing in
   * this quest's objective room. Lets close inspection tell the story — the
   * caravan's broken axle, the thing wedged in the bell — rather than the bare
   * room description. Shown only while this quest is the player's active one.
   */
  lookClue?: string;
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
  /**
   * Field-objective progress for non-combat quests: set true once the player
   * has reached the objective room and performed the task, after which they can
   * report back to `turnInNpcId`. Combat ("clear") quests don't use this.
   */
  objectiveMet?: boolean;
}

/**
 * A board snapshot sent to the client — the list of available quests
 * plus the player's currently accepted quest (if any).
 */
export interface QuestBoardView {
  available: Quest[];
  active: ActiveQuest | null;
}
