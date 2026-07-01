/**
 * make-placeholder-tiles.mjs — Generate palette-matched room-tile PNGs
 *
 * The room art pipeline uses PNG (not SVG) so hand-made pixel art can be
 * dropped straight in. Rather than flat greyscale placeholders, this script
 * paints one atmospheric, framed tile per room using the game's own CSS
 * palette (see :root in src/client/style.css) so the map reads as part of the
 * book/parchment UI. Each room gets a distinct accent tone (warm hearth,
 * cold Greyfall fog, graveyard moss, etc.) drawn from that palette.
 *
 * Zero dependencies — emits a valid 8-bit truecolour PNG by hand (zlib is the
 * only thing used, from Node's stdlib). Re-run any time to regenerate:
 *
 *   node scripts/make-placeholder-tiles.mjs
 *
 * To add your own art later, just overwrite public/assets/tiles/<name>.png.
 */

import { deflateSync } from "node:zlib";
import { writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const TILE_DIR = join(__dirname, "..", "public", "assets", "tiles");

const SIZE = 256;

// ── Palette (mirrors :root in src/client/style.css) ──────────────────────────
const PAGE_BASE = hex("#ece4cf"); // bright cream page
const PAGE_DEEP = hex("#ddd2b6"); // aged page (deeper)
const SHELL = hex("#2b2622"); // dark leather shell
const BORDER = hex("#7a6344"); // worn ink / leather edge
const BORDER_GOLD = hex("#8a5a2c"); // burnt sienna frame

/**
 * Per-room accent + mood. `accent` tints the scene; `deep` is the vignette
 * floor (corners). All values are pulled from — or blended toward — the CSS
 * palette so tiles sit inside the parchment UI. Keys match artKeys in
 * src/server/world/rooms.ts.
 */
const ROOMS = {
  // Warm, lived-in town interiors — hearth ambers over the tan page.
  tavern:        { accent: "#c8934a", deep: "#3a2a18" },
  cellar:        { accent: "#6e5c42", deep: "#241d14" },
  smithy:        { accent: "#c0632c", deep: "#2a1810" },
  general_store: { accent: "#b79a5e", deep: "#3a2f1c" },
  stables:       { accent: "#a9843f", deep: "#332512" },
  guard_post:    { accent: "#8a7350", deep: "#2c2417" },
  apothecary:    { accent: "#6f8a4a", deep: "#243019" }, // greenglass
  // Town open-air — cooler tan, grey stone.
  cobblestone_street: { accent: "#9a8a68", deep: "#2f2a20" },
  street:        { accent: "#9a8a68", deep: "#2f2a20" }, // artKey alias
  market_square: { accent: "#b0a074", deep: "#332d1e" },
  // The Greyfall edge — cold desaturated fog encroaching.
  north_gate:    { accent: "#9aa2a0", deep: "#2a2c2b" },
  chapel:        { accent: "#c9bd8e", deep: "#2d2a1f" }, // still candlelight
  graveyard:     { accent: "#7f8a76", deep: "#242823" }, // moss + mist
  south_road:    { accent: "#8f9490", deep: "#262826" },
  fog_road:      { accent: "#7d8488", deep: "#202324" },
  fogheart:      { accent: "#5a86a6", deep: "#161c22" }, // the cold blue heart
};

// ── Color helpers ────────────────────────────────────────────────────────────
function hex(s) {
  const n = parseInt(s.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
const clamp = (v) => (v < 0 ? 0 : v > 255 ? 255 : v | 0);
function mix(a, b, t) {
  return [
    clamp(a[0] + (b[0] - a[0]) * t),
    clamp(a[1] + (b[1] - a[1]) * t),
    clamp(a[2] + (b[2] - a[2]) * t),
  ];
}

// ── CRC32 (PNG chunk checksums) ──────────────────────────────────────────────
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, "ascii");
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

/** Deterministic per-tile pseudo-random (stable output across runs). */
function makeRng(seed) {
  let s = 2166136261 >>> 0;
  for (let i = 0; i < seed.length; i++) { s ^= seed.charCodeAt(i); s = Math.imul(s, 16777619); }
  return () => {
    s ^= s << 13; s ^= s >>> 17; s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
}

/**
 * Paints one room tile: a soft light-source vignette in the room's accent
 * over a deep floor, a subtle parchment grain, then the double leather+sienna
 * frame that matches the UI's page borders.
 */
function makePng(name, room) {
  const accent = hex(room.accent);
  const deep = hex(room.deep);
  const rng = makeRng(name);

  const raw = Buffer.alloc((SIZE * 3 + 1) * SIZE);
  let p = 0;
  const cx = SIZE * 0.5;
  const cy = SIZE * 0.42; // light source a touch above center
  const maxR = Math.hypot(SIZE, SIZE) * 0.5;

  for (let y = 0; y < SIZE; y++) {
    raw[p++] = 0; // filter: none
    for (let x = 0; x < SIZE; x++) {
      const b = 7; // frame thickness
      let col;
      if (x < b || y < b || x >= SIZE - b || y >= SIZE - b) {
        col = SHELL; // dark leather shell edge
      } else if (x < b + 5 || y < b + 5 || x >= SIZE - b - 5 || y >= SIZE - b - 5) {
        col = BORDER_GOLD; // burnt-sienna inner frame line
      } else if (x < b + 8 || y < b + 8 || x >= SIZE - b - 8 || y >= SIZE - b - 8) {
        col = BORDER;
      } else {
        // Radial vignette: accent-lit center falling to the deep floor.
        const d = Math.min(1, Math.hypot(x - cx, y - cy) / maxR);
        const light = Math.pow(1 - d, 1.7); // 1 at the light source → 0 at the edge
        col = mix(deep, accent, light);
        // Warm the very center toward the cream page for a "glow".
        col = mix(col, PAGE_DEEP, light * light * 0.18);
        // Parchment grain + faint scanline so it isn't a flat gradient.
        const grain = (rng() - 0.5) * 14 + (y % 3 === 0 ? -4 : 0);
        col = [clamp(col[0] + grain), clamp(col[1] + grain), clamp(col[2] + grain)];
      }
      raw[p++] = col[0];
      raw[p++] = col[1];
      raw[p++] = col[2];
    }
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(SIZE, 0);
  ihdr.writeUInt32BE(SIZE, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // color type: truecolour (RGB)
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  return Buffer.concat([
    sig,
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// The tile files the game loads (artKeys from src/server/world/rooms.ts).
const TILES = [
  "tavern", "street", "market_square", "smithy", "general_store",
  "north_gate", "chapel", "graveyard", "apothecary", "stables",
  "guard_post", "south_road", "cellar", "fog_road", "fogheart",
];

mkdirSync(TILE_DIR, { recursive: true });
for (const name of TILES) {
  const room = ROOMS[name] ?? { accent: "#9a8a68", deep: "#2f2a20" };
  writeFileSync(join(TILE_DIR, `${name}.png`), makePng(name, room));
}
console.log(`Wrote ${TILES.length} palette-matched tiles to ${TILE_DIR}`);
