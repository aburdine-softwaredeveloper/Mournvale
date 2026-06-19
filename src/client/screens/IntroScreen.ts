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
 * Architecture: This screen is fully self-contained and client-only.
 * It knows nothing about the WebSocket — the app wires onComplete.
 */

import { INTRO_CINEMATIC } from "../data/intro";
import { typewrite, type TypewriterController } from "../util/typewriter";
import type { StoryScene } from "../../types/story";

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

  // Bound handlers so we can add/remove the same reference
  private readonly boundAdvance = () => this.handleAdvance();
  private readonly boundKey = (e: KeyboardEvent) => {
    // Ignore modifier-only keypresses
    if (e.key === "Shift" || e.key === "Control" || e.key === "Alt") return;
    this.handleAdvance();
  };

  constructor() {
    this.root = this.requireEl("screen-intro");
    this.headerEl = this.requireEl("intro-header");
    this.textEl = this.requireEl("intro-text");
    this.cursorEl = this.requireEl("intro-cursor");
  }

  /**
   * Starts the cinematic from the beginning.
   * @param onComplete called once the final scene is dismissed
   */
  public start(onComplete: () => void): void {
    this.onComplete = onComplete;
    this.sceneIndex = 0;
    this.attachListeners();
    const first = this.scenes[this.sceneIndex];
    if (first) this.playScene(first);
  }

  /** Plays a single scene — header + typewriter text */
  private playScene(scene: StoryScene): void {
    // Header
    if (scene.header) {
      this.headerEl.textContent = scene.header;
      this.headerEl.classList.remove("hidden");
    } else {
      this.headerEl.classList.add("hidden");
    }

    // Hide the advance cursor until typing finishes
    this.cursorEl.classList.add("hidden");

    // Start typing
    this.activeTypewriter = typewrite(
      this.textEl,
      scene.text,
      scene.typewriterSpeed ?? 40
    );

    this.activeTypewriter.done.then(() => {
      // Show the "press any key" cursor once text is fully revealed
      this.cursorEl.classList.remove("hidden");
    });
  }

  /**
   * Handles a click or keypress.
   * If text is still typing → skip to full text.
   * If text is complete → advance to next scene (or finish).
   */
  private handleAdvance(): void {
    if (!this.activeTypewriter) return;

    if (!this.activeTypewriter.isComplete()) {
      // First input: skip the typewriter to show full text
      this.activeTypewriter.skip();
      return;
    }

    // Text already complete: advance
    this.sceneIndex++;

    if (this.sceneIndex >= this.scenes.length) {
      this.finish();
      return;
    }

    const next = this.scenes[this.sceneIndex];
    if (next) this.playScene(next);
  }

  /** Cleans up and fires onComplete */
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
    if (!el) throw new Error(`IntroScreen: missing element #${id}`);
    return el;
  }
}
