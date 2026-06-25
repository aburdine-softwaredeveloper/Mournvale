/**
 * make-placeholder-tiles.mjs — Generate placeholder room-tile PNGs
 *
 * The room art pipeline now uses PNG (not SVG) so hand-made pixel art can be
 * dropped straight in. This script writes a simple greyscale placeholder PNG
 * per room tile so the game renders something until real art replaces it.
 *
 * Zero dependencies — emits a valid 8-bit greyscale PNG by hand (zlib is the
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

/** Tile names — must match the rooms' artKeys in src/server/world/rooms.ts. */
const TILES = [
  "tavern", "street", "market_square", "smithy", "general_store",
  "north_gate", "chapel", "graveyard", "apothecary", "stables",
  "guard_post", "south_road",
];

const SIZE = 256;

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

/** Tiny deterministic hash so each tile gets a slightly different shade. */
function hash(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0) % 1000 / 1000;
}

/** Builds the greyscale pixel value (0..255) for one pixel of a placeholder. */
function pixel(x, y, base) {
  const b = 5; // border thickness
  if (x < b || y < b || x >= SIZE - b || y >= SIZE - b) return 96; // dark frame
  // Big diagonal "X" so it reads clearly as a placeholder.
  if (Math.abs(x - y) < 2 || Math.abs(x - (SIZE - 1 - y)) < 2) return 140;
  // Centered hollow box outline.
  const lo = 72, hi = SIZE - 72;
  const onBox =
    ((x === lo || x === hi) && y >= lo && y <= hi) ||
    ((y === lo || y === hi) && x >= lo && x <= hi);
  if (onBox) return 120;
  return base;
}

function makePng(name) {
  const base = Math.round(202 + hash(name) * 26); // 202..228 light grey
  // Raw scanlines: each row prefixed with a filter byte (0 = none).
  const raw = Buffer.alloc((SIZE + 1) * SIZE);
  let p = 0;
  for (let y = 0; y < SIZE; y++) {
    raw[p++] = 0; // filter: none
    for (let x = 0; x < SIZE; x++) raw[p++] = pixel(x, y, base);
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(SIZE, 0);
  ihdr.writeUInt32BE(SIZE, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 0;  // color type: greyscale
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace

  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  return Buffer.concat([
    sig,
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

mkdirSync(TILE_DIR, { recursive: true });
for (const name of TILES) {
  writeFileSync(join(TILE_DIR, `${name}.png`), makePng(name));
}
console.log(`Wrote ${TILES.length} placeholder tiles to ${TILE_DIR}`);
