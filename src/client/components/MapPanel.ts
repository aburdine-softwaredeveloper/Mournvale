/**
 * MapPanel.ts — The town map overlay.
 *
 * A self-contained modal (creates its own DOM + styles, like InventoryPanel)
 * showing the painted survey of Mournvale — public/assets/ui/town_map.png,
 * graded into the same sepia page/ink palette as the room tiles by
 * scripts/make-town-map.mjs — so players can see how the town fits together.
 *
 * Pure client view: the "you are here" marker is driven by the room artKey the
 * app already receives on every room message (artKeys match the map's places;
 * rooms without a spot on the survey — the cellar, the fog roads — get a
 * footnote instead of a marker).
 */

import { assetRegistry } from "../../engine/assets/AssetRegistry";

/** Marker positions as percentages of the map image (1408×768 source). */
const PLACES: Record<string, { x: number; y: number; label: string }> = {
  chapel:        { x: 50.6, y: 20.0, label: "The Chapel" },
  graveyard:     { x: 24.9, y: 35.2, label: "The Graveyard" },
  north_gate:    { x: 51.5, y: 35.5, label: "North Gate" },
  apothecary:    { x: 67.5, y: 35.2, label: "The Apothecary" },
  smithy:        { x: 36.2, y: 53.4, label: "The Smithy" },
  market_square: { x: 52.3, y: 54.0, label: "Market Square" },
  general_store: { x: 69.9, y: 52.7, label: "Welk's Store" },
  street:        { x: 57.5, y: 68.4, label: "Cobblestone Street" },
  stables:       { x: 23.4, y: 72.3, label: "The Stables" },
  tavern:        { x: 45.5, y: 74.2, label: "The Broken Lantern" },
  guard_post:    { x: 78.5, y: 72.3, label: "The Guard Post" },
  south_road:    { x: 62.5, y: 89.8, label: "South Road" },
};

/** Rooms that lie off the survey — noted in the caption instead of marked. */
const OFF_MAP: Record<string, string> = {
  cellar:   "You are in the cellar beneath The Broken Lantern.",
  fog_road: "You are beyond the North Gate, out in the fog.",
  fogheart: "You are deep in the fog, far beyond the town walls.",
};

export class MapPanel {
  private readonly overlay: HTMLElement;
  private readonly marker: HTMLElement;
  private readonly caption: HTMLElement;
  private readonly boundKey = (e: KeyboardEvent) => {
    if (e.key === "Escape" && this.isOpen()) this.hide();
  };

  constructor() {
    this.injectStyles();
    this.overlay = document.createElement("div");
    this.overlay.id = "map-overlay";
    this.overlay.className = "map-overlay hidden";
    this.overlay.innerHTML = `
      <div class="map-card">
        <div class="map-head">
          <span class="map-title">Mournvale — Town Survey</span>
          <button id="map-close" class="map-close" type="button">✕</button>
        </div>
        <div class="map-body">
          <img class="map-img" src="${assetRegistry.resolveUrl("ui/town_map")}" alt="Map of Mournvale" draggable="false">
          <div id="map-marker" class="map-marker hidden">
            <span class="map-marker-ring"></span>
            <span class="map-marker-label">You are here</span>
          </div>
        </div>
        <div id="map-caption" class="map-caption"></div>
      </div>`;
    document.body.appendChild(this.overlay);

    this.marker = this.overlay.querySelector("#map-marker") as HTMLElement;
    this.caption = this.overlay.querySelector("#map-caption") as HTMLElement;

    this.overlay.querySelector("#map-close")?.addEventListener("click", () => this.hide());
    // Click the dim backdrop (outside the card) to close.
    this.overlay.addEventListener("click", (e) => {
      if (e.target === this.overlay) this.hide();
    });
    window.addEventListener("keydown", this.boundKey);
  }

