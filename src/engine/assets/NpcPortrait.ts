/**
 * NpcPortrait.ts — Procedural placeholder portraits for NPCs
 *
 * NPCs carry no portrait art (see NpcView), so for the sliding dialogue
 * portrait we synthesize a small framed "bust": a hooded silhouette over a
 * role-tinted backdrop, with the NPC's initial. The tint is derived from
 * the NPC role, and a stable hue jitter is hashed from the name so two
 * NPCs of the same role still read as distinct.
 *
 * Pure string assembly (like PortraitCompositor) — returns an <svg> that
 * can be injected via innerHTML. No DOM, no fetch.
 */

import type { NpcRole } from "../../types/npc";

const CANVAS_W = 120;
const CANVAS_H = 150;

/** Base backdrop shades per role — greyscale, distinguished by darkness. */
const ROLE_TINT: Record<NpcRole, { top: string; bottom: string; robe: string }> = {
  questgiver: { top: "#cacaca", bottom: "#9a9a9a", robe: "#6a6a6a" },
  vendor:     { top: "#c2c2c2", bottom: "#909090", robe: "#5e5e5e" },
  hostile:    { top: "#b2b2b2", bottom: "#808080", robe: "#4a4a4a" },
  friendly:   { top: "#cecece", bottom: "#a0a0a0", robe: "#707070" },
  dialogue:   { top: "#c6c6c6", bottom: "#969696", robe: "#666666" },
};

/** Small deterministic hash → 0..1, for stable per-name hue jitter. */
function hash01(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 1000) / 1000;
}

/**
 * Builds a placeholder portrait SVG for an NPC.
 * @param name  NPC display name (used for the initial + hue jitter)
 * @param role  NPC role (drives the backdrop tint)
 */
export function composeNpcPortrait(name: string, role: NpcRole): string {
  const tint = ROLE_TINT[role] ?? ROLE_TINT.dialogue;
  const initial = (name.trim().charAt(0) || "?").toUpperCase();

  // Per-name brightness jitter so same-role NPCs differ slightly (greyscale,
  // so a hue shift would do nothing — vary lightness instead).
  const brightness = (0.9 + hash01(name) * 0.2).toFixed(3); // 0.90–1.10

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${CANVAS_W} ${CANVAS_H}" ` +
    `width="100%" height="100%" preserveAspectRatio="xMidYMid meet" ` +
    `shape-rendering="crispEdges" role="img" aria-label="${escapeAttr(name)}" ` +
    `style="filter:brightness(${brightness})">` +
      `<defs>` +
        `<linearGradient id="np-bg" x1="0" y1="0" x2="0" y2="1">` +
          `<stop offset="0" stop-color="${tint.top}"/>` +
          `<stop offset="1" stop-color="${tint.bottom}"/>` +
        `</linearGradient>` +
      `</defs>` +
      // Backdrop
      `<rect x="0" y="0" width="${CANVAS_W}" height="${CANVAS_H}" fill="url(#np-bg)"/>` +
      // Shoulders / robe
      `<path d="M14 150 Q14 104 60 100 Q106 104 106 150 Z" fill="${tint.robe}"/>` +
      // Hood
      `<path d="M30 96 Q30 40 60 38 Q90 40 90 96 Q60 86 30 96 Z" fill="${shade(tint.robe, -18)}"/>` +
      // Head silhouette
      `<ellipse cx="60" cy="70" rx="22" ry="26" fill="#1f1f1f"/>` +
      // Initial
      `<text x="60" y="80" text-anchor="middle" ` +
        `font-family="'Press Start 2P', monospace" font-size="22" ` +
        `fill="#f0f0f0">${escapeAttr(initial)}</text>` +
    `</svg>`
  );
}

/**
 * Builds a generic placeholder portrait for a *player* (used to show other
 * players' portraits during room chat / NPC conversation, since real portrait
 * specs aren't synced between clients). A bare-headed "adventurer" bust so it
 * reads as distinct from the hooded NPC placeholders.
 */
export function composePlayerPortrait(name: string): string {
  const initial = (name.trim().charAt(0) || "?").toUpperCase();
  const brightness = (0.92 + hash01(name) * 0.16).toFixed(3); // 0.92–1.08

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${CANVAS_W} ${CANVAS_H}" ` +
    `width="100%" height="100%" preserveAspectRatio="xMidYMid meet" ` +
    `shape-rendering="crispEdges" role="img" aria-label="${escapeAttr(name)}" ` +
    `style="filter:brightness(${brightness})">` +
      `<defs>` +
        `<linearGradient id="pp-bg" x1="0" y1="0" x2="0" y2="1">` +
          `<stop offset="0" stop-color="#d0d0d0"/>` +
          `<stop offset="1" stop-color="#9a9a9a"/>` +
        `</linearGradient>` +
      `</defs>` +
      `<rect x="0" y="0" width="${CANVAS_W}" height="${CANVAS_H}" fill="url(#pp-bg)"/>` +
      // Tunic / shoulders (no hood)
      `<path d="M18 150 Q18 106 60 102 Q102 106 102 150 Z" fill="#5e5e5e"/>` +
      // Collar
      `<path d="M44 150 L52 110 L60 122 L68 110 L76 150 Z" fill="#4a4a4a"/>` +
      // Head
      `<ellipse cx="60" cy="68" rx="22" ry="26" fill="#1f1f1f"/>` +
      // Initial
      `<text x="60" y="78" text-anchor="middle" ` +
        `font-family="'Press Start 2P', monospace" font-size="22" ` +
        `fill="#f0f0f0">${escapeAttr(initial)}</text>` +
    `</svg>`
  );
}

/** Lightens/darkens a #rrggbb hex by a percentage (-100..100). */
function shade(hex: string, pct: number): string {
  const n = parseInt(hex.slice(1), 16);
  const amt = Math.round(2.55 * pct);
  const clamp = (v: number): number => Math.max(0, Math.min(255, v));
  const r = clamp((n >> 16) + amt);
  const g = clamp(((n >> 8) & 0xff) + amt);
  const b = clamp((n & 0xff) + amt);
  return "#" + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
}

function escapeAttr(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
