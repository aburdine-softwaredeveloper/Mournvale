/**
 * NpcPortrait.ts — Dialogue portraits for NPCs
 *
 * Named townsfolk have real painted bust art (assets/npcs/<slug>.png,
 * chroma-keyed to transparency and mirrored to face RIGHT, toward the
 * player, since the NPC slot slides in from the left). For NPCs without
 * art (vermin, wolves, generated encounters) we fall back to a synthesized
 * placeholder: a hooded silhouette over a role-tinted backdrop with the
 * NPC's initial.
 *
 * Pure string assembly (like PortraitCompositor) — returns an <svg> that
 * can be injected via innerHTML. No DOM, no fetch (raster art loads lazily
 * through the <image href>).
 */

import type { NpcRole } from "../../types/npc";
import { assetRegistry } from "./AssetRegistry";

const CANVAS_W = 120;
const CANVAS_H = 150;

/** Parchment backdrop + sepia silhouette per role — like an inked sketch on
 *  a page, tinted slightly by role (gold giver, oxblood foe, mossy vendor…). */
const ROLE_TINT: Record<NpcRole, { top: string; bottom: string; robe: string }> = {
  questgiver: { top: "#e4d0a4", bottom: "#cbb07e", robe: "#5a4326" },
  vendor:     { top: "#dcd2a2", bottom: "#c2b67e", robe: "#4e4a2c" },
  hostile:    { top: "#e2c4a2", bottom: "#cda07e", robe: "#5a2e22" },
  friendly:   { top: "#e0cea4", bottom: "#c8b07e", robe: "#4e4630" },
  dialogue:   { top: "#ddcaa0", bottom: "#c6ae7c", robe: "#54432a" },
};

/** Named townsfolk with painted bust art under assets/npcs/<slug>.png. */
const PORTRAIT_ART = new Set([
  "aldric", "marta", "captain_vey", "sister_mara", "old_hollis",
  "borin", "welk", "isolde", "tomas", "pip",
]);

/** "Captain Vey" → "captain_vey" (matches both NPC ids and art filenames). */
function portraitSlug(name: string): string {
  return name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_");
}

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
  const slug = portraitSlug(name);
  if (PORTRAIT_ART.has(slug)) {
    const url = assetRegistry.resolveUrl(`npcs/${slug}`);
    // Bottom-anchored (xMidYMax) so the bust sits on the frame's lower edge,
    // like a speaker leaning into view. image-rendering:auto overrides the
    // frame's pixelated default — this is painted art, not pixel art.
    return (
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${CANVAS_W} ${CANVAS_H}" ` +
      `width="100%" height="100%" preserveAspectRatio="xMidYMax meet" ` +
      `role="img" aria-label="${escapeAttr(name)}" style="image-rendering:auto">` +
        `<image href="${escapeAttr(url)}" x="0" y="0" ` +
          `width="${CANVAS_W}" height="${CANVAS_H}" ` +
          `preserveAspectRatio="xMidYMax meet"/>` +
      `</svg>`
    );
  }

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
      `<ellipse cx="60" cy="70" rx="22" ry="26" fill="#2a2018"/>` +
      // Initial
      `<text x="60" y="80" text-anchor="middle" ` +
        `font-family="'Press Start 2P', monospace" font-size="22" ` +
        `fill="#f0e4c8">${escapeAttr(initial)}</text>` +
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
          `<stop offset="0" stop-color="#e0cda6"/>` +
          `<stop offset="1" stop-color="#c4ac7c"/>` +
        `</linearGradient>` +
      `</defs>` +
      `<rect x="0" y="0" width="${CANVAS_W}" height="${CANVAS_H}" fill="url(#pp-bg)"/>` +
      // Tunic / shoulders (no hood)
      `<path d="M18 150 Q18 106 60 102 Q102 106 102 150 Z" fill="#5a4632"/>` +
      // Collar
      `<path d="M44 150 L52 110 L60 122 L68 110 L76 150 Z" fill="#3e3022"/>` +
      // Head
      `<ellipse cx="60" cy="68" rx="22" ry="26" fill="#2a2018"/>` +
      // Initial
      `<text x="60" y="78" text-anchor="middle" ` +
        `font-family="'Press Start 2P', monospace" font-size="22" ` +
        `fill="#f0e4c8">${escapeAttr(initial)}</text>` +
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
