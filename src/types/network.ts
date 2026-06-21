/**
 * network.ts — Canonical WebSocket message types for Mournvale
 *
 * ALL messages sent between client and server must use these types.
 * Never introduce ad-hoc message shapes in component or command files.
 *
 * Architecture: Discriminated union on `type` field allows exhaustive
 * type-checking on both ends of the socket connection.
 *
 * Phase 2 additions: SkillCheckDisplay on npc_interaction, TalkIntent
 * on TalkMessage (optional — omitting defaults to "inquire").
 *
 * Phase 3 additions: Full combat message family (combat_start,
 * combat_planning, combat_resolution, combat_end, combat_submit_action).
 */

import type { PartyView, PartyInviteView } from "./party";
import type { QuestBoardView } from "./quest";
import type { NpcView, NpcInteractionView, TalkIntent, DialogueOutcome } from "./npc";
import type { CombatStateView, CombatEvent, CombatActionSubmission, CombatOutcome } from "./combat";

// ─────────────────────────────────────────────
// SERVER → CLIENT MESSAGES
// ─────────────────────────────────────────────

/** A system notification (connection events, errors, state changes) */
export interface SystemMessage {
  type: "system";
  payload: {
    message: string;
  };
}

/** Updates the room panel — name, description, exits, occupants, NPCs */
export interface RoomMessage {
  type: "room";
  payload: {
    name: string;
    description: string;
    exits: string[];
    players: string[];
    /** NPCs standing in this room (for the "Here" list) */
    npcs: NpcView[];
    /** Optional art key for the room scene (e.g. "tavern") */
    artKey?: string;
  };
}

/**
 * The result of talking to an NPC.
 *
 * Payload is an NpcInteractionView plus two optional fields added by
 * Phase 2: `checkDisplay` (the roll reveal when a skill check ran) and
 * `infoReveal` (lore unlocked by a successful check). Extending via
 * intersection keeps NpcInteractionView itself clean of network concerns.
 */
export interface NpcInteractionMessage {
  type: "npc_interaction";
  payload: NpcInteractionView & {
    /** Present when the interaction triggered a d20 skill check. */
    checkDisplay?: SkillCheckDisplay;
    /** World lore revealed by a successful/critical check. */
    infoReveal?: string;
  };
}

/**
 * The roll-reveal data for a skill-check conversation.
 * Rendered by the client as: "Persuasion — 14 + 3 = 17 vs DC 15 — Success"
 */
export interface SkillCheckDisplay {
  skill: string;
  intent: TalkIntent;
  d20Result: number;
  modifier: number;
  total: number;
  dc: number;
  outcome: DialogueOutcome;
  wasProficient: boolean;
}

/** A chat message spoken in the room */
export interface ChatMessage {
  type: "chat";
  payload: {
    speaker: string;
    message: string;
  };
}

/** A single line of NPC/tavern keeper dialogue, delivered sequentially */
export interface DialogueMessage {
  type: "dialogue";
  payload: {
    speaker: string;
    text: string;
    /** If provided, client renders these as selectable options */
    choices?: DialogueChoice[];
    /** Unique key identifying which creation step this dialogue belongs to */
    step?: CharacterCreationStep;
  };
}

/** Signals the client to transition to a new screen/state */
export interface StateTransitionMessage {
  type: "state_transition";
  payload: {
    newState: PlayerState;
  };
}

/** Acknowledges character creation and returns the created character summary */
export interface CharacterConfirmedMessage {
  type: "character_confirmed";
  payload: {
    name: string;
    characterClass: CharacterClass;
    gender: Gender;
    /** Visual fields needed to render the composited portrait */
    hairColor: string;
    glasses: boolean;
  };
}

/** Broadcasts a player arrival or departure to a room */
export interface PlayerPresenceMessage {
  type: "player_presence";
  payload: {
    playerName: string;
    event: "entered" | "left";
  };
}

/**
 * Sends the list of save slots to the client for the load-game menu.
 * Sent in response to a `request_slots` message.
 */
