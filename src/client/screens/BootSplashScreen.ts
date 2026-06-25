/**
 * BootSplashScreen.ts — Game Boy Color style boot/power-on intro
 *
 * Plays once, before the main menu, to set the mood:
 *   1. A dark sky of rolling fog/clouds drifts across a canvas.
 *   2. Lightning flashes intermittently, briefly lighting the clouds.
 *   3. The MOURNVALE title "powers on" (the classic GBC logo drop), and
 *      a copyright/year stamp fades in beneath it.
 *   4. After a short hold (or as soon as the player presses a key / clicks
 *      / taps), it fades out and calls onComplete() — which hands off to
 *      the title menu.
 *
 * Fully self-contained and client-only: no sockets, no assets. The clouds
 * and lightning are drawn procedurally so nothing extra ships.
 *
 * Architecture mirrors IntroScreen/MainMenuScreen: a canvas inserted as the
 * first child of #screen-boot, content layered above it via CSS z-index.
 */

import { playSelect } from "../util/audio";

/** The year stamped on the boot screen (the game's "made" year). */
const COPYRIGHT_YEAR = 2026;

/** Auto-advance after this long if the player doesn't skip (ms). */
const AUTO_ADVANCE_MS = 5200;

/** A drifting cloud band. */
interface Cloud {
  x: number;
  y: number;
  scale: number;
  speed: number;
  alpha: number;
}

export class BootSplashScreen {
  private readonly root: HTMLElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D | null;

  private clouds: Cloud[] = [];
  private rafId: number | null = null;
  private active = false;
  private frame = 0;

  /** Frames until the next lightning strike. */
  private nextStrikeIn = 80;
  /** Remaining frames of the current flash (0 = no flash). */
  private flashFrames = 0;
  private flashPeak = 0;

  private onComplete: (() => void) | null = null;
  private finished = false;
  private autoTimer: number | null = null;

  private readonly boundSkip = () => this.skip();
  private readonly boundKey = (e: KeyboardEvent) => {
    if (e.key === "Shift" || e.key === "Control" || e.key === "Alt" || e.key === "Meta") return;
    this.skip();
  };

  constructor() {
    this.root = this.requireEl("screen-boot");

    const canvas = document.createElement("canvas");
    canvas.className = "boot-sky-canvas";
    canvas.setAttribute("aria-hidden", "true");
    this.root.insertBefore(canvas, this.root.firstChild);
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");

    // Stamp the configured year so the value lives in one place.
    const stamp = document.getElementById("boot-stamp");
    if (stamp) stamp.innerHTML = `© ${COPYRIGHT_YEAR} &nbsp;·&nbsp; aburdine.softwaredeveloper`;

    this.resize();
    window.addEventListener("resize", () => this.resize(), { passive: true });
  }

  /** Runs the boot sequence; onComplete fires once on finish or skip. */
  public start(onComplete: () => void): void {
    this.onComplete = onComplete;
    this.finished = false;
    this.frame = 0;
    this.flashFrames = 0;
    this.nextStrikeIn = 70;

    // Drive the CSS title-drop + stamp fade by toggling a class.
    this.root.classList.remove("boot-leaving");
    // Force reflow so re-entry replays the animation if ever reused.
    void this.root.offsetWidth;
    this.root.classList.add("boot-playing");

    this.attach();
    this.startSky();

    this.autoTimer = window.setTimeout(() => this.finish(), AUTO_ADVANCE_MS);
  }

  // ─── Sky (clouds + lightning) ──────────────────────────────────────────────

  private resize(): void {
    const W = this.root.offsetWidth || window.innerWidth;
    const H = this.root.offsetHeight || window.innerHeight;
    this.canvas.width = W;
    this.canvas.height = H;
    this.seedClouds(W, H);
  }

  private seedClouds(W: number, H: number): void {
    const count = 7;
    this.clouds = Array.from({ length: count }, (_, i) => ({
      x: (W / count) * i + Math.random() * 120,
      y: H * (0.18 + Math.random() * 0.5),
      scale: 0.7 + Math.random() * 1.3,
      speed: 0.12 + Math.random() * 0.28,
      alpha: 0.18 + Math.random() * 0.22,
    }));
  }

  private startSky(): void {
    if (this.active) return;
    this.active = true;
    this.tick();
  }

  private stopSky(): void {
    this.active = false;
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
  }

