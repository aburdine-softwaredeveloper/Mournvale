/**
 * MainMenuScreen.ts — The entry menu: New Game / Load Game
 *
 * Flow:
 *   1. Two top-level buttons: NEW GAME and LOAD GAME
 *   2. Either choice reveals the 5-slot picker
 *   3. In NEW GAME mode, clicking a slot starts a new character there
 *      (occupied slots ask for overwrite confirmation)
 *   4. In LOAD GAME mode, clicking an occupied slot loads it
 *      (empty slots are disabled)
 *
 * Visual atmosphere:
 *   A layered fog canvas animates behind the title. Three fog layers
 *   drift at different speeds and opacities to produce a slow rolling
 *   dark-mist effect without requiring external assets.
 *   The canvas is appended to #screen-menu and positioned absolute
 *   behind all content via CSS (z-index: 0; content z-index: 1).
 *
 * The slot summaries come from the server (slot_list message). This
 * screen is a pure view + input collector — it reports the player's
 * choice via callbacks and never touches the socket directly.
 */

import type { SaveSlotSummary } from "../../types/network";

type MenuMode = "root" | "new" | "load";

// ── Fog layer config ──────────────────────────────────────────────────────────

interface FogLayer {
  /** Current horizontal scroll position in pixels */
  x: number;
  /** Vertical centre of the layer as fraction of canvas height (0–1) */
  yFraction: number;
  /** Scroll speed in px/frame */
  speed: number;
  /** Peak alpha for this layer */
  alpha: number;
  /** Vertical spread of the elliptical fog puff (px) */
  spread: number;
}

const FOG_LAYERS: FogLayer[] = [
  { x: 0,    yFraction: 0.72, speed: 0.28, alpha: 0.18, spread: 120 },
  { x: -320, yFraction: 0.80, speed: 0.18, alpha: 0.14, spread: 90  },
  { x: 160,  yFraction: 0.65, speed: 0.10, alpha: 0.10, spread: 70  },
];

// ─────────────────────────────────────────────
// MainMenuScreen
// ─────────────────────────────────────────────

export class MainMenuScreen {
  private readonly root: HTMLElement;
  private readonly rootButtons: HTMLElement;
  private readonly slotPanel: HTMLElement;
  private readonly slotList: HTMLElement;
  private readonly slotTitle: HTMLElement;
  private readonly backButton: HTMLButtonElement;
  private readonly newGameBtn: HTMLButtonElement;
  private readonly loadGameBtn: HTMLButtonElement;

  private slots: SaveSlotSummary[] = [];
  private mode: MenuMode = "root";

  private onNewGame:   ((slot: number) => void) | null = null;
  private onLoadGame:  ((slot: number) => void) | null = null;
  private onDeleteSlot:((slot: number) => void) | null = null;

  // Fog canvas state
  private fogCanvas:  HTMLCanvasElement | null = null;
  private fogCtx:    CanvasRenderingContext2D | null = null;
  private fogLayers: FogLayer[] = FOG_LAYERS.map((l) => ({ ...l }));
  private fogRafId:  number | null = null;
  private fogActive  = false;

  constructor() {
    this.root        = this.requireEl("screen-menu");
    this.rootButtons = this.requireEl("menu-root-buttons");
    this.slotPanel   = this.requireEl("menu-slot-panel");
    this.slotList    = this.requireEl("menu-slot-list");
    this.slotTitle   = this.requireEl("menu-slot-title");
    this.backButton  = this.requireEl("menu-back-btn")    as HTMLButtonElement;
    this.newGameBtn  = this.requireEl("menu-new-game")    as HTMLButtonElement;
    this.loadGameBtn = this.requireEl("menu-load-game")   as HTMLButtonElement;

    this.wireButtons();
    this.initFogCanvas();
  }

  // ─────────────────────────────────────────────
  // PUBLIC API
  // ─────────────────────────────────────────────

  /** Registers the callbacks the app uses to talk to the server */
  public setHandlers(handlers: {
    onNewGame:    (slot: number) => void;
    onLoadGame:   (slot: number) => void;
    onDeleteSlot: (slot: number) => void;
  }): void {
    this.onNewGame    = handlers.onNewGame;
    this.onLoadGame   = handlers.onLoadGame;
    this.onDeleteSlot = handlers.onDeleteSlot;
  }