export interface SlotListMessage {
  type: "slot_list";
  payload: {
    slots: SaveSlotSummary[];
  };
}

/**
 * Confirms a save just completed. Carries the updated slot summary so
 * the client can refresh its menu if showing.
 */
export interface SaveResultMessage {
  type: "save_result";
  payload: {
    success: boolean;
    slot: number;
    message: string;
  };
}

// ── Party messages ──

/**
 * A full party state snapshot, sent to every member when the party
 * changes. `party` is null when the player is no longer in any party.
 */
export interface PartyUpdateMessage {
  type: "party_update";
  payload: {
    party: PartyView | null;
  };
}

/** Notifies a player they've received a party invitation */
export interface PartyInviteMessage {
  type: "party_invite";
  payload: PartyInviteView;
}

// ── Quest messages ──

/**
 * The quest board snapshot — available quests + the player's active quest.
 */
export interface QuestBoardMessage {
  type: "quest_board";
  payload: QuestBoardView;
}

// ── Combat messages (Phase 3) ──

/**
 * Sent once to each player when a combat encounter begins.
 * Each player receives a personalised view (their entity is flagged).
 */
export interface CombatStartMessage {
  type: "combat_start";
  payload: CombatStateView;
}

/**
 * Sent at the start of each planning round, and whenever the pending
 * submission list changes (i.e. after each player submits their action).
 * Each player receives a personalised view.
 */
export interface CombatPlanningMessage {
  type: "combat_planning";
  payload: {
    combatId: string;
    round: number;
    state: CombatStateView;
    /** Player ids still waiting to submit their action. */
    pendingPlayerIds: string[];
  };
}

/**
 * Broadcast to all players after all submissions are collected and the
 * round has resolved. Contains the ordered event log for animated playback,
 * plus the final board state to apply when playback finishes.
 */
export interface CombatResolutionMessage {
  type: "combat_resolution";
  payload: {
    combatId: string;
    round: number;
    events: CombatEvent[];
    finalState: CombatStateView;
  };
}

/** Sent to all players when combat ends. */
export interface CombatEndMessage {
  type: "combat_end";
  payload: {
    combatId: string;
    outcome: CombatOutcome;
    xpReward: number;
    goldReward: number;
  };
}

// ─────────────────────────────────────────────
// CLIENT → SERVER MESSAGES
// ─────────────────────────────────────────────

/** Player has finished watching the intro and is ready for tavern keeper */
export interface IntroCompleteMessage {
  type: "intro_complete";
  payload: Record<string, never>;
}

/**
 * First message a client sends on connect — identifies the persistent
 * player so the server can scope save slots to them.
 */
export interface IdentifyMessage {
  type: "identify";
  payload: {
    playerId: string;
  };
}

/** Requests the current save-slot summaries (for the load-game menu) */
export interface RequestSlotsMessage {
  type: "request_slots";
  payload: Record<string, never>;
}

/** Player chose "New Game" in a given slot. */
export interface NewGameMessage {
  type: "new_game";
  payload: {
    slot: number;
  };
}

/** Player chose "Load Game" from a given slot */
export interface LoadGameMessage {
  type: "load_game";
  payload: {
    slot: number;
  };
}

/** Explicit request to delete a save slot */
export interface DeleteSlotMessage {
  type: "delete_slot";
  payload: {
    slot: number;
  };
}

/** Player's response to a dialogue choice during character creation */
export interface DialogueChoiceMessage {
  type: "dialogue_choice";
  payload: {
    step: CharacterCreationStep;
    value: string;
  };
}

/** Final submission — all character data collected, request to enter world */
export interface CharacterCreateMessage {
  type: "character_create";
  payload: CharacterDraft;
}

/** A standard game command (look, move, say, etc.) — only valid when active */
export interface CommandMessage {
  type: "command";
  payload: {
    input: string;
  };
}

/**
 * Talk to an NPC in the current room.
 *
 * Phase 2: `intent` optionally chooses the conversational approach, which
 * triggers a d20 skill check against the NPC's dialogue branch DC. Omit
 * to use the NPC's default dialogue with no check.
 */
