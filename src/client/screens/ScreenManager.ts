/**
 * ScreenManager.ts — Controls which screen is visible
 *
 * The client has three screens that map directly to the server's
 * PlayerState: intro (pending), creation (character_creation), and
 * game (active). Only one is visible at a time.
 *
 * Architecture: This is a thin visibility controller. It toggles the
 * .hidden class on the screen containers. It does not own screen logic —
 * the individual screen classes do.
 */

export type ScreenName = "menu" | "intro" | "creation" | "game";

export class ScreenManager {
  private readonly screens: Record<ScreenName, HTMLElement>;
  private current: ScreenName | null = null;

  constructor() {
    this.screens = {
      menu: this.requireEl("screen-menu"),
      intro: this.requireEl("screen-intro"),
      creation: this.requireEl("screen-creation"),
      game: this.requireEl("screen-game"),
    };
  }

  /** Shows the named screen and hides all others */
  public show(name: ScreenName): void {
    for (const key of Object.keys(this.screens) as ScreenName[]) {
      const el = this.screens[key];
      if (key === name) {
        el.classList.remove("hidden");
        el.classList.add("screen-active");
      } else {
        el.classList.add("hidden");
        el.classList.remove("screen-active");
      }
    }
    this.current = name;
  }

  public getCurrent(): ScreenName | null {
    return this.current;
  }

  private requireEl(id: string): HTMLElement {
    const el = document.getElementById(id);
    if (!el) throw new Error(`ScreenManager: missing element #${id}`);
    return el;
  }
}
