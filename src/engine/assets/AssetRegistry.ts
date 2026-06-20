/**
 * AssetRegistry.ts — Single source of truth for game assets
 *
 * Per the project asset pipeline rules:
 *   - SVGs are loaded at RUNTIME (fetched), never bundled/imported by Vite
 *   - No component imports an SVG directly
 *   - This registry is the only place asset paths live
 *   - Everything else references assets by a string key
 *
 * Paths follow: /assets/{category}/{name}.svg
 * Categories: characters, npcs, enemies, tiles, ui
 *
 * Usage:
 *   await assetRegistry.preload(["characters/knight", "characters/mage"]);
 *   const svg = assetRegistry.get("characters/knight"); // raw SVG markup
 *
 * The registry caches fetched SVG text so each asset loads once. Callers
 * inject the markup into the DOM (e.g. element.innerHTML = svg), which
 * keeps the SVG inline and themeable via CSS currentColor if desired.
 */

// ─────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────

export type AssetCategory =
  | "characters"
  | "npcs"
  | "enemies"
  | "tiles"
  | "ui";

/** An asset key in the form "{category}/{name}", e.g. "characters/knight" */
export type AssetKey = `${AssetCategory}/${string}`;

interface CacheEntry {
  /** The raw SVG markup, once loaded */
  svg?: string;
  /** In-flight fetch, so concurrent requests share one network call */
  promise?: Promise<string>;
}

// ─────────────────────────────────────────────
// REGISTRY
// ─────────────────────────────────────────────

export class AssetRegistry {
  /** Base URL prefix for all assets. Maps to /public/assets at runtime. */
  private readonly basePath: string;

  /** Cache keyed by AssetKey */
  private readonly cache = new Map<AssetKey, CacheEntry>();

  constructor(basePath: string = "/assets") {
    this.basePath = basePath.replace(/\/$/, "");
  }

  /** Resolves an asset key to its runtime URL. */
  private urlFor(key: AssetKey): string {
    return `${this.basePath}/${key}.svg`;
  }

  /**
   * Fetches and caches a single asset's SVG markup.
   * Concurrent calls for the same key share one fetch.
   */
  public async load(key: AssetKey): Promise<string> {
    const existing = this.cache.get(key);
    if (existing?.svg !== undefined) return existing.svg;
    if (existing?.promise) return existing.promise;

    const entry: CacheEntry = {};
    this.cache.set(key, entry);

    entry.promise = fetch(this.urlFor(key))
      .then((res) => {
        if (!res.ok) {
          throw new Error(`Asset not found: ${key} (${res.status})`);
        }
        return res.text();
      })
      .then((svg) => {
        entry.svg = svg;
        return svg;
      })
      .catch((err) => {
        // Drop the failed entry so a later call can retry
        this.cache.delete(key);
        throw err;
      });

    return entry.promise;
  }

  /**
   * Preloads several assets at once. Resolves when all are cached.
   * Failures are collected but don't reject the whole batch — a missing
   * single portrait shouldn't blank the screen. Check has() afterward.
   */
  public async preload(keys: AssetKey[]): Promise<void> {
    await Promise.allSettled(keys.map((k) => this.load(k)));
  }

  /**
   * Returns cached SVG markup synchronously, or null if not yet loaded.
   * Use after preload() / load() has resolved.
   */
  public get(key: AssetKey): string | null {
    return this.cache.get(key)?.svg ?? null;
  }

  /** True if the asset is loaded and cached. */
  public has(key: AssetKey): boolean {
    return this.cache.get(key)?.svg !== undefined;
  }

  /**
   * Convenience: builds the headgear asset key for a character class.
   * Portraits are now composited (see PortraitCompositor); this returns
   * just the class headgear layer, used as a quick single-layer preview.
   */
  public headgearKey(characterClass: string): AssetKey {
    return `characters/headgear/${characterClass.toLowerCase()}`;
  }
}

// ─────────────────────────────────────────────
// SINGLETON
// ─────────────────────────────────────────────

/**
 * Shared registry instance. Import this everywhere rather than
 * constructing new registries — the cache should be process-wide.
 */
export const assetRegistry = new AssetRegistry();

/**
 * The canonical list of character portrait keys, one per class.
 * Keeping this here (not scattered) means adding a class is a one-line
 * change. Used to preload all portraits before character creation.
 */
/**
 * The canonical lists of portrait LAYER keys. Portraits are composited
 * from these layers (see PortraitCompositor) rather than stored as flat
 * per-combination images — there are 1000+ possible combinations, so we
 * stack a handful of layers instead.
 *
 * Adding a hair style or class is a one-line change here plus the SVG.
 */
export const PORTRAIT_BASE_KEYS: AssetKey[] = [
  "characters/base/male",
  "characters/base/female",
];

export const PORTRAIT_HAIR_KEYS: AssetKey[] = [
  "characters/hair/short",
  "characters/hair/long",
  "characters/hair/braided",
  "characters/hair/shaved",
  "characters/hair/curly",
  "characters/hair/ponytail",
];

export const PORTRAIT_HEADGEAR_KEYS: AssetKey[] = [
  "characters/headgear/knight",
  "characters/headgear/healer",
  "characters/headgear/warrior",
  "characters/headgear/monk",
  "characters/headgear/mage",
  "characters/headgear/thief",
  "characters/headgear/archer",
];

export const PORTRAIT_GLASSES_KEY: AssetKey = "characters/glasses/glasses";

/**
 * All portrait layer keys — preload this whole set before character
 * creation so any composite is instant.
 */
export const ALL_PORTRAIT_LAYER_KEYS: AssetKey[] = [
  ...PORTRAIT_BASE_KEYS,
  ...PORTRAIT_HAIR_KEYS,
  ...PORTRAIT_HEADGEAR_KEYS,
  PORTRAIT_GLASSES_KEY,
];
