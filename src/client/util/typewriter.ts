/**
 * typewriter.ts — Reusable typewriter text animation
 *
 * Used by IntroScreen and DialogueBox. Handles the character-by-character
 * reveal, the "skip to full text" behavior, and cleanup.
 *
 * Architecture: Returns a controller object so the caller can skip or
 * cancel the animation (e.g. when the player clicks mid-typing).
 */

export interface TypewriterController {
  /** Instantly completes the animation, showing full text */
  skip: () => void;
  /** Cancels the animation entirely (e.g. on screen change) */
  cancel: () => void;
  /** Promise that resolves when typing completes (or is skipped) */
  done: Promise<void>;
  /** True if the animation has finished or been skipped */
  isComplete: () => boolean;
}

/**
 * Types `text` into `element` one character at a time.
 *
 * @param element  The DOM element to type into (textContent is replaced)
 * @param text     The full text to reveal
 * @param speedMs  Milliseconds per character (default 40)
 */
export function typewrite(
  element: HTMLElement,
  text: string,
  speedMs: number = 40
): TypewriterController {
  let index = 0;
  let complete = false;
  let timer: number | null = null;
  let resolveDone: () => void;

  const done = new Promise<void>((resolve) => {
    resolveDone = resolve;
  });

  element.textContent = "";

  function finish(): void {
    if (complete) return;
    complete = true;
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
    element.textContent = text;
    resolveDone();
  }

  function tick(): void {
    if (complete) return;

    if (index >= text.length) {
      finish();
      return;
    }

    element.textContent = text.slice(0, index + 1);
    index++;
    timer = window.setTimeout(tick, speedMs);
  }

  // Start typing on the next frame so the element is rendered first
  timer = window.setTimeout(tick, speedMs);

  return {
    skip: finish,
    cancel: () => {
      complete = true;
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
      resolveDone();
    },
    done,
    isComplete: () => complete,
  };
}
