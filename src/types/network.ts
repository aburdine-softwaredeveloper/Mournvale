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

// ─────────────────────────────────────────────
// CLIENT → SERVER MESSAGES
// ─────────────────────────────────────────────

/** Player has finished watching the intro and is ready for tavern keeper */
export interface IntroCompleteMessage {
  type: "intro_complete";
  payload: Record<string, never>;
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

export type PlayerState = "pending" | "character_creation" | "active";

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
  | PlayerPresenceMessage;

/** Every message the client can send to the server */
export type ClientMessage =
  | IntroCompleteMessage
  | DialogueChoiceMessage
  | CharacterCreateMessage
  | CommandMessage;
