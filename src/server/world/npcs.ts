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
    dialogueBranches: [
      {
        intent: "inquire",
        dc: 11,
        outcomes: {
          crit_success: {
            npcLine: "You've a kind way of listening. Truth is, I hear things, leaning over these tables. There's a door in the cellar nobody'll open — Aldric bricked it himself, the year the fog came.",
            infoReveal: "Aldric bricked over a second cellar door the year the Greyfall arrived.",
          },
          success: {
            npcLine: "You're easy to talk to. The cellar's gone strange since the fog — the rats came up from somewhere they oughtn't.",
            infoReveal: "The cellar rats came up from somewhere deeper than the cellar.",
          },
          fail: { npcLine: "She wipes a mug and looks away. \"Just rumors. Nothing worth your time.\"" },
          crit_fail: { npcLine: "Marta stiffens. \"You're prying. I've work to do.\" She turns her back." },
        },
      },
      {
        intent: "persuade",
        dc: 13,
        outcomes: {
          crit_success: {
            npcLine: "Oh, go on then — first ale's on me. Don't tell Aldric. And… be careful down that cellar, aye?",
          },
          success: { npcLine: "You've a honest face. I'll set aside a bowl of stew for you, no charge." },
          fail: { npcLine: "\"Sweet words don't pour ale, love.\" She smiles, but doesn't budge." },
          crit_fail: { npcLine: "\"I wasn't born yesterday.\" Marta's smile vanishes." },
        },
      },
    ],
  },

  // ── Tavern Cellar (hostile — the "Cellar Vermin" quest encounter) ──
  {
    id: "cellar_rat_1",
    name: "Cellar Rat",
    title: "Vermin",
    role: "hostile",
    roomId: "cellar",
    enemyTemplate: "rat",
    dialogue: [{ text: "It bares yellow teeth and hisses." }],
  },
  {
    id: "cellar_rat_2",
    name: "Cellar Rat",
    title: "Vermin",
    role: "hostile",
    roomId: "cellar",
    enemyTemplate: "rat",
    dialogue: [{ text: "It bares yellow teeth and hisses." }],
  },
  {
    id: "cellar_rat_bold",
    name: "Bold Rat",
    title: "Pack Leader",
    role: "hostile",
    roomId: "cellar",
    enemyTemplate: "rat_bold",
    dialogue: [{ text: "Larger than the rest, it stands its ground." }],
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
    dialogueBranches: [
      {
        intent: "persuade",
        dc: 14,
        outcomes: {
          crit_success: {
            npcLine: "...You speak plainly, and I respect that. Off the record: the caravan didn't vanish on the road. It turned around and drove straight into the fog. Willingly.",
            infoReveal: "The lost caravan drove into the Greyfall of its own accord — it was not ambushed.",
          },
          success: {
            npcLine: "Hm. You're not just another sellsword, are you. Fine — the road's safe by day. It's after dark you'll want company.",
            infoReveal: "The north road is passable by day; the danger comes after dark.",
          },
          fail: { npcLine: "\"Save the honeyed words for the magistrate. Take the job or don't.\"" },
          crit_fail: { npcLine: "The Captain's jaw tightens. \"I've buried men who talked like you. Move along.\"" },
        },
      },
      {
        intent: "intimidate",
        dc: 16,
        outcomes: {
          crit_success: {
            npcLine: "...You've a hard edge. Good. The valley needs hard edges now. Don't waste it on me.",
          },
          success: { npcLine: "The Captain holds your gaze a long moment, then nods once. \"You'll do.\"" },
          fail: { npcLine: "\"You're leaning on the wrong man.\" He doesn't so much as blink." },
          crit_fail: {
            npcLine: "Two guards step in at the Captain's glance. \"Threaten the watch again and you'll see the inside of a cell.\"",
            standing: "hostile",
          },
        },
      },
    ],
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
      { itemId: "iron_sword" },
      { itemId: "leather_jerkin" },
      { itemId: "chainmail" },
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
      { itemId: "healing_potion" },
      { itemId: "swift_boots" },
      { itemId: "vigor_ring" },
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
      { itemId: "healing_potion" },
      { itemId: "greater_healing_potion" },
      { itemId: "antidote" },
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
    dialogueBranches: [
      {
        intent: "inquire",
        dc: 11,
        outcomes: {
          crit_success: {
            npcLine: "You watch the animals like I do. Bess won't face south — but she stares at the tavern for hours. Whatever's under there, she hears it.",
            infoReveal: "Tomas's mare reacts to something beneath the tavern, not just the southern fog.",
          },
          success: {
            npcLine: "Aye, you've an eye for it. The beasts started spooking a week before the last fog rolled in. They always know first.",
            infoReveal: "Animals in the valley sense the fog's approach roughly a week early.",
          },
          fail: { npcLine: "Tomas shrugs. \"Horses are horses. Don't read too much into it.\"" },
          crit_fail: { npcLine: "\"You're spooking 'em worse than the fog. Best step back.\"" },
        },
      },
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
    dialogueBranches: [
      {
        intent: "persuade",
        dc: 12,
        outcomes: {
          crit_success: {
            npcLine: "You're alright, you are. Here — the apothecary, Isolde? She buys grave-dirt off the gravekeeper. Regular. Make of that what you will.",
            infoReveal: "Isolde the apothecary regularly buys grave-dirt from Old Hollis.",
          },
          success: {
            npcLine: "Fine, fine. The watch doubled the gate guard last week. Something's got the Captain spooked.",
            infoReveal: "The watch quietly doubled the north-gate guard last week.",
          },
          fail: { npcLine: "Pip grins and pockets nothing. \"Information's not free, friend.\"" },
          crit_fail: { npcLine: "\"You think I'm simple?\" Pip melts into the crowd before you finish." },
        },
      },
      {
        intent: "intimidate",
        dc: 15,
        outcomes: {
          crit_success: {
            npcLine: "Alright! Alright! The Bold Rat in the tavern cellar — that ain't no rat. I seen it. Big as a dog and twice as mean.",
            infoReveal: "Pip swears the cellar's 'Bold Rat' is far larger than any vermin should be.",
          },
          success: { npcLine: "Pip flinches. \"Easy! I'll talk. The south road's been swallowing folk. That's all I know, swear it.\"" },
          fail: { npcLine: "\"Big tough adventurer, scaring children.\" He spits at your boots and won't say more." },
          crit_fail: {
            npcLine: "\"HELP! Thief! THIEF!\" Pip shrieks until heads turn. He won't come near you again.",
            standing: "hostile",
          },
        },
      },
    ],
  },

  // ── Fog Road (hostile — the "Fog-Wolves at the Gate" quest encounter) ──
  {
    id: "fog_wolf_1",
    name: "Fog-Wolf",
    title: "Pack Hunter",
    role: "hostile",
    roomId: "fog_road",
    enemyTemplate: "fog_wolf",
    dialogue: [{ text: "It circles low, hackles raised, breath steaming in the cold." }],
  },
  {
    id: "fog_wolf_2",
    name: "Fog-Wolf",
    title: "Pack Hunter",
    role: "hostile",
    roomId: "fog_road",
    enemyTemplate: "fog_wolf",
    dialogue: [{ text: "It circles low, hackles raised, breath steaming in the cold." }],
  },
  {
    id: "fog_wolf_alpha",
    name: "Pack Alpha",
    title: "Greyfall Beast",
    role: "hostile",
    roomId: "fog_road",
    enemyTemplate: "fog_wolf_alpha",
    dialogue: [{ text: "Larger than the rest, scarred and grey, it does not fear you." }],
  },

  // ── The Heart of the Fog (hostile — the final boss encounter) ──
  {
    id: "the_fogmother",
    name: "The Fogmother",
    title: "Heart of the Greyfall",
    role: "hostile",
    roomId: "fogheart",
    enemyTemplate: "fog_boss",
    dialogue: [{ text: "A voice like wind through gravestones: \"You are small, and the fog is old.\"" }],
  },
];
