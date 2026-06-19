/**
 * intro.ts — The opening cinematic content for Mournvale
 *
 * Pure data — no logic. Edit these scenes to change the intro narrative.
 * IntroScreen.ts consumes this and plays it with a typewriter effect.
 *
 * The final scene leads into the player "waking" in the tavern, which
 * hands off to character creation (the tavern keeper dialogue).
 */

import type { IntroCinematic } from "../../types/story";

export const INTRO_CINEMATIC: IntroCinematic = {
  scenes: [
    {
      header: "Mournvale",
      text:
        "Long ago, the valley of Mournvale prospered beneath a sky of " +
        "endless stars...",
      typewriterSpeed: 45,
      requiresInput: true,
    },
    {
      text:
        "Then came the Greyfall. A fog without end, swallowing the roads, " +
        "the villages, and the light itself.",
      typewriterSpeed: 45,
      requiresInput: true,
    },
    {
      text:
        "Those who remained learned to live by lantern and by blade. " +
        "The fog took the careless. The bold, it merely tested.",
      typewriterSpeed: 45,
      requiresInput: true,
    },
    {
      text:
        "You do not remember how you came to be here. You remember only " +
        "the cold... and a door of warm light ahead.",
      typewriterSpeed: 45,
      requiresInput: true,
    },
    {
      text:
        "You push it open. Warmth. The smell of ale and wet wood. " +
        "A fire crackles. Somewhere, a barkeep is watching you...",
      typewriterSpeed: 45,
      requiresInput: true,
    },
    {
      header: "The Broken Lantern",
      text: "You awaken in a dimly lit tavern.",
      typewriterSpeed: 55,
      requiresInput: true,
    },
  ],
};