  /** Updates the slot data and re-renders if the picker is visible */
  public setSlots(slots: SaveSlotSummary[]): void {
    this.slots = slots;
    // Re-render immediately if the slot panel is already open,
    // otherwise the slots are stored and rendered when enterMode() is called.
    if (this.mode !== "root") this.renderSlots();
  }

  /** Resets the menu to its root (two-button) view */
  public reset(): void {
    this.mode = "root";
    this.slotPanel.classList.add("hidden");
    this.rootButtons.classList.remove("hidden");
  }

  /**
   * Starts the fog animation. Call when the screen becomes visible.
   * Safe to call multiple times — idempotent.
   */
  public startFog(): void {
    if (this.fogActive) return;
    // Re-measure now that the screen is fully painted and visible
    this.resizeFogCanvas();
    this.fogActive = true;
    this.fogTick();
  }

  /**
   * Stops the fog animation. Call when leaving the screen.
   */
  public stopFog(): void {
    this.fogActive = false;
    if (this.fogRafId !== null) {
      cancelAnimationFrame(this.fogRafId);
      this.fogRafId = null;
    }
  }

  // ─────────────────────────────────────────────
  // FOG CANVAS
  // ─────────────────────────────────────────────

  /**
   * Creates and inserts the fog canvas behind all menu content.
   * The canvas is absolutely positioned and fills #screen-menu via CSS
   * class "fog-canvas" (see menu.css).
   */
  private initFogCanvas(): void {
    const canvas = document.createElement("canvas");
    canvas.className = "fog-canvas";
    canvas.setAttribute("aria-hidden", "true");

    // Insert as the very first child so CSS z-index keeps it behind content
    this.root.insertBefore(canvas, this.root.firstChild);

    this.fogCanvas = canvas;
    this.fogCtx    = canvas.getContext("2d");

    this.resizeFogCanvas();

    // Re-size if the window resizes
    window.addEventListener("resize", () => this.resizeFogCanvas(), { passive: true });
  }

  private resizeFogCanvas(): void {
    if (!this.fogCanvas) return;
    // Always use window dimensions — root.offsetHeight can be near-zero
    // at construction time before the screen is fully painted.
    this.fogCanvas.width  = window.innerWidth;
    this.fogCanvas.height = window.innerHeight;
  }

  /**
   * Main animation loop. Draws three scrolling fog strips each frame.
   *
   * Each layer is rendered as a series of overlapping radial gradients
   * (elliptical "puffs") tiled horizontally. The puffs are pure CSS-
   * agnostic canvas drawing, so they work regardless of the page theme.
   */
  private fogTick(): void {
    if (!this.fogActive) return;

    const ctx = this.fogCtx;
    const cvs = this.fogCanvas;
    if (!ctx || !cvs) return;

    const W = cvs.width;
    const H = cvs.height;

    ctx.clearRect(0, 0, W, H);

    for (const layer of this.fogLayers) {
      // Advance scroll
      layer.x -= layer.speed;
      // Wrap once the layer has scrolled past its own width (≈ W)
      if (layer.x < -W) layer.x += W;

      const y       = H * layer.yFraction;
      const puffW   = 280;  // horizontal radius of each fog puff
      const puffH   = layer.spread;
      const spacing = 200;  // horizontal gap between puff centres
      const count   = Math.ceil(W / spacing) + 3;

      for (let i = 0; i < count; i++) {
        const cx = layer.x + i * spacing;

        // Skip puffs far outside the canvas
        if (cx + puffW < 0 || cx - puffW > W) continue;

        const grad = ctx.createRadialGradient(cx, y, 0, cx, y, puffW);
        grad.addColorStop(0,   `rgba(120,120,120,${layer.alpha})`);
        grad.addColorStop(0.5, `rgba(140,140,140,${layer.alpha * 0.5})`);
        grad.addColorStop(1,   "rgba(170,170,170,0)");

        ctx.save();
        ctx.scale(1, puffH / puffW);   // squash to ellipse
        ctx.beginPath();
        ctx.arc(cx, y * (puffW / puffH), puffW, 0, Math.PI * 2);
        ctx.fillStyle = grad;
        ctx.fill();
        ctx.restore();
      }
    }

    this.fogRafId = requestAnimationFrame(() => this.fogTick());
  }

