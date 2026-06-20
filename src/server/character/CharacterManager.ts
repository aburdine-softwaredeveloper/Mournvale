/**
 * CharacterManager.ts — Manages the character creation dialogue flow
 *
 * This module owns the tavern keeper conversation — it decides what
 * question to ask next, validates answers, accumulates the draft,
 * and finalizes the character when all steps are complete.
 *
 * Architecture: State machine pattern. Each step is a pure function
 * that returns the next DialogueMessage to send. The server calls
 * `getNextDialogue()` to advance the conversation.
 */

import type {
  DialogueMessage,
  CharacterCreationStep,
  CharacterDraft,
  CharacterClass,
  Gender,
  DialogueChoice,
} from "../../types/network";
import type { CharacterData } from "../../types/game";

// ─────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────

const SPEAKER = "Aldric the Barkeep";

const CLASS_CHOICES: DialogueChoice[] = [
  { label: "[+] Knight",  value: "Knight"  },
  { label: "[*] Healer",  value: "Healer"  },
  { label: "[X] Warrior", value: "Warrior" },
  { label: "[o] Monk",    value: "Monk"    },
  { label: "[~] Mage",    value: "Mage"    },
  { label: "[/] Thief",   value: "Thief"   },
  { label: "[>] Archer",  value: "Archer"  },
];

const GENDER_CHOICES: DialogueChoice[] = [
  { label: "Male",   value: "Male"   },
  { label: "Female", value: "Female" },
];

const HAIR_STYLE_CHOICES: DialogueChoice[] = [
  { label: "Short",    value: "Short"    },
  { label: "Long",     value: "Long"     },
  { label: "Braided",  value: "Braided"  },
  { label: "Shaved",   value: "Shaved"   },
  { label: "Curly",    value: "Curly"    },
  { label: "Ponytail", value: "Ponytail" },
];

const HAIR_COLOR_CHOICES: DialogueChoice[] = [
  { label: "Black",  value: "Black"  },
  { label: "Brown",  value: "Brown"  },
  { label: "Blonde", value: "Blonde" },
  { label: "Red",    value: "Red"    },
  { label: "White",  value: "White"  },
  { label: "Silver", value: "Silver" },
];

const GLASSES_CHOICES: DialogueChoice[] = [
  { label: "Yes", value: "true"  },
  { label: "No",  value: "false" },
];

// ─────────────────────────────────────────────
// STEP ORDER
// ─────────────────────────────────────────────

/**
 * The ordered sequence of creation steps.
 * Changing this order is the only thing needed to reorder the conversation.
 */
const CREATION_STEPS: CharacterCreationStep[] = [
  "name",
  "gender",
  "class",
  "hair_style",
  "hair_color",
  "glasses",
  "confirm",
];

// ─────────────────────────────────────────────
// DIALOGUE BUILDERS
// ─────────────────────────────────────────────

/**
 * Returns the DialogueMessage for a given creation step.
 * Called by the server to know what to send the client next.
 */
export function getDialogueForStep(
  step: CharacterCreationStep,
  draft: CharacterDraft
): DialogueMessage {
  switch (step) {
    case "name":
      return {
        type: "dialogue",
        payload: {
          speaker: SPEAKER,
          text:
            "Ah, a new face. Haven't seen you in here before. " +
            "What do they call you, traveler?",
          step: "name",
          // No choices — name is a free text input
        },
      };

    case "gender":
      return {
        type: "dialogue",
        payload: {
          speaker: SPEAKER,
          text: `${draft.name ?? "Traveler"}... that's a fine name. ` +
            "And tell me — are you a man or a woman?",
          step: "gender",
          choices: GENDER_CHOICES,
        },
      };

    case "class":
      return {
        type: "dialogue",
        payload: {
          speaker: SPEAKER,
          text:
            "I see. And what path have you walked? " +
            "A warrior? A scholar of the arcane? " +
            "Every soul that passes through this door carries a trade.",
          step: "class",
          choices: CLASS_CHOICES,
        },
      };

    case "hair_style":
      return {
        type: "dialogue",
        payload: {
          speaker: SPEAKER,
          text:
            "A " +
            (draft.characterClass ?? "traveler") +
            "... good choice. " +
            "Now let me take a good look at you. How do you wear your hair?",
          step: "hair_style",
          choices: HAIR_STYLE_CHOICES,
        },
      };

    case "hair_color":
      return {
        type: "dialogue",
        payload: {
          speaker: SPEAKER,
          text: "And what color is it?",
          step: "hair_color",
          choices: HAIR_COLOR_CHOICES,
        },
      };

    case "glasses":
      return {
        type: "dialogue",
        payload: {
          speaker: SPEAKER,
          text: "Do you wear spectacles?",
          step: "glasses",
          choices: GLASSES_CHOICES,
        },
      };

    case "confirm":
      return {
        type: "dialogue",
        payload: {
          speaker: SPEAKER,
          text:
            `So then — ${draft.name ?? "stranger"}, ` +
            `a ${draft.gender ?? ""} ${draft.characterClass ?? ""}, ` +
            `${draft.hairColor} ${draft.hairStyle} hair` +
            (draft.glasses ? ", spectacles and all." : ".") +
            " Is that right?",
          step: "confirm",
          choices: [
            { label: "That's me.", value: "confirm" },
            { label: "Let me start over.", value: "restart" },
          ],
        },
      };
  }
}

