# Mournvale — Image Asset Manifest

Every PNG the game loads, where it lives, and its status. Combat-tile art is
intentionally out of scope here.

Conventions:
- **Room tiles** — `public/assets/tiles/{artKey}.png`, 256×256. Overwrite in
  place to reskin; no code change needed. Regenerate placeholders with
  `node scripts/make-placeholder-tiles.mjs`.
- **Portraits** — `public/assets/characters/portraits/{gender}_{hair}_{class}.png`
  (lowercased), resolved by `AssetRegistry` / composited by `PortraitCompositor`.
- **Glasses overlay** — `public/assets/characters/glasses/{gender}.png`, layered
  on the portrait at a fixed offset.

Status legend: ✅ shipped (placeholder art) · 🆕 newly created placeholder · ⬜ not yet made (procedural fallback in use)

---

## 1. Room Tiles — `public/assets/tiles/{artKey}.png`

15 rooms, each now with its **own** art key (the cellar / fog road / fogheart
previously reused another room's tile — fixed).

| artKey | Room name | Status | Description for the artist |
|---|---|---|---|
| `tavern` | The Broken Lantern | ✅ | imDly lit tavern; ale and wet wood, candles on rough tables, weathered keeper behind the bar |
| `cellar` | The Broken Lantern — Cellar | 🆕 | Low, damp undercroft; ale casks, splintered crates, mildew, rats skittering in the dark between barrels |
| `street` | Cobblestone Street | ✅ | Narrow street worn smooth; iron lanterns swaying in damp air, tavern glow to the south |
| `market_square` | Market Square | ✅ | Stalls under patched awnings, townsfolk bartering, a cracked dry fountain of grey rainwater at center |
| `smithy` | The Iron Hearth | ✅ | Forge heat in waves, half-finished blades on the walls, soot on every surface |
| `general_store` | Welk's Sundries | ✅ | Shelves crammed with rope, lamp oil, dried goods; an open ledger on the counter |
| `north_gate` | The North Gate | ✅ | Heavy iron-banded timber gate, a guard watching the treeline, road vanishing into grey fog |
| `chapel` | Chapel of the Still Light | ✅ | Modest stone chapel, dark windows, worn pews, a single candle at the altar; deliberate silence |
| `graveyard` | The Old Graveyard | ✅ | Leaning headstones in mist like crooked teeth, wet silver grass, a distant crow |
| `apothecary` | The Greenglass Apothecary | ✅ | Dried herbs on the beams, green glass bottles in a hundred shades, bitter-root air |
| `stables` | The Stables | ✅ | Warm with horse-breath and hay, tack in neat rows, a dark-eyed patient mare |
| `guard_post` | The Guard Post | ✅ | Cramped watch-house, weapon rack, cold hearth, valley map with fog-swallowed roads charcoaled out |
| `south_road` | The South Road | ✅ | Town thins to nothing; road dissolving into the breathing Greyfall |
| `fog_road` | The Fog Road | 🆕 | Rutted track swallowed by Greyfall; dead trees, lean grey fog-wolves loping between them |
| `fogheart` | The Heart of the Fog | 🆕 | Fog almost solid, coiling like a living thing; something vast at center — the Fogmother's lair |

All tiles are greyscale placeholders (diagonal-X pattern). Highest-priority
originals: `fog_road` and `fogheart` (the boss approach), then `cellar`.

---

## 2. Character-Creation Portraits — `public/assets/characters/portraits/`

Combinatorial matrix: **2 genders × 3 hair colors × 7 classes = 42 portraits.**
All 42 exist as placeholders. Filename pattern: `{gender}_{hair}_{class}.png`
(all lowercase, e.g. `female_blonde_mage.png`).

- **Genders:** Male, Female
- **Hair colors:** Black, Brown, Blonde
- **Classes:** Knight, Healer, Warrior, Monk, Mage, Thief, Archer

Glasses are **not** baked into these — they're a separate overlay, so there is
no ×2 explosion.

### Glasses overlay — `public/assets/characters/glasses/`
| File | Status |
|---|---|
| `male.png` | ✅ |
| `female.png` | ✅ |

Layered over the portrait at a fixed offset by `PortraitCompositor`; must line
up with the portrait's face position across all classes.

---

## 3. NPC Portraits — `public/assets/characters/npcs/{id}.png` ⬜ (planned)

**Currently procedural** — synthesized as SVG busts at runtime by
`NpcPortrait.ts` (hooded silhouette, role-tinted, NPC's initial). Being replaced
with hand-drawn PNGs. 10 talking/quest NPCs:

| id | Name | Title / Role | Room | Character notes |
|---|---|---|---|---|
| `aldric` | Aldric | Barkeep (questgiver) | Tavern | Weathered, gruff, soft-hearted under it |
| `marta` | Marta | Serving Maid (friendly) | Tavern | Knows secrets, wary, kind |
| `captain_vey` | Captain Vey | Watch Captain (questgiver) | Guard Post | Hard-edged veteran, buries men who talk too much |
| `sister_mara` | Sister Mara | Chaplain (questgiver) | Chapel | Keeps the Still Light's vigil |
| `old_hollis` | Old Hollis | Gravekeeper (questgiver) | Graveyard | Prefers the company of the dead |
| `borin` | Borin | Blacksmith (vendor) | Smithy | Blunt, honest, steel-and-soot |
| `welk` | Welk | Shopkeeper (vendor) | General Store | Dry wit, seen-it-all |
| `isolde` | Isolde | Apothecary (vendor) | Apothecary | Secretive; buys grave-dirt |
| `tomas` | Tomas | Stable-hand (dialogue) | Stables | Reads the animals, quiet |
| `pip` | Pip | Street Urchin (friendly) | Market Square | Sees everything, sells information |

> **Note:** wiring a PNG path here requires a code change in `NpcPortrait.ts` /
> the NPC view to prefer a real PNG when present and fall back to the SVG.
> Full dialogue lives in `src/server/world/npcs.ts`.

---

## 4. Enemies — ⬜ optional (data-only today)

Combat is tile-based with no enemy portraits. If art is wanted later, roster
from `src/server/combat/enemyTemplates.ts`:

Cellar Rat · Bold Rat · Fog-Wolf · Pack Alpha · Road Bandit · Greyfall Ghoul ·
Fog Shade · Hollow Wraith · The Fogmother (boss).

---

## 5. Item Icons — ⬜ optional (text-only today)

Inventory/shop panels render items as text. 16 items in `src/types/items.ts` if
icons are wanted: Iron Sword, Fogsteel Axe, Hunting Bow, Leather Jerkin,
Chainmail, Warden's Plate, Ring of Vigor, Amulet of Might, Boots of the Swift,
Healing Potion, Greater Healing Potion, Antidote, Lantern of Warding,
Bellringer's Seal, Fogbreaker's Crown.

---

## Summary of outstanding work

| Priority | Asset | Count | Status |
|---|---|---|---|
| 1 | New room tiles (`cellar`, `fog_road`, `fogheart`) | 3 | 🆕 placeholders in place — replace with real art |
| 2 | NPC portrait PNGs (replacing SVG) | 10 | ⬜ needs art + small code change |
| 3 | Reskin existing room tiles | 12 | ✅ placeholders — drop-in replace |
| 3 | Reskin creation portraits | 42 | ✅ placeholders — drop-in replace |
| — | Enemy art | 9 | ⬜ optional |
| — | Item icons | 16 | ⬜ optional |
