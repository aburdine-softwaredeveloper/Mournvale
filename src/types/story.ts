/**
 * story.ts — Types for the intro cinematic and dialogue systems
 *
 * The intro cinematic is purely client-side — these types are used
 * only by the client screens. No server communication required until
 * the player signals IntroComplete.
 */

// ─────────────────────────────────────────────
// INTRO CINEMATIC
// ─────────────────────────────────────────────

/**
 * A single "scene" in the intro cinematic.
 * Each scene displays text with a typewriter effect, then waits
 * for the player to press a key or click to advance.
 */
export interface StoryScene {
  /** The text to display with typewriter effect */
  text: string;

  /**
   * Optional header displayed above the text (e.g. location name).
   * If omitted, no header is shown.
   */
  header?: string;

  /**
   * How long each character takes to appear in milliseconds.
   * Defaults to 40ms if not specified.
   */
  typewriterSpeed?: number;

  /**
   * If true, player must press a key/click to advance rather than
   * it auto-advancing after typewriter completes.
   */
  requiresInput: boolean;
}

/**
 * The full intro cinematic — an ordered sequence of scenes.
 */
export interface IntroCinematic {
  scenes: StoryScene[];
}

// ─────────────────────────────────────────────
// DIALOGUE SYSTEM (used by IntroScreen + CharacterCreation)
// ─────────────────────────────────────────────

/**
 * A selectable choice presented to the player during dialogue.
 * `value` is what gets sent to the server; `label` is what's displayed.
 */
export interface DialogueOption {
  label: string;
  value: string;
  /** Optional flavor text shown in a sub-description area */
  description?: string;
}

/**
 * A node in a dialogue tree — one speaker turn with optional choices.
 */
export interface DialogueNode {
  speaker: string;
  text: string;
  options?: DialogueOption[];
}
