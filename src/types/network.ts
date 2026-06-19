/**
 * network.ts — Canonical WebSocket message types for Mournvale
 *
 * ALL messages sent between client and server must use these types.
 * Never introduce ad-hoc message shapes in component or command files.
 *
 * Architecture: Discriminated union on `type` field allows exhaustive
 * type-checking on both ends of the socket connection.
 */

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

/** Updates the room panel — name, description, exits, occupants */
export interface RoomMessage {
  type: "room";
  payload: {
    name: string;
    description: string;
    exits: string[];
    players: string[];
  };
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
 * Confirms a save just completed (e.g. on disconnect-save we don't send
 * this, but an explicit save command gets an ack). Carries the updated
 * slot summary so the client can refresh its menu if showing.
 */
export interface SaveResultMessage {
  type: "save_result";
  payload: {
    success: boolean;
    slot: number;
    message: string;
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
 * player so the server can scope save slots to them. The playerId is
 * generated client-side and stored in localStorage.
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

/**
 * Player chose "New Game" in a given slot. The slot is remembered so
 * that when the character is created (or on disconnect) we save there.
 */
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

// ─────────────────────────────────────────────
// SHARED ENUMS & SUPPORTING TYPES
// ─────────────────────────────────────────────

export type PlayerState = "menu" | "pending" | "character_creation" | "active";

export type CharacterCreationStep =
  | "name"
  | "gender"
  | "class"
  | "hair_style"
  | "hair_color"
  | "glasses"
  | "confirm";

export type CharacterClass =
  | "Knight"
  | "Healer"
  | "Fighter"
  | "Monk"
  | "Mage"
  | "Thief"
  | "Archer";

export type Gender = "Male" | "Female";

export interface DialogueChoice {
  label: string;
  value: string;
}

/**
 * A lightweight summary of one save slot, sent to the client to render
 * the load-game menu. Mirrors the server's SaveSlotSummary but lives
 * here so the client never imports server code. Empty slots have
 * occupied: false and omit the detail fields.
 */
export interface SaveSlotSummary {
  slot: number;
  occupied: boolean;
  characterName?: string;
  characterClass?: string;
  roomName?: string;
  savedAt?: number;
}

/**
 * CharacterDraft — partial character data accumulated during creation.
 * All fields optional because they are filled in step by step.
 */
export interface CharacterDraft {
  name?: string;
  gender?: Gender;
  characterClass?: CharacterClass;
  hairStyle?: string;
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
  | SaveResultMessage;

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
  | CommandMessage;
