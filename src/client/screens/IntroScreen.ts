/**
 * IntroScreen.ts — Plays the opening cinematic
 *
 * Steps through INTRO_CINEMATIC scene by scene. Each scene types out
 * with a typewriter effect; the player presses a key or clicks to
 * advance. A first click while typing skips to full text instead of
 * advancing — standard JRPG behavior.
 *
 * When the last scene is dismissed, calls onComplete() — the app then
 * tells the server intro_complete and transitions to creation.
 *
 * Visual atmosphere:
 *   A drifting fog canvas fills the background. Particle-wisps drift
 *   upward and fade, layered beneath the text for depth without
 *   competing with readability. The canvas is inserted as the first
 *   child of #screen-intro and sits behind all text via CSS z-index.
 *
 * Architecture: This screen is fully self-contained and client-only.
 * It knows nothing about the WebSocket — the app wires onComplete.
 */

import { INTRO_CINEMATIC } from "../data/intro";
import { typewrite, type TypewriterController } from "../util/typewriter";
import type { StoryScene } from "../../types/story";

// ── Fog particle config ───────────────────────────────────────────────────────

interface FogParticle {
  x: number;       // canvas x (0..W)
  y: number;       // canvas y (0..H)
  radius: number;  // puff radius in px
  alpha: number;   // current opacity
  maxAlpha: number;// peak opacity for this particle
  vx: number;      // horizontal drift
  vy: number;      // upward drift (negative = up)
  phase: number;   // sine-wave offset for gentle sway
  /** Life state: "fadein" | "hold" | "fadeout" */
  state: "fadein" | "hold" | "fadeout";
  /** Frames remaining in current state */
  stateFrames: number;
}

const PARTICLE_COUNT = 28;
const BASE_RADIUS_MIN = 60;
const BASE_RADIUS_MAX = 160;

function randBetween(a: number, b: number): number {
  return a + Math.random() * (b - a);
}

function spawnParticle(W: number, H: number): FogParticle {
  const fadeInFrames  = Math.floor(randBetween(60, 120));
  const holdFrames    = Math.floor(randBetween(80, 200));
  return {
    x:           randBetween(0, W),
    y:           randBetween(H * 0.4, H),
    radius:      randBetween(BASE_RADIUS_MIN, BASE_RADIUS_MAX),
    alpha:       0,
    maxAlpha:    randBetween(0.04, 0.13),
    vx:          randBetween(-0.15, 0.15),
    vy:          randBetween(-0.12, -0.04),
    phase:       Math.random() * Math.PI * 2,
    state:       "fadein",
    stateFrames: fadeInFrames,
  };
  void holdFrames; // used below on state transition
}

// ─────────────────────────────────────────────
// IntroScreen
// ─────────────────────────────────────────────

export class IntroScreen {
  private readonly root: HTMLElement;
  private readonly headerEl: HTMLElement;
  private readonly textEl: HTMLElement;
  private readonly cursorEl: HTMLElement;

  private sceneIndex = 0;
  private scenes: StoryScene[] = INTRO_CINEMATIC.scenes;
  private activeTypewriter: TypewriterController | null = null;
  private onComplete: (() => void) | null = null;
  private listening = false;

  // Fog canvas state
  private fogCanvas:    HTMLCanvasElement | null = null;
  private fogCtx:      CanvasRenderingContext2D | null = null;
  private fogParticles: FogParticle[] = [];
  private fogRafId:    number | null = null;
  private fogActive    = false;
  private frameCount   = 0;

  // Bound handlers
  private readonly boundAdvance = () => this.handleAdvance();
  private readonly boundKey = (e: KeyboardEvent) => {
    if (e.key === "Shift" || e.key === "Control" || e.key === "Alt") return;
    this.handleAdvance();
  };

  constructor() {
    this.root     = this.requireEl("screen-intro");
    this.headerEl = this.requireEl("intro-header");
    this.textEl   = this.requireEl("intro-text");
    this.cursorEl = this.requireEl("intro-cursor");

    this.initFogCanvas();
  }

  // ─────────────────────────────────────────────
  // PUBLIC API
  // ─────────────────────────────────────────────

  /**
   * Starts the cinematic from the beginning.
   * @param onComplete called once the final scene is dismissed
   */
  public start(onComplete: () => void): void {
    this.onComplete  = onComplete;
    this.sceneIndex  = 0;
    this.attachListeners();
    this.startFog();

    const first = this.scenes[this.sceneIndex];
    if (first) this.playScene(first);
  }

  // ─────────────────────────────────────────────
  // FOG CANVAS
  // ─────────────────────────────────────────────

  private initFogCanvas(): void {
    const canvas = document.createElement("canvas");
    canvas.className = "intro-fog-canvas";
    canvas.setAttribute("aria-hidden", "true");

    // Behind all intro content
    this.root.insertBefore(canvas, this.root.firstChild);

    this.fogCanvas = canvas;
    this.fogCtx    = canvas.getContext("2d");

    this.resizeFogCanvas();
    window.addEventListener("resize", () => this.resizeFogCanvas(), { passive: true });
  }

  private resizeFogCanvas(): void {
    if (!this.fogCanvas) return;
    const W = this.root.offsetWidth  || window.innerWidth;
    const H = this.root.offsetHeight || window.innerHeight;
    this.fogCanvas.width  = W;
    this.fogCanvas.height = H;

    // Re-seed particles for new dimensions
    this.fogParticles = Array.from({ length: PARTICLE_COUNT }, () =>
      this.spawnRandom(W, H)
    );
  }

