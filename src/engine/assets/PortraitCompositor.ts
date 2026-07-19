/**
 * PortraitCompositor.ts — Builds a character portrait as inline SVG
 *
 * Portraits are full-body sprites selected by (gender, hairColor, class).
 * Each is a single PNG; the compositor wraps it in an <svg> with an
 * <image> element so it can be injected via innerHTML and scaled with
 * crisp pixel edges. When the character wears glasses, a second <image>
 * (the gender-appropriate glasses overlay) is layered on top at a fixed
 * face offset.
 *
 * The sprites are normalized to a uniform 152x184 canvas with the face
 * at a consistent position, so the glasses overlay uses one fixed offset
 * rather than per-sprite tuning. (Tall hats like the mage's sit a little
 * high — an accepted tradeoff for placeholder art.)
 *
 * Architecture: depends on AssetRegistry only for URL construction; it
 * performs pure string assembly and no DOM work. The PNGs load lazily
 * via the <image> href, so no fetch/preload is required for portraits.
 */

import { assetRegistry } from "./AssetRegistry";

// ─────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────

/** The fields needed to pick and render a portrait */
export interface PortraitSpec {
  gender: "Male" | "Female";
  characterClass: string;
  hairColor: string;
  glasses: boolean;
}

// ─────────────────────────────────────────────
// LAYOUT CONSTANTS
// ─────────────────────────────────────────────

/** The normalized portrait canvas (matches the extracted PNG dimensions) */
const CANVAS_W = 152;
const CANVAS_H = 184;

/** Glasses overlay geometry within the canvas (face is centered near top) */
const GLASSES_W = 44;
const GLASSES_Y = 35;
/** Glasses PNGs are ~3.3:1; derive height from width to keep aspect */
const GLASSES_H = 13;
const GLASSES_X = Math.round((CANVAS_W - GLASSES_W) / 2);

/**
 * Classes whose art ships a baked-in glasses variant (`_glasses.png`) with
 * spectacles drawn to match that art's face. For these we swap in the
 * pre-drawn portrait instead of layering the generic overlay, which is
 * tuned for the chibi placeholder faces and won't line up. Keyed by
 * `{gender}_{class}` (lowercase). Extend as more class art lands.
 */
const BAKED_GLASSES = new Set<string>([
  "female_archer",
  "male_healer",
  "male_knight",
  "male_warrior",
  "male_mage",
]);

// ─────────────────────────────────────────────
// COMPOSITOR
// ─────────────────────────────────────────────

export class PortraitCompositor {
  /**
   * Builds a portrait SVG string for the given spec. Synchronous — the
   * referenced PNGs load lazily in the browser when the SVG renders.
   */
  public compose(spec: PortraitSpec): string {
    // Prefer a baked-in glasses portrait when the class provides one; those
    // spectacles are drawn onto the art, so no overlay is needed.
    const key = `${spec.gender.toLowerCase()}_${spec.characterClass.toLowerCase()}`;
    const useBaked = spec.glasses && BAKED_GLASSES.has(key);

    const portraitUrl = assetRegistry.portraitUrl(
      spec.gender,
      spec.hairColor,
      spec.characterClass,
      useBaked
    );

    const layers: string[] = [
      `<image href="${portraitUrl}" x="0" y="0" ` +
        `width="${CANVAS_W}" height="${CANVAS_H}" ` +
        `style="image-rendering:pixelated"/>`,
    ];

    if (spec.glasses && !useBaked) {
      const glassesUrl = assetRegistry.glassesUrl(spec.gender);
      layers.push(
        `<image href="${glassesUrl}" x="${GLASSES_X}" y="${GLASSES_Y}" ` +
          `width="${GLASSES_W}" height="${GLASSES_H}" ` +
          `preserveAspectRatio="xMidYMid meet" ` +
          `style="image-rendering:pixelated"/>`
      );
    }

    return (
      `<svg xmlns="http://www.w3.org/2000/svg" ` +
      `viewBox="0 0 ${CANVAS_W} ${CANVAS_H}" ` +
      `width="100%" height="100%" ` +
      `preserveAspectRatio="xMidYMid meet" ` +
      `shape-rendering="crispEdges" role="img" ` +
      `aria-label="${spec.gender} ${spec.characterClass}">` +
      layers.join("") +
      `</svg>`
    );
  }

  /**
   * Async variant kept for call-site compatibility. Composition is
   * synchronous now (no asset fetch needed), so this just wraps compose().
   */
  public async composeAsync(spec: PortraitSpec): Promise<string> {
    return this.compose(spec);
  }
}

/** Shared compositor instance */
export const portraitCompositor = new PortraitCompositor();