  private tick(): void {
    if (!this.active) return;
    const ctx = this.ctx;
    if (!ctx) return;
    const W = this.canvas.width;
    const H = this.canvas.height;
    this.frame++;

    // Dark sepia storm over the leather cover.
    ctx.clearRect(0, 0, W, H);
    const sky = ctx.createLinearGradient(0, 0, 0, H);
    sky.addColorStop(0, "#2c2218");
    sky.addColorStop(0.55, "#231a12");
    sky.addColorStop(1, "#181009");
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, W, H);

    // Lightning scheduling.
    this.nextStrikeIn--;
    if (this.nextStrikeIn <= 0 && this.flashFrames === 0) {
      this.flashFrames = 10 + Math.floor(Math.random() * 8);
      this.flashPeak = this.flashFrames;
      this.nextStrikeIn = 90 + Math.floor(Math.random() * 160);
      this.drawBolt(ctx, W, H);
    }

    // Flash overlay (decays over its frames) — lights the whole sky.
    if (this.flashFrames > 0) {
      const k = this.flashFrames / this.flashPeak; // 1 → 0
      // A double-blink feels more like real lightning.
      const blink = 0.55 + 0.45 * Math.abs(Math.sin(this.flashFrames * 0.9));
      ctx.fillStyle = `rgba(255,232,180,${0.42 * k * blink})`;
      ctx.fillRect(0, 0, W, H);
      this.flashFrames--;
    }

    // Clouds drift right; brighten slightly during a flash.
    const lit = this.flashFrames > 0 ? 0.5 : 0;
    for (const c of this.clouds) {
      c.x += c.speed;
      if (c.x - 240 * c.scale > W) {
        c.x = -240 * c.scale;
        c.y = H * (0.18 + Math.random() * 0.5);
      }
      this.drawCloud(ctx, c, lit);
    }

    this.rafId = requestAnimationFrame(() => this.tick());
  }

  /** Draws one soft puffy cloud band from overlapping radial gradients. */
  private drawCloud(ctx: CanvasRenderingContext2D, c: Cloud, lit: number): void {
    const lobes = [
      { dx: -80, dy: 10, r: 70 },
      { dx: -10, dy: -14, r: 90 },
      { dx: 70, dy: 8, r: 76 },
      { dx: 140, dy: 18, r: 58 },
    ];
    for (const l of lobes) {
      const r = l.r * c.scale;
      const cx = c.x + l.dx * c.scale;
      const cy = c.y + l.dy * c.scale;
      const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
      // Dark grey storm clouds so they read against the light sky; lightning
      // (the white flash overlay) brightens the whole scene momentarily.
      const base = c.alpha + lit * 0.12;
      g.addColorStop(0, `rgba(70,54,34,${base})`);
      g.addColorStop(0.6, `rgba(96,74,46,${base * 0.45})`);
      g.addColorStop(1, "rgba(120,95,60,0)");
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  /** Draws a jagged lightning bolt down from the top of the sky. */
  private drawBolt(ctx: CanvasRenderingContext2D, W: number, H: number): void {
    let x = W * (0.25 + Math.random() * 0.5);
    let y = 0;
    const segments = 7 + Math.floor(Math.random() * 4);
    const endY = H * (0.45 + Math.random() * 0.25);
    const step = endY / segments;

    ctx.save();
    ctx.strokeStyle = "rgba(240,210,150,0.9)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x, y);
    for (let i = 0; i < segments; i++) {
      x += (Math.random() - 0.5) * 70;
      y += step;
      ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.restore();
  }

  // ─── Skip / finish ─────────────────────────────────────────────────────────

  private skip(): void {
    if (this.finished) return;
    playSelect();
    this.finish();
  }

  private finish(): void {
    if (this.finished) return;
    this.finished = true;

    if (this.autoTimer !== null) {
      clearTimeout(this.autoTimer);
      this.autoTimer = null;
    }
    this.detach();
    this.root.classList.add("boot-leaving");

    // Let the fade-out play, then hand off.
    window.setTimeout(() => {
      this.stopSky();
      this.root.classList.remove("boot-playing", "boot-leaving");
      const cb = this.onComplete;
      this.onComplete = null;
      cb?.();
    }, 420);
  }

  private attach(): void {
    this.root.addEventListener("click", this.boundSkip);
    window.addEventListener("keydown", this.boundKey);
  }

  private detach(): void {
    this.root.removeEventListener("click", this.boundSkip);
    window.removeEventListener("keydown", this.boundKey);
  }

  private requireEl(id: string): HTMLElement {
    const el = document.getElementById(id);
    if (!el) throw new Error(`BootSplashScreen: missing element #${id}`);
    return el;
  }
}