  /**
   * Spawns a particle at a random lifecycle offset so the screen
   * doesn't start empty.
   */
  private spawnRandom(W: number, H: number): FogParticle {
    const p = spawnParticle(W, H);
    // Randomise starting position in its lifecycle
    const offset = Math.floor(Math.random() * 300);
    for (let i = 0; i < offset; i++) this.stepParticle(p, W, H);
    return p;
  }

  private startFog(): void {
    if (this.fogActive) return;
    this.fogActive = true;
    this.fogTick();
  }

  private stopFog(): void {
    this.fogActive = false;
    if (this.fogRafId !== null) {
      cancelAnimationFrame(this.fogRafId);
      this.fogRafId = null;
    }
  }

  private fogTick(): void {
    if (!this.fogActive) return;
    const ctx = this.fogCtx;
    const cvs = this.fogCanvas;
    if (!ctx || !cvs) return;

    const W = cvs.width;
    const H = cvs.height;
    this.frameCount++;

    ctx.clearRect(0, 0, W, H);

    for (const p of this.fogParticles) {
      // Draw
      const grad = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.radius);
      grad.addColorStop(0,   `rgba(150,120,80,${p.alpha})`);
      grad.addColorStop(0.6, `rgba(110,86,54,${p.alpha * 0.4})`);
      grad.addColorStop(1,   "rgba(70,54,34,0)");

      ctx.beginPath();
      ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
      ctx.fillStyle = grad;
      ctx.fill();

      // Step lifecycle
      this.stepParticle(p, W, H);
    }

    this.fogRafId = requestAnimationFrame(() => this.fogTick());
  }

  /**
   * Advances a single particle one frame:
   *  - Moves it by its velocity + gentle sine sway
   *  - Advances its fade state
   *  - Respawns it when fully faded out
   */
  private stepParticle(p: FogParticle, W: number, H: number): void {
    // Movement
    p.x += p.vx + Math.sin(this.frameCount * 0.008 + p.phase) * 0.08;
    p.y += p.vy;

    // Fade state machine
    p.stateFrames--;

    if (p.state === "fadein") {
      p.alpha = Math.min(p.maxAlpha, p.alpha + p.maxAlpha / 80);
      if (p.stateFrames <= 0) {
        p.state       = "hold";
        p.stateFrames = Math.floor(randBetween(80, 200));
      }
    } else if (p.state === "hold") {
      // Gentle pulse
      p.alpha = p.maxAlpha * (0.85 + 0.15 * Math.sin(this.frameCount * 0.03 + p.phase));
      if (p.stateFrames <= 0) {
        p.state       = "fadeout";
        p.stateFrames = Math.floor(randBetween(60, 100));
      }
    } else {
      p.alpha = Math.max(0, p.alpha - p.maxAlpha / 80);
      if (p.stateFrames <= 0 || p.alpha <= 0) {
        // Respawn
        const next = spawnParticle(W, H);
        Object.assign(p, next);
      }
    }

    // Wrap horizontally; reset vertically if drifted off top
    if (p.x < -p.radius)     p.x = W + p.radius;
    if (p.x > W + p.radius)  p.x = -p.radius;
    if (p.y < -p.radius) {
      const next = spawnParticle(W, H);
      Object.assign(p, next);
    }
  }

  // ─────────────────────────────────────────────
  // CINEMATIC LOGIC (preserved from original)
  // ─────────────────────────────────────────────

  private playScene(scene: StoryScene): void {
    if (scene.header) {
      this.headerEl.textContent = scene.header;
      this.headerEl.classList.remove("hidden");
    } else {
      this.headerEl.classList.add("hidden");
    }

    this.cursorEl.classList.add("hidden");

    this.activeTypewriter = typewrite(
      this.textEl,
      scene.text,
      scene.typewriterSpeed ?? 40
    );

    this.activeTypewriter.done.then(() => {
      this.cursorEl.classList.remove("hidden");
    });
  }

  private handleAdvance(): void {
    if (!this.activeTypewriter) return;

    if (!this.activeTypewriter.isComplete()) {
      this.activeTypewriter.skip();
      return;
    }

    this.sceneIndex++;

    if (this.sceneIndex >= this.scenes.length) {
      this.finish();
      return;
    }

    const next = this.scenes[this.sceneIndex];
    if (next) this.playScene(next);
  }

  private finish(): void {
    this.detachListeners();
    this.stopFog();

    if (this.activeTypewriter) {
      this.activeTypewriter.cancel();
      this.activeTypewriter = null;
    }

    const cb = this.onComplete;
    this.onComplete = null;
    if (cb) cb();
  }

  private attachListeners(): void {
    if (this.listening) return;
    this.listening = true;
    this.root.addEventListener("click", this.boundAdvance);
    window.addEventListener("keydown", this.boundKey);
  }

  private detachListeners(): void {
    if (!this.listening) return;
    this.listening = false;
    this.root.removeEventListener("click", this.boundAdvance);
    window.removeEventListener("keydown", this.boundKey);
  }

  private requireEl(id: string): HTMLElement {
    const el = document.getElementById(id);
    if (!el) throw new Error(`IntroScreen: missing element #${id}`);
    return el;
  }
}
