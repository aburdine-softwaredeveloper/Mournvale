/**
 * AssetRegistry.ts — Single source of truth for game assets
 *
 * Per the project asset pipeline rules:
 *   - SVGs are loaded at RUNTIME (fetched), never bundled/imported by Vite
 *   - No component imports an SVG directly
 *   - This registry is the only place asset paths live
 *   - Everything else references assets by a string key
 *
 * Paths follow: /assets/{category}/{name}.{ext}
 * Categories: characters, npcs, enemies, tiles, ui
 *
 * Formats: an asset key may carry an explicit extension (".png" or ".svg").
 * Bare keys default to ".svg" for back-compat. This lets a single key resolve
 * to either format so art can migrate file-by-file with no code change — e.g.
 * "tiles/tavern" → /assets/tiles/tavern.svg, "tiles/tavern.png" → …/tavern.png.
 *
 *   - SVG keys are fetched as TEXT and injected inline (themeable, current path)
 *   - PNG (and other raster) keys are NOT fetched here — use resolveUrl(key)
 *     and load them lazily via an <img src> / <image href>, like portraits
 *
 * Usage:
 *   await assetRegistry.preload(["characters/knight", "characters/mage"]);
 *   const svg = assetRegistry.get("characters/knight"); // raw SVG markup
 *   const url = assetRegistry.resolveUrl("tiles/tavern.png"); // for <img>
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

  /** Matches an explicit raster/vector extension on a key. */
  private static readonly EXT_RE = /\.(png|svg|jpg|jpeg|webp|gif)$/i;

  /**
   * Resolves an asset key to its runtime URL. Keys with an explicit extension
   * are used as-is; bare keys default to ".png" — the project ships raster art
   * (hand-made pixel PNGs), so PNG is the default everywhere. Use an explicit
   * ".svg" key only for the rare inline/vector asset.
   */
  private urlFor(key: AssetKey): string {
    const ext = AssetRegistry.EXT_RE.test(key) ? "" : ".png";
    return `${this.basePath}/${key}${ext}`;
  }

  /**
   * Public URL resolver for keys that should load directly via the browser
   * (raster images via <img src> / <image href>), rather than being fetched
   * as text. Same resolution rules as the internal loader.
   */
  public resolveUrl(key: AssetKey): string {
    return this.urlFor(key);
  }

  /**
   * True when a key refers to a raster image (PNG/JPG/…) loaded via <img>,
   * rather than inline SVG. Bare keys count as raster because they now default
   * to PNG (see urlFor); only an explicit ".svg" key is treated as inline SVG.
   */
  public isRaster(key: AssetKey): boolean {
    if (/\.svg$/i.test(key)) return false;
    return true;
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
   * Builds the runtime URL for a character portrait PNG. Portraits are
   * full-body sprites selected by (gender, hairColor, class):
   *   /assets/characters/portraits/{gender}_{color}_{class}.png
   */
  public portraitUrl(
    gender: string,
    hairColor: string,
    characterClass: string
  ): string {
    const g = gender.toLowerCase();
    const c = hairColor.toLowerCase();
    const cls = characterClass.toLowerCase();
    return `${this.basePath}/characters/portraits/${g}_${c}_${cls}.png`;
  }

  /**
   * Builds the runtime URL for the glasses overlay PNG for a gender:
   *   /assets/characters/glasses/{gender}.png
   */
  public glassesUrl(gender: string): string {
    return `${this.basePath}/characters/glasses/${gender.toLowerCase()}.png`;
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
