/**
 * make-town-map.mjs — Build the town-map popup art from img/town_map.jpg
 *
 * Same pipeline as make-room-tiles.mjs, but for the single full-town map shown
 * by the Map [M] popup (MapPanel.ts), kept at the source's native 1408×768 so
 * the place labels stay legible:
 *
 *   1. sips converts img/town_map.jpg → a temp full-size PNG (macOS, zero deps).
 *   2. Luminance is remapped through the same warm ink ramp (--ink shadows →
 *      --page-base highlights) so the map reads as the same sepia illustration
 *      style as the room tiles.
 *   3. Edges fade toward --page-shadow and a thin ink rule on a cream margin
 *      frames the drawing, seating it on the parchment page.
 *
 * Output: public/assets/ui/town_map.png  (key "ui/town_map")
 *
 * Re-run any time img/town_map.jpg changes:
 *
 *   node scripts/make-town-map.mjs
 */

import { execFileSync } from "node:child_process";
import { inflateSync, deflateSync } from "node:zlib";
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const SRC = join(ROOT, "img", "town_map.jpg");
const OUT_DIR = join(ROOT, "public", "assets", "ui");
const OUT = join(OUT_DIR, "town_map.png");

const W = 1408;
const H = 768;

// ── Palette (mirrors :root in src/client/style.css) ──────────────────────────
const INK = hex("#382f22");
const INK_DIM = hex("#6e5c42");
const PAGE_DEEP = hex("#ddd2b6");
const PAGE_BASE = hex("#ece4cf");
const PAGE_SHADOW = hex("#c7b994");

const INK_RAMP = [
  [0.0, INK],
  [0.4, INK_DIM],
  [0.78, PAGE_DEEP],
  [1.0, PAGE_BASE],
];

const CONTRAST = 1.15;
const VIGNETTE = 0.22;

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
  let pos = 8;
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
    pos += 12 + len;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const px = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const inRow = y * (stride + 1) + 1;
    const outRow = y * stride;
    for (let i = 0; i < stride; i++) {
      const rawByte = raw[inRow + i];
      const a = i >= channels ? px[outRow + i - channels] : 0;
      const b = y > 0 ? px[outRow - stride + i] : 0;
      const c = i >= channels && y > 0 ? px[outRow - stride + i - channels] : 0;
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
  const raw = Buffer.alloc((W * 3 + 1) * H);
  let p = 0;
  for (let y = 0; y < H; y++) {
    raw[p++] = 0;
    rgb.copy(raw, p, y * W * 3, (y + 1) * W * 3);
    p += W * 3;
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(W, 0);
  ihdr.writeUInt32BE(H, 4);
  ihdr[8] = 8; ihdr[9] = 2;
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  return Buffer.concat([
    sig,
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

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

// ── Grade the decoded map into a sepia ink drawing on the page ───────────────
function grade({ width, height, channels, px }) {
  const out = Buffer.alloc(W * H * 3);
  const cx = W / 2, cy = H / 2;
  const margin = 8;
  const rule = 3;
  const inset = margin + rule;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const o = (y * W + x) * 3;
      const edge = Math.min(x, y, W - 1 - x, H - 1 - y);
      let col;
      if (edge < margin) {
        col = PAGE_BASE;
      } else if (edge < inset) {
        col = INK_DIM;
      } else {
        const sx = Math.min(width - 1, (x * width / W) | 0);
        const sy = Math.min(height - 1, (y * height / H) | 0);
        const s = (sy * width + sx) * channels;
        let lum = (0.299 * px[s] + 0.587 * px[s + 1] + 0.114 * px[s + 2]) / 255;
        lum = clamp01(0.5 + (lum - 0.5) * CONTRAST);
        col = inkRamp(lum);
        // Elliptical vignette (rectangular canvas) toward the page shadow.
        const d = Math.min(1, Math.hypot((x - cx) / cx, (y - cy) / cy));
        col = mix(col, PAGE_SHADOW, Math.pow(d, 2.4) * VIGNETTE);
      }
      out[o] = clamp(col[0]); out[o + 1] = clamp(col[1]); out[o + 2] = clamp(col[2]);
    }
  }
  return out;
}

// ── Run ──────────────────────────────────────────────────────────────────────
mkdirSync(OUT_DIR, { recursive: true });
const tmp = mkdtempSync(join(tmpdir(), "mournvale-map-"));
try {
  const tmpPng = join(tmp, "town_map.png");
  execFileSync("sips", ["-s", "format", "png", "-z", String(H), String(W), SRC, "--out", tmpPng], { stdio: "ignore" });
  writeFileSync(OUT, encodeRgb(grade(decodePng(readFileSync(tmpPng)))));
  console.log(`Built palette-graded town map → ${OUT}`);
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