  // ─────────────────────────────────────────────
  // SLOT RENDERING (preserved from original)
  // ─────────────────────────────────────────────

  private wireButtons(): void {
    this.newGameBtn.addEventListener("click",  () => this.enterMode("new"));
    this.loadGameBtn.addEventListener("click", () => this.enterMode("load"));
    this.backButton.addEventListener("click",  () => this.reset());
  }

  private enterMode(mode: MenuMode): void {
    this.mode = mode;
    this.slotTitle.textContent =
      mode === "new" ? "NEW GAME — CHOOSE A SLOT" : "LOAD GAME — CHOOSE A SLOT";
    this.rootButtons.classList.add("hidden");
    this.slotPanel.classList.remove("hidden");
    this.renderSlots();
  }

  /**
   * Shows a loading message in the slot list if slots haven't arrived yet.
   * Called by enterMode — replaced with real data when setSlots() fires.
   */
  private renderSlots(): void {
    this.slotList.innerHTML = "";

    if (this.slots.length === 0) {
      const msg = document.createElement("div");
      msg.className   = "slot-row";
      msg.textContent = "Connecting to server...";
      msg.style.color = "var(--color-text-dim)";
      msg.style.fontSize = "8px";
      this.slotList.appendChild(msg);
      return;
    }

    for (const summary of this.slots) {
      this.slotList.appendChild(this.buildSlotRow(summary));
    }
  }

  private buildSlotRow(summary: SaveSlotSummary): HTMLElement {
    const row = document.createElement("div");
    row.className = "slot-row";

    // Label area
    const label = document.createElement("div");
    label.className = "slot-label";

    const slotNum = document.createElement("span");
    slotNum.className   = "slot-num";
    slotNum.textContent = `SLOT ${summary.slot}`;
    label.appendChild(slotNum);

    const detail = document.createElement("span");
    detail.className = "slot-detail";
    if (summary.occupied) {
      detail.textContent =
        `${summary.characterName} — ${summary.characterClass}\n` +
        `${summary.roomName ?? ""}  ·  ${this.formatDate(summary.savedAt)}`;
    } else {
      detail.textContent = "— Empty —";
      detail.classList.add("slot-empty");
    }
    label.appendChild(detail);

    row.appendChild(label);

    // Action area
    const actions = document.createElement("div");
    actions.className = "slot-actions";

    if (this.mode === "new") {
      const btn = document.createElement("button");
      btn.className   = "snes-btn";
      btn.textContent = summary.occupied ? "OVERWRITE" : "START";
      btn.addEventListener("click", () => this.chooseNew(summary));
      actions.appendChild(btn);
    } else if (this.mode === "load") {
      const btn = document.createElement("button");
      btn.className = "snes-btn";
      btn.textContent = "LOAD";
      btn.disabled    = !summary.occupied;
      if (!summary.occupied) btn.classList.add("btn-disabled");
      btn.addEventListener("click", () => {
        if (summary.occupied) this.onLoadGame?.(summary.slot);
      });
      actions.appendChild(btn);
    }

    if (summary.occupied) {
      const del = document.createElement("button");
      del.className   = "snes-btn snes-btn-danger";
      del.textContent = "✕";
      del.title       = "Delete this save";
      del.addEventListener("click", () => this.confirmDelete(summary.slot));
      actions.appendChild(del);
    }

    row.appendChild(actions);
    return row;
  }

  private chooseNew(summary: SaveSlotSummary): void {
    if (summary.occupied) {
      const ok = window.confirm(
        `Slot ${summary.slot} already holds ${summary.characterName}. ` +
        `Overwrite with a new character?`
      );
      if (!ok) return;
    }
    this.onNewGame?.(summary.slot);
  }

  private confirmDelete(slot: number): void {
    const ok = window.confirm(`Delete the save in slot ${slot}? This cannot be undone.`);
    if (ok) this.onDeleteSlot?.(slot);
  }

  private formatDate(ts?: number): string {
    if (!ts) return "";
    const d = new Date(ts);
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric" }) +
           " " +
           d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  }

  private requireEl(id: string): HTMLElement {
    const el = document.getElementById(id);
    if (!el) throw new Error(`MainMenuScreen: missing element #${id}`);
    return el;
  }
}
