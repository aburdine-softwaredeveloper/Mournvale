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
  /**
   * The words the quest giver speaks the moment the quest completes — the
   * emotional payoff / resolution. Emitted as NPC speech (with portrait) just
   * before the reward line, so finishing a job lands as a story beat rather than
   * a bare "Quest complete" toast. Absent = no spoken resolution (reward only).
   */
  resolution?: string;
  /**
   * Lore keys the player must have LEARNED (by talking to the townsfolk —
   * see NPC.meetLore / DialogueOutcomeData.loreKey) before this quest appears
   * on their board. This is what makes conversation advance the campaign:
   * the town's story quests are hidden behind knowledge only its people hold.
   * Absent = always visible (starter jobs).
   */
  requiresLore?: string[];
  /**
   * Lore keys granted to every recipient when this quest completes — a
   * finished job can itself be the knowledge that unlocks the next chapter
   * (finding what silenced the bell reveals the way to the fog's heart).
   */
  grantsLore?: string[];
  /**
   * The teaser shown on the board while `requiresLore` is unmet — a rumor
   * pointing the player at WHO to talk to, so a locked quest reads as a
   * thread to pull rather than a hole in the list.
   */
  rumorHint?: string;
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
  /**
   * Teasers for authored quests the player hasn't unlocked yet (their
   * `requiresLore` is unmet). Each is a rumorHint line pointing at who in
   * town to talk to. Rendered as a "Rumors" section under the real cards.
   */
  rumors?: string[];
}
