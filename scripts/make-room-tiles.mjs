/**
 * make-room-tiles.mjs — Build room-tile PNGs from the source art in img/
 *
 * The painted room art lives in img/ as JPEGs. This script converts each one
 * to a 256×256 PNG and redraws it as a sepia ink illustration in the game's
 * own page + ink colours (see :root in src/client/style.css), so every tile
 * looks hand-drawn onto the parchment page of the book UI:
 *
 *   1. sips converts img/<src>.jpg → a temp 256×256 PNG (macOS, zero deps).
 *   2. We decode that PNG in pure Node, reduce it to luminance, and remap it
 *      through a warm ink ramp (--ink shadows → --page-base highlights) — a
 *      full duotone, so only page/ink tones remain.
 *   3. Edges fade toward --page-shadow to seat the drawing on the page, and a
 *      thin ink rule on a bare cream margin frames each sketch.
 *
 * Re-run any time the source art changes:
 *
 *   node scripts/make-room-tiles.mjs
 *
 * Only Node stdlib + macOS `sips` are used (no npm image deps).
 */

import { execFileSync } from "node:child_process";
import { inflateSync, deflateSync } from "node:zlib";
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const IMG_DIR = join(ROOT, "img");
const TILE_DIR = join(ROOT, "public", "assets", "tiles");

const SIZE = 256;

// Source JPEG (in img/) → tile artKey (from src/server/world/rooms.ts).
const MAP = {
  CobblestoneStreet: "street",
  apothecary: "apothecary",
  cellar: "cellar",
  chapel: "chapel",
  fog_road: "fog_road",
  fogheart: "fogheart",
  general_store: "general_store",
  graveyard: "graveyard",
  guard_post: "guard_post",
  market_square: "market_square",
  north_gate: "north_gate",
  smithy: "smithy",
  south_road: "south_road",
  stables: "stables",
  tavern: "tavern",
};

// ── Palette (mirrors :root in src/client/style.css) ──────────────────────────
// The whole image is remapped into ONLY these page + ink tones, so each tile
// reads as a sepia illustration drawn onto the parchment page.
const INK = hex("#382f22"); // darkest ink (deepest shadow)
const INK_DIM = hex("#6e5c42"); // faded ink (midtone, --color-text-dim)
const PAGE_DEEP = hex("#ddd2b6"); // aged page (upper midtone)
const PAGE_BASE = hex("#ece4cf"); // bright cream page (highlight / margin)
const PAGE_SHADOW = hex("#c7b994"); // page shadow / edge

// Warm ink ramp, dark → light. Luminance is mapped through these stops so the
// art becomes a single sepia wash in the page's own colours.
const INK_RAMP = [
  [0.0, INK],
  [0.4, INK_DIM],
  [0.78, PAGE_DEEP],
  [1.0, PAGE_BASE],
];

const CONTRAST = 1.15; // gentle S-curve so the ink drawing keeps its snap
const VIGNETTE = 0.22; // edge fade toward page-shadow, seating art on the page

function hex(s) {
  const n = parseInt(s.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
const clamp = (v) => (v < 0 ? 0 : v > 255 ? 255 : v | 0);
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
function mix(a, b, t) {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

// ── Minimal PNG decode (8-bit, non-interlaced, colour type 2 or 6) ───────────
function decodePng(buf) {
  let pos = 8; // skip signature
  let width = 0, height = 0, channels = 3;
  const idat = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString("ascii", pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + len);
    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      const colorType = data[9];
      if (data[8] !== 8) throw new Error(`unexpected bit depth ${data[8]}`);
      if (colorType === 2) channels = 3;
      else if (colorType === 6) channels = 4;
      else throw new Error(`unsupported colour type ${colorType}`);
    } else if (type === "IDAT") {
      idat.push(data);
    } else if (type === "IEND") {
      break;
    }
    pos += 12 + len; // len + type + data + crc
  }
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const px = Buffer.alloc(stride * height); // defiltered, still `channels`-wide
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const inRow = y * (stride + 1) + 1;
    const outRow = y * stride;
    for (let i = 0; i < stride; i++) {
      const rawByte = raw[inRow + i];
      const a = i >= channels ? px[outRow + i - channels] : 0; // left
      const b = y > 0 ? px[outRow - stride + i] : 0; // up
      const c = i >= channels && y > 0 ? px[outRow - stride + i - channels] : 0; // up-left
      let val;
      switch (filter) {
        case 0: val = rawByte; break;
        case 1: val = rawByte + a; break;
        case 2: val = rawByte + b; break;
        case 3: val = rawByte + ((a + b) >> 1); break;
        case 4: {
          const p = a + b - c;
          const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
          val = rawByte + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c);
          break;
        }
        default: throw new Error(`bad filter ${filter}`);
      }
      px[outRow + i] = val & 0xff;
    }
  }
  return { width, height, channels, px };
}