export interface TalkMessage {
  type: "talk";
  payload: {
    /** NPC name (first name) to talk to */
    targetName: string;
    /** Conversational approach — triggers a skill check if the NPC has a matching branch */
    intent?: TalkIntent;
  };
}

// ── Party actions (client → server) ──

/** Invite another player (in the same room) to a party */
export interface PartyInviteSendMessage {
  type: "party_invite_send";
  payload: {
    targetName: string;
  };
}

/** Respond to a pending party invitation */
export interface PartyInviteRespondMessage {
  type: "party_invite_respond";
  payload: {
    partyId: string;
    fromPlayerId: string;
    accept: boolean;
  };
}

/** Leave the current party (disbands it if the leader leaves) */
export interface PartyLeaveMessage {
  type: "party_leave";
  payload: Record<string, never>;
}

// ── Quest actions (client → server) ──

/** Request the quest board contents (when reading the board) */
export interface QuestBoardRequestMessage {
  type: "quest_board_request";
  payload: Record<string, never>;
}

/** Accept a quest by id (solo or as a party) */
export interface QuestAcceptMessage {
  type: "quest_accept";
  payload: {
    questId: string;
  };
}

/** Abandon the currently active quest */
export interface QuestAbandonMessage {
  type: "quest_abandon";
  payload: Record<string, never>;
}

// ── Combat actions (client → server, Phase 3) ──

/**
 * Submits a player's planned action for the current combat round.
 * The server collects these from all players then resolves the round
 * in initiative order once everyone has submitted (or timed out).
 */
export interface CombatSubmitActionMessage {
  type: "combat_submit_action";
  payload: {
    combatId: string;
    submission: CombatActionSubmission;
  };
}

// ─────────────────────────────────────────────
// SHARED ENUMS & SUPPORTING TYPES
// ─────────────────────────────────────────────

export type PlayerState = "menu" | "pending" | "character_creation" | "active";

export type CharacterCreationStep =
  | "name"
  | "gender"
  | "class"
  | "hair_color"
  | "glasses"
  | "confirm";

export type CharacterClass =
  | "Knight"
  | "Healer"
  | "Warrior"
  | "Monk"
  | "Mage"
  | "Thief"
  | "Archer";

export type Gender = "Male" | "Female";

export interface DialogueChoice {
  label: string;
  value: string;
}

export interface SaveSlotSummary {
  slot: number;
  occupied: boolean;
  characterName?: string;
  characterClass?: string;
  roomName?: string;
  savedAt?: number;
}

export interface CharacterDraft {
  name?: string;
  gender?: Gender;
  characterClass?: CharacterClass;
  hairColor?: string;
  glasses?: boolean;
}

// ─────────────────────────────────────────────
// DISCRIMINATED UNIONS
// ─────────────────────────────────────────────

/** Every message the server can send to a client */
export type ServerMessage =
  | SystemMessage
  | RoomMessage
  | ChatMessage
  | DialogueMessage
  | StateTransitionMessage
  | CharacterConfirmedMessage
  | PlayerPresenceMessage
  | SlotListMessage
  | SaveResultMessage
  | PartyUpdateMessage
  | PartyInviteMessage
  | QuestBoardMessage
  | NpcInteractionMessage
  | CombatStartMessage
  | CombatPlanningMessage
  | CombatResolutionMessage
  | CombatEndMessage;

/** Every message the client can send to the server */
export type ClientMessage =
  | IdentifyMessage
  | RequestSlotsMessage
  | NewGameMessage
  | LoadGameMessage
  | DeleteSlotMessage
  | IntroCompleteMessage
  | DialogueChoiceMessage
  | CharacterCreateMessage
  | CommandMessage
  | PartyInviteSendMessage
  | PartyInviteRespondMessage
  | PartyLeaveMessage
  | QuestBoardRequestMessage
  | QuestAcceptMessage
  | QuestAbandonMessage
  | TalkMessage
  | CombatSubmitActionMessage;
