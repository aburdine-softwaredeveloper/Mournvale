/**
 * epilogue.ts — The ending cinematic for Mournvale
 *
 * Pure data. Emitted to the client as an `epilogue` ServerMessage the moment
 * the Fogmother (authored-fog-boss) is defeated. The client plays these scenes
 * with the same typewriter treatment as the opening cinematic, then returns the
 * player to a world where the Greyfall has lifted.
 *
 * Edit these scenes to change the ending narrative — no code change needed.
 */

import type { EpilogueScene } from "../../types/network";

export const EPILOGUE_SCENES: EpilogueScene[] = [
  {
    header: "The Heart Goes Still",
    text:
      "The Fogmother folds inward with a sound like a held breath finally " +
      "let go. Where she stood, the grey unravels — thread by thread, then " +
      "all at once.",
  },
  {
    text:
      "For the first time in living memory, wind moves through the valley of " +
      "Mournvale. Not the cold that gnawed the bold and swallowed the careless " +
      "— just wind, carrying the smell of wet earth and, faintly, of morning.",
  },
  {
    header: "The Fog Lifts",
    text:
      "It rolls back off the south road, off the drowned fields, off the " +
      "broken bridge no one has crossed in a generation. Beneath it: the " +
      "valley as it was. Stone walls. Old orchards. Roads that lead somewhere " +
      "again.",
  },
  {
    text:
      "In the chapel, a bell that has been silent since the Greyfall finds its " +
      "voice. Old Hollis weeps to hear it. Sister Mara throws open the ward " +
      "windows to the light. Captain Vey stands down the nightwatch — the " +
      "first dawn in years that needs no lanterns.",
  },
  {
    text:
      "They will tell this story for a long time. How the fog had a heart, and " +
      "it was awake, and someone walked into the grey and did not turn back. " +
      "They will tell it with your name.",
  },
  {
    header: "Mournvale",
    text:
      "The valley remembers the ones who carried its light. So will you.\n\n" +
      "Thank you for playing.\n\n" +
      "— aburdine.softwaredeveloper",
  },
];
