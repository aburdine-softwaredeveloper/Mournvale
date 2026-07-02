/**
 * EndingScreen.ts — Plays the epilogue cinematic
 *
 * The mirror of IntroScreen, for the other end of the story. When the server
 * emits an `epilogue` message (the Fogmother is defeated), the app hands the
 * scenes here and shows #screen-ending. Each scene types out; the player clicks
 * or presses a key to advance. A click mid-type skips to full text (standard
 * JRPG behavior); a click once complete advances. When the last scene is
 * dismissed, onComplete() fires and the app returns the player to the game.
 *
 * Where the intro thickens into fog, the ending clears into dawn: the backdrop
 * warms and brightens over the course of the cinematic (a pure-CSS glow driven
 * by scene progress), so the fog visibly lifts as the story resolves.
 *
 * Architecture: fully self-contained and client-only. It knows nothing about
 * the WebSocket — the app wires onComplete.
 */

import { typewrite, type TypewriterController } from "../util/typewriter";
import type { EpilogueScene } from "../../types/network";

export class EndingScreen {
  private readonly root: HTMLElement;
  private readonly headerEl: HTMLElement;
  private readonly textEl: HTMLElement;
  private readonly cursorEl: HTMLElement;

  private scenes: EpilogueScene[] = [];
  private sceneIndex = 0;
  private activeTypewriter: TypewriterController | null = null;
  private onComplete: (() => void) | null = null;
  private listening = false;

  private readonly boundAdvance = () => this.handleAdvance();
  private readonly boundKey = (e: KeyboardEvent) => {
    if (e.key === "Shift" || e.key === "Control" || e.key === "Alt") return;
    this.handleAdvance();
  };

  constructor() {
    this.root     = this.requireEl("screen-ending");
    this.headerEl = this.requireEl("ending-header");
    this.textEl   = this.requireEl("ending-text");
    this.cursorEl = this.requireEl("ending-cursor");
  }

  /**
   * Plays the epilogue from the beginning.
   * @param scenes the ordered epilogue scenes from the server
   * @param onComplete called once the final scene is dismissed
   */
  public start(scenes: EpilogueScene[], onComplete: () => void): void {
    this.scenes     = scenes;
    this.onComplete = onComplete;
    this.sceneIndex = 0;
    this.attachListeners();

    const first = this.scenes[this.sceneIndex];
    if (first) this.playScene(first);
    else this.finish();
  }

  private playScene(scene: EpilogueScene): void {
    // Warm/brighten the backdrop as the story resolves: 0 → last scene.
    const progress = this.scenes.length > 1
      ? this.sceneIndex / (this.scenes.length - 1)
      : 1;
    this.root.style.setProperty("--dawn", progress.toFixed(3));

    if (scene.header) {
      this.headerEl.textContent = scene.header;
      this.headerEl.classList.remove("hidden");
    } else {
      this.headerEl.classList.add("hidden");
    }

    this.cursorEl.classList.add("hidden");

    this.activeTypewriter = typewrite(this.textEl, scene.text, 45);
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
    if (!el) throw new Error(`EndingScreen: missing element #${id}`);
    return el;
  }
}