// ── PNG encode (8-bit RGB) ───────────────────────────────────────────────────
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
function encodeRgb(rgb) {
  const raw = Buffer.alloc((SIZE * 3 + 1) * SIZE);
  let p = 0;
  for (let y = 0; y < SIZE; y++) {
    raw[p++] = 0; // filter: none
    rgb.copy(raw, p, y * SIZE * 3, (y + 1) * SIZE * 3);
    p += SIZE * 3;
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(SIZE, 0);
  ihdr.writeUInt32BE(SIZE, 4);
  ihdr[8] = 8; ihdr[9] = 2; // 8-bit truecolour
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  return Buffer.concat([
    sig,
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/** Map a 0..1 luminance to a colour along the warm ink ramp. */
function inkRamp(t) {
  for (let i = 1; i < INK_RAMP.length; i++) {
    const [t1, c1] = INK_RAMP[i];
    if (t <= t1) {
      const [t0, c0] = INK_RAMP[i - 1];
      return mix(c0, c1, (t - t0) / (t1 - t0));
    }
  }
  return INK_RAMP[INK_RAMP.length - 1][1].slice();
}

// ── Grade one decoded image into a sepia ink drawing on the page ─────────────
function grade({ width, height, channels, px }) {
  const out = Buffer.alloc(SIZE * SIZE * 3);
  const cx = SIZE / 2, cy = SIZE / 2;
  const maxR = Math.hypot(cx, cy);
  const margin = 6; // cream page margin around the drawing
  const rule = 2; // thin ink frame rule
  const inset = margin + rule;
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const o = (y * SIZE + x) * 3;
      const edge = Math.min(x, y, SIZE - 1 - x, SIZE - 1 - y);
      let col;
      if (edge < margin) {
        col = PAGE_BASE; // bare page around the drawing
      } else if (edge < inset) {
        col = INK_DIM; // thin ink rule framing the sketch
      } else {
        // Nearest-sample the source (already ~256², so effectively 1:1).
        const sx = Math.min(width - 1, (x * width / SIZE) | 0);
        const sy = Math.min(height - 1, (y * height / SIZE) | 0);
        const s = (sy * width + sx) * channels;
        // Luminance → gentle contrast curve → warm ink ramp (full duotone).
        let lum = (0.299 * px[s] + 0.587 * px[s + 1] + 0.114 * px[s + 2]) / 255;
        lum = clamp01(0.5 + (lum - 0.5) * CONTRAST);
        col = inkRamp(lum);
        // Seat the drawing on the page: fade edges toward the page shadow.
        const d = Math.min(1, Math.hypot(x - cx, y - cy) / maxR);
        col = mix(col, PAGE_SHADOW, Math.pow(d, 2.4) * VIGNETTE);
      }
      out[o] = clamp(col[0]); out[o + 1] = clamp(col[1]); out[o + 2] = clamp(col[2]);
    }
  }
  return out;
}

// ── Run ──────────────────────────────────────────────────────────────────────
mkdirSync(TILE_DIR, { recursive: true });
const tmp = mkdtempSync(join(tmpdir(), "mournvale-tiles-"));
try {
  let n = 0;
  for (const [src, key] of Object.entries(MAP)) {
    const jpg = join(IMG_DIR, `${src}.jpg`);
    const tmpPng = join(tmp, `${key}.png`);
    execFileSync("sips", ["-s", "format", "png", "-z", String(SIZE), String(SIZE), jpg, "--out", tmpPng], { stdio: "ignore" });
    const decoded = decodePng(readFileSync(tmpPng));
    writeFileSync(join(TILE_DIR, `${key}.png`), encodeRgb(grade(decoded)));
    n++;
  }
  console.log(`Built ${n} palette-graded room tiles from img/ → ${TILE_DIR}`);
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
