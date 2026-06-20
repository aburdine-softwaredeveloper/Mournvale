/**
 * npcs.ts — The townsfolk of Mournvale (NPC definitions)
 *
 * Static world data. Each NPC is placed in a room by roomId and has a
 * role that drives interaction. Quest-givers reference quests by id
 * (see questData.ts) so talking to them surfaces their offers.
 *
 * Tone: grim-gothic setting, but the people are warm, weary, lived-in —
 * the village holding together against the fog.
 */

import type { NPC } from "../../types/npc";

export const NPCS: NPC[] = [
  // ── Tavern ──
  {
    id: "aldric",
    name: "Aldric",
    title: "Barkeep",
    role: "questgiver",
    roomId: "tavern",
    dialogue: [
      { text: "Welcome to the Broken Lantern. Sit, drink, and mind the fog." },
      { text: "Cellar's full of rats again. I'd pay to be rid of them, if you're able." },
    ],
    questIds: ["authored-rats"],
  },
  {
    id: "marta",
    name: "Marta",
    title: "Serving Maid",
    role: "friendly",
    roomId: "tavern",
    dialogue: [
      { text: "Mind Aldric — he grumbles, but he's got a soft heart under all that." },
      { text: "Travelers are rare these days. Most roads just... end, now." },
    ],
  },

  // ── Guard Post ──
  {
    id: "captain_vey",
    name: "Captain Vey",
    title: "Watch Captain",
    role: "questgiver",
    roomId: "guard_post",
    dialogue: [
      { text: "If you're looking for honest danger, I've no shortage of it." },
      { text: "A caravan went missing on the north road. I need eyes I can trust — and a party, not a fool alone." },
    ],
    questIds: ["authored-fog-scout", "authored-wolves"],
  },

  // ── Chapel ──
  {
    id: "sister_mara",
    name: "Sister Mara",
    title: "Chaplain",
    role: "questgiver",
    roomId: "chapel",
    dialogue: [
      { text: "The Still Light keeps its vigil, even when none come to pray." },
      { text: "The sick are many and my stores are bare. Moonpetal blooms in the churchyard after dark — would you gather some?" },
    ],
    questIds: ["authored-herbs"],
  },

  // ── Graveyard ──
  {
    id: "old_hollis",
    name: "Old Hollis",
    title: "Gravekeeper",
    role: "questgiver",
    roomId: "graveyard",
    dialogue: [
      { text: "Quiet here, mostly. The dead keep better company than the living." },
      { text: "The chapel bell hasn't rung since the Greyfall came. Something's wrong up in that tower. Brave folk only." },
    ],
    questIds: ["authored-bell"],
  },

  // ── Smithy ──
  {
    id: "borin",
    name: "Borin",
    title: "Blacksmith",
    role: "vendor",
    roomId: "smithy",
    dialogue: [
      { text: "Steel's the only honest thing left in this valley. What do you need?" },
    ],
    stock: [
      { id: "iron-sword", name: "Iron Sword", price: 120, description: "Plain, balanced, reliable." },
      { id: "round-shield", name: "Round Shield", price: 80, description: "Banded oak. Has stopped worse." },
      { id: "whetstone", name: "Whetstone", price: 15, description: "Keeps an edge keen." },
    ],
  },

  // ── General Store ──
  {
    id: "welk",
    name: "Welk",
    title: "Shopkeeper",
    role: "vendor",
    roomId: "general_store",
    dialogue: [
      { text: "If I don't have it, you don't need it. Probably." },
    ],
    stock: [
      { id: "rope", name: "Coil of Rope", price: 10, description: "Fifty feet of sturdy hemp." },
      { id: "lamp-oil", name: "Lamp Oil", price: 8, description: "A flask. Burns through a long night." },
      { id: "rations", name: "Trail Rations", price: 12, description: "Hard bread, dried meat, regret." },
      { id: "lantern", name: "Iron Lantern", price: 45, description: "Wards off more than dark." },
    ],
  },

  // ── Apothecary ──
  {
    id: "isolde",
    name: "Isolde",
    title: "Apothecary",
    role: "vendor",
    roomId: "apothecary",
    dialogue: [
      { text: "Careful what you breathe in here. Half these jars would kill you." },
    ],
    stock: [
      { id: "healing-draught", name: "Healing Draught", price: 35, description: "Closes wounds. Tastes of pennies." },
      { id: "antitoxin", name: "Antitoxin", price: 30, description: "For when the fog gets into your blood." },
      { id: "fogwort", name: "Fogwort Bundle", price: 18, description: "Burned to keep the grey at bay." },
    ],
  },

  // ── Stables ──
  {
    id: "tomas",
    name: "Tomas",
    title: "Stable-hand",
    role: "dialogue",
    roomId: "stables",
    dialogue: [
      { text: "The horses won't go south anymore. They feel it before we do." },
      { text: "Old Bess here? Steadiest mare in the valley. She'd carry you through anything." },
    ],
  },

  // ── Market Square ──
  {
    id: "pip",
    name: "Pip",
    title: "Street Urchin",
    role: "friendly",
    roomId: "market_square",
    dialogue: [
      { text: "Spare a coin? No? Worth a try." },
      { text: "I see everything that happens in this square. Everything. Could be useful to know someone like me." },
    ],
  },
];