  /** Opens the map, marking the player's place (artKey from the room message). */
  public show(artKey: string | null): void {
    const place = artKey ? PLACES[artKey] : undefined;
    if (place) {
      this.marker.style.left = `${place.x}%`;
      this.marker.style.top = `${place.y}%`;
      this.marker.classList.remove("hidden");
      this.caption.textContent = `You are here: ${place.label}`;
    } else {
      this.marker.classList.add("hidden");
      this.caption.textContent =
        (artKey && OFF_MAP[artKey]) ?? "Your place is not marked on this survey.";
    }
    this.overlay.classList.remove("hidden");
  }

  public hide(): void { this.overlay.classList.add("hidden"); }
  public isOpen(): boolean { return !this.overlay.classList.contains("hidden"); }

  public toggle(artKey: string | null): void {
    if (this.isOpen()) this.hide();
    else this.show(artKey);
  }

  private injectStyles(): void {
    if (document.getElementById("mournvale-map-styles")) return;
    const s = document.createElement("style");
    s.id = "mournvale-map-styles";
    // Spellbook theme: the survey unfolds as a parchment sheet over the cover.
    s.textContent = `
      .map-overlay { position:fixed; inset:0; background:rgba(20,12,6,.6); display:flex; align-items:center; justify-content:center; z-index:60; }
      .map-overlay.hidden { display:none; }
      .map-card { width:min(1040px,94vw); max-height:92vh; display:flex; flex-direction:column;
        background:#ece4cf; color:#382f22; border:2px solid #7a6344; border-radius:10px;
        box-shadow:0 12px 40px rgba(10,6,3,.6); font-family:inherit; overflow:hidden; }
      .map-head { display:flex; align-items:center; gap:12px; padding:10px 16px; background:#241f1a; color:#e8dcc0; flex-shrink:0; }
      .map-title { font-size:15px; letter-spacing:.06em; color:#d8b878; }
      .map-close { margin-left:auto; background:rgba(216,184,120,.14); border:1px solid rgba(216,184,120,.36); color:#d8b878; border-radius:5px; cursor:pointer; padding:2px 9px; font-family:inherit; }
      .map-close:hover { background:rgba(216,184,120,.26); }
      .map-body { position:relative; overflow:auto; min-height:0; line-height:0; }
      .map-img { display:block; width:100%; height:auto; user-select:none; -webkit-user-drag:none; }
      .map-caption { padding:8px 16px; font-size:12px; font-style:italic; color:#6e5c42; border-top:1px solid #cbbd9c; background:#e3d9bf; flex-shrink:0; }
      /* "You are here" — an oxblood pin that breathes so it reads over the sepia wash. */
      .map-marker { position:absolute; transform:translate(-50%,-50%); pointer-events:none; line-height:normal; }
      .map-marker.hidden { display:none; }
      .map-marker-ring { display:block; width:16px; height:16px; margin:0 auto; border-radius:50%;
        background:rgba(122,42,34,.92); border:2px solid #ece4cf; box-shadow:0 0 0 2px rgba(122,42,34,.85), 0 2px 6px rgba(10,6,3,.5);
        animation:map-pulse 1.8s ease-in-out infinite; }
      .map-marker-label { display:block; margin-top:4px; padding:1px 7px; font-size:10px; letter-spacing:.08em; text-transform:uppercase;
        color:#ece4cf; background:rgba(122,42,34,.92); border-radius:4px; white-space:nowrap;
        box-shadow:0 2px 5px rgba(10,6,3,.4); }
      @keyframes map-pulse {
        0%, 100% { box-shadow:0 0 0 2px rgba(122,42,34,.85), 0 2px 6px rgba(10,6,3,.5); }
        50%      { box-shadow:0 0 0 7px rgba(122,42,34,.25), 0 2px 6px rgba(10,6,3,.5); }
      }
      @media (max-width: 700px) {
        .map-card { width:96vw; max-height:92dvh; }
        .map-title { font-size:13px; }
        .map-marker-ring { width:13px; height:13px; }
        .map-marker-label { font-size:9px; }
      }
    `;
    document.head.appendChild(s);
  }
}
