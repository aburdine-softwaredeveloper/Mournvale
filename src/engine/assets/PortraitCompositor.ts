/**
 * PortraitCompositor.ts — Builds a composited portrait SVG from layers
 *
 * A character portrait is assembled from stacked SVG layers rather than
 * stored as one of 1000+ flat images:
 *
 *   base/{gender}      face + neck
 *   hair/{style}       hair silhouette, colorized via currentColor
 *   glasses (optional) spectacles overlay
 *   headgear/{class}   class hat/helm on top
 *
 * All layers share the same 128x128 viewBox, so we stack them by
 * extracting each layer's inner markup and wrapping them in <g> groups
 * inside one parent <svg>. Hair color is applied by setting the `color`
 * CSS property on the hair group (its rects use fill="currentColor").
 *
 * Architecture: This module depends on AssetRegistry to fetch raw layer
 * markup, then does pure string assembly. It performs no DOM work — the
 * caller injects the returned SVG string wherever needed.
 */

import { assetRegistry, type AssetKey } from "./AssetRegistry";

// ─────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────

/** The subset of character fields needed to draw a portrait */
export interface PortraitSpec {
  gender: "Male" | "Female";
  characterClass: string;
  hairStyle: string;
  hairColor: string;
  glasses: boolean;
}

// ─────────────────────────────────────────────
// HAIR COLOR MAPPING
// ─────────────────────────────────────────────

/**
 * Maps hair color names to grayscale hex values. Because the whole game
 * is Game Boy grayscale, "color" here means a shade of gray. Lighter
 * names → lighter grays.
 */
const HAIR_COLOR_SHADES: Record<string, string> = {
  Black: "#2e2e2e",
  Brown: "#5f5f5f",
  Red: "#787878",
  Silver: "#a6a6a6",
  Blonde: "#cdcdcd",
  White: "#ebebeb",
};

/** Fallback shade if an unknown color name is passed */
const DEFAULT_HAIR_SHADE = "#5f5f5f";

// ─────────────────────────────────────────────
// COMPOSITOR
// ─────────────────────────────────────────────

export class PortraitCompositor {
  /**
   * Builds a single composited portrait SVG string for the given spec.
   * Requires the layer assets to be loaded; call preloadLayers() first
   * (or this will load them on demand and await).
   */
  public async compose(spec: PortraitSpec): Promise<string> {
    const baseKey: AssetKey = `characters/base/${spec.gender.toLowerCase()}`;
    const hairKey: AssetKey = `characters/hair/${spec.hairStyle.toLowerCase()}`;
    const headgearKey: AssetKey = `characters/headgear/${spec.characterClass.toLowerCase()}`;
    const glassesKey: AssetKey = "characters/glasses/glasses";

    // Load all needed layers (cached, so repeated calls are cheap)
    const needed: AssetKey[] = [baseKey, hairKey, headgearKey];
    if (spec.glasses) needed.push(glassesKey);
    await assetRegistry.preload(needed);

    const hairShade =
      HAIR_COLOR_SHADES[spec.hairColor] ?? DEFAULT_HAIR_SHADE;

    // Build layer groups in stacking order: base → hair → glasses → headgear
    const groups: string[] = [];

    const base = this.innerMarkup(assetRegistry.get(baseKey));
    if (base) groups.push(`<g class="layer-base">${base}</g>`);

    const hair = this.innerMarkup(assetRegistry.get(hairKey));
    if (hair) {
      // currentColor in the hair layer resolves to this group's color
      groups.push(
        `<g class="layer-hair" color="${hairShade}" fill="${hairShade}">${hair}</g>`
      );
    }

    if (spec.glasses) {
      const glasses = this.innerMarkup(assetRegistry.get(glassesKey));
      if (glasses) groups.push(`<g class="layer-glasses">${glasses}</g>`);
    }

    const headgear = this.innerMarkup(assetRegistry.get(headgearKey));
    if (headgear) groups.push(`<g class="layer-headgear">${headgear}</g>`);

    return this.wrap(groups.join(""));
  }

  /**
   * Synchronous variant — assumes all layers are already cached.
   * Returns null if any required layer is missing from the cache.
   */
  public composeSync(spec: PortraitSpec): string | null {
    const baseKey: AssetKey = `characters/base/${spec.gender.toLowerCase()}`;
    const hairKey: AssetKey = `characters/hair/${spec.hairStyle.toLowerCase()}`;
    const headgearKey: AssetKey = `characters/headgear/${spec.characterClass.toLowerCase()}`;
    const glassesKey: AssetKey = "characters/glasses/glasses";

    const baseRaw = assetRegistry.get(baseKey);
    const hairRaw = assetRegistry.get(hairKey);
    const headgearRaw = assetRegistry.get(headgearKey);
    if (!baseRaw || !hairRaw || !headgearRaw) return null;
    if (spec.glasses && !assetRegistry.get(glassesKey)) return null;

    const hairShade =
      HAIR_COLOR_SHADES[spec.hairColor] ?? DEFAULT_HAIR_SHADE;

    const groups: string[] = [];

    const base = this.innerMarkup(baseRaw);
    if (base) groups.push(`<g class="layer-base">${base}</g>`);

    const hair = this.innerMarkup(hairRaw);
    if (hair) {
      groups.push(
        `<g class="layer-hair" color="${hairShade}" fill="${hairShade}">${hair}</g>`
      );
    }

    if (spec.glasses) {
      const glasses = this.innerMarkup(assetRegistry.get(glassesKey));
      if (glasses) groups.push(`<g class="layer-glasses">${glasses}</g>`);
    }

    const headgear = this.innerMarkup(headgearRaw);
    if (headgear) groups.push(`<g class="layer-headgear">${headgear}</g>`);

    return this.wrap(groups.join(""));
  }

  /**
   * Extracts the inner markup of an <svg> string — everything between
   * the opening <svg ...> and closing </svg>. Returns null on bad input.
   */
  private innerMarkup(svg: string | null): string | null {
    if (!svg) return null;
    const open = svg.indexOf(">");
    const close = svg.lastIndexOf("</svg>");
    if (open === -1 || close === -1 || close <= open) return null;
    return svg.slice(open + 1, close).trim();
  }

  /** Wraps assembled layer groups in a single parent SVG. */
  private wrap(inner: string): string {
    return (
      `<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" ` +
      `viewBox="0 0 128 128" shape-rendering="crispEdges" ` +
      `role="img" aria-label="character portrait">${inner}</svg>`
    );
  }
}

/** Shared compositor instance */
export const portraitCompositor = new PortraitCompositor();