// ─────────────────────────────────────────────
// STEP NAVIGATION
// ─────────────────────────────────────────────

/**
 * Returns the next step in the creation sequence after the current one.
 * Returns null if the current step is the last one.
 */
export function getNextStep(
  current: CharacterCreationStep
): CharacterCreationStep | null {
  const index = CREATION_STEPS.indexOf(current);
  if (index === -1 || index === CREATION_STEPS.length - 1) return null;
  return CREATION_STEPS[index + 1] ?? null;
}

/**
 * Returns the first step in the creation sequence.
 */
export function getFirstStep(): CharacterCreationStep {
  // CREATION_STEPS is a non-empty constant; index 0 is always defined.
  return CREATION_STEPS[0]!;
}

// ─────────────────────────────────────────────
// ANSWER PROCESSING
// ─────────────────────────────────────────────

/**
 * Applies a player's answer to the draft object.
 * Returns an error string if the answer is invalid, or null if accepted.
 */
export function applyAnswer(
  step: CharacterCreationStep,
  value: string,
  draft: CharacterDraft
): string | null {
  switch (step) {
    case "name": {
      const trimmed = value.trim();
      if (trimmed.length < 2) return "Names must be at least 2 characters.";
      if (trimmed.length > 20) return "Names cannot exceed 20 characters.";
      if (!/^[a-zA-Z\s'-]+$/.test(trimmed)) {
        return "Names may only contain letters, spaces, hyphens, and apostrophes.";
      }
      draft.name = trimmed;
      return null;
    }

    case "gender": {
      const validGenders: Gender[] = ["Male", "Female"];
      if (!validGenders.includes(value as Gender)) {
        return "Please choose Male or Female.";
      }
      draft.gender = value as Gender;
      return null;
    }

    case "class": {
      const validClasses: CharacterClass[] = [
        "Knight", "Healer", "Warrior", "Monk", "Mage", "Thief", "Archer",
      ];
      if (!validClasses.includes(value as CharacterClass)) {
        return "Please choose a valid class.";
      }
      draft.characterClass = value as CharacterClass;
      return null;
    }

    case "hair_style": {
      const valid = ["Short", "Long", "Braided", "Shaved", "Curly", "Ponytail"];
      if (!valid.includes(value)) return "Please choose a valid hair style.";
      draft.hairStyle = value;
      return null;
    }

    case "hair_color": {
      const valid = ["Black", "Brown", "Blonde", "Red", "White", "Silver"];
      if (!valid.includes(value)) return "Please choose a valid hair color.";
      draft.hairColor = value;
      return null;
    }

    case "glasses": {
      if (value !== "true" && value !== "false") {
        return "Please choose Yes or No.";
      }
      draft.glasses = value === "true";
      return null;
    }

    case "confirm":
      // Handled by the caller — "confirm" or "restart"
      return null;
  }
}

// ─────────────────────────────────────────────
// CHARACTER FINALIZATION
// ─────────────────────────────────────────────

/**
 * Promotes a completed CharacterDraft to a full CharacterData object.
 * Throws if the draft is missing required fields — this should never
 * happen if the dialogue flow is followed correctly.
 */
export function finalizeDraft(draft: CharacterDraft): CharacterData {
  if (
    !draft.name ||
    !draft.gender ||
    !draft.characterClass ||
    !draft.hairStyle ||
    !draft.hairColor ||
    draft.glasses === undefined
  ) {
    throw new Error(
      "Cannot finalize character — draft is missing required fields: " +
        JSON.stringify(draft)
    );
  }

  return {
    name: draft.name,
    gender: draft.gender,
    characterClass: draft.characterClass,
    hairStyle: draft.hairStyle,
    hairColor: draft.hairColor,
    glasses: draft.glasses,
  };
}
