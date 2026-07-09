# Mournvale

*Mournvale* is a multiplayer online role-playing game developed and published
by the independent developer **aburdine.softwaredeveloper**. Played entirely in
a web browser, it combines the text-command tradition of the MUD
(multi-user dungeon) genre with illustrated rooms, portrait-driven dialogue,
and turn-based tactical grid combat. The game is presented as a rustic,
leather-bound spellbook: menus open like a book's cover, and the world is read
across two facing parchment pages.

| | |
|---|---|
| **Developer** | aburdine.softwaredeveloper |
| **Engine** | Custom (TypeScript) |
| **Platform** | Web browser (desktop and mobile) |
| **Genre** | MUD / tactical role-playing game |
| **Mode** | Single-player, co-operative multiplayer |
| **Input** | Text commands and point-and-click |

## Setting

The game takes place in Mournvale, a grim gothic village slowly being consumed
by an unnatural fog. Wolves press at the gates, the chapel bell has fallen
silent, and caravans vanish on the south road. At the heart of the blight
waits **the Fogmother**, the campaign's final adversary. The player arrives as
a traveler and gradually uncovers the source of the fog by talking to the
village's ten named townsfolk — among them Captain Vey of the guard, Sister
Mara of the chapel, the gravekeeper Old Hollis, and the smith Borin — each
depicted with a painted portrait bust during conversation.

## Gameplay

Players create a character from one of seven classes — Knight, Healer,
Warrior, Monk, Mage, Thief, or Archer — with rolled ability scores, class
talent trees, and equippable abilities gained through leveling. The world is
navigated room-to-room in classic MUD fashion, but every room is illustrated,
and common actions (moving, looking, talking, trading, fighting) are also
available as buttons alongside the free-text command line.

### Combat

Combat is server-resolved, turn-based, and fought on an 8×8 tactical grid that
can be viewed flat or in a 2.5D isometric projection reminiscent of *Final
Fantasy Tactics*. Terrain matters: rubble slows movement, cover grants armor,
smoldering embers burn those who cross them, and some battlefields feature
raised elevation. Each round, every combatant plans a move and an action
(attack, class ability, or defense); abilities have ranges, elemental visual
effects, and animated projectiles. Parties of players fight together in the
same battle, and hostile creatures — from cellar rats to fog wolves and the
Fogmother herself — are rebalanced per encounter through a template system.

### Dialogue and social systems

Non-player characters converse in free text. When a local large language model
is available the NPCs improvise in character; otherwise they fall back to
authored dialogue. Social maneuvers — *persuade*, *intimidate*, *inquire*, and
*deceive* — trigger dice-based skill checks whose difficulty shifts with the
NPC's disposition toward the player. Disposition drifts across conversations
and persists between sessions: intimidation wins arguments but sours
relationships, and being caught in a lie is the harshest social penalty in the
game. Rumors about a player's deeds and misdeeds spread from NPC to NPC
through the town, so a shopkeeper may already distrust a player they have
never met.

### Quests and progression

Quests are taken from a board and span five objective types: clearing
hostiles, gathering, scouting, investigating, and delivery. Story quests are
gated by **lore** — knowledge the player picks up by talking to the right
townsfolk — so conversation, not combat alone, advances the campaign. Locked
quests appear as rumors until their prerequisite lore is learned. Completing
the campaign's final quest against the Fogmother triggers a cinematic
epilogue in which the fog lifts from the village. Characters accumulate
experience, talent points, gold, and equipment; loot drops from defeated
enemies, and three village vendors buy and sell gear.

### Multiplayer

Any number of players can inhabit the same persistent world. Players see one
another in rooms, speak in local chat, form parties, share quest rewards, and
are pulled into one another's battles. Each browser maintains private save
slots; progress is saved automatically. The game is playable on mobile
devices, with a portrait layout and touch-sized controls.

## Development

*Mournvale* was built in 2026 as a solo project. The architecture is
deliberately server-authoritative: a Node.js server owns all game state and
streams lightweight view snapshots to clients over WebSocket, while the client
is framework-free TypeScript and DOM. NPC improvisation is powered by a
locally hosted language model via Ollama, keeping dialogue free of external
API dependence — game-mechanical outcomes remain governed by server-side dice
rather than the model. The soundtrack is generated procedurally in the
browser with the Web Audio API: a droning, bell-struck town theme and a
percussive combat theme crossfade as fights begin and end. All art follows a
documented parchment-and-ink palette, from the torn-edged page panels to the
sepia room illustrations.

## External links

- [Source repository](https://github.com/aburdine-softwaredeveloper/Mournvale)
