/**
 * SettingsPanel.ts — The ⚙ settings modal
 *
 * Opened from the command menu's gear button (or by typing "settings").
 * Currently holds the audio controls: Music and Sound Effects toggles,
 * each persisted independently (music.ts / audio.ts own the flags).
 *
 * Self-contained like InventoryPanel: builds its own DOM + styles and
 * appends to <body>. Talks straight to the audio/music modules — no
 * server round-trip, these are pure client preferences. This panel is
 * the ONLY audio UI (the old floating ♪ button was removed so it can't
 * cover other elements); toggles still announce "mournvale:audiochange"
 * for any future audio UI to sync on.
 */

import { isMuted, setMuted, playSelect } from "../util/audio";
import { isMusicMuted, setMusicMuted } from "../util/music";

/** Event name other audio UI listens on to stay in sync. */
export const AUDIO_CHANGE_EVENT = "mournvale:audiochange";

export class SettingsPanel {
  private readonly overlay: HTMLElement;
  private readonly musicBtn: HTMLButtonElement;
  private readonly sfxBtn: HTMLButtonElement;

  private readonly boundKey = (e: KeyboardEvent): void => {
    if (e.key === "Escape") this.hide();
  };

  constructor() {
    this.injectStyles();

    this.overlay = document.createElement("div");
    this.overlay.id = "settings-overlay";
    this.overlay.innerHTML = `
      <div id="settings-card">
        <div class="set-header">
          <span class="set-title">⚙ Settings</span>
          <button id="settings-close" class="set-close" type="button">✕</button>
        </div>
        <div class="set-row">
          <div class="set-row-label">
            <span class="set-row-name">Music</span>
            <span class="set-row-desc">The town's dread &amp; the battle drums</span>
          </div>
          <button id="settings-music" class="set-toggle" type="button"></button>
        </div>
        <div class="set-row">
          <div class="set-row-label">
            <span class="set-row-name">Sound Effects</span>
            <span class="set-row-desc">Typewriter blips &amp; menu chimes</span>
          </div>
          <button id="settings-sfx" class="set-toggle" type="button"></button>
        </div>
      </div>
    `;
    this.overlay.style.display = "none";
    document.body.appendChild(this.overlay);

    this.musicBtn = this.overlay.querySelector("#settings-music") as HTMLButtonElement;
    this.sfxBtn   = this.overlay.querySelector("#settings-sfx")   as HTMLButtonElement;

    this.musicBtn.addEventListener("click", () => {
      setMusicMuted(!isMusicMuted());
      this.paint();
      this.announce();
    });
    this.sfxBtn.addEventListener("click", () => {
      setMuted(!isMuted());
      playSelect(); // instant feedback when turning SFX ON (no-op when muting)
      this.paint();
      this.announce();
    });

    (this.overlay.querySelector("#settings-close") as HTMLButtonElement)
      .addEventListener("click", () => this.hide());
    // Click on the dim backdrop (not the card) closes too.
    this.overlay.addEventListener("click", (e) => {
      if (e.target === this.overlay) this.hide();
    });
  }

  public show(): void {
    this.paint();
    this.overlay.style.display = "flex";
    document.addEventListener("keydown", this.boundKey);
  }

  public hide(): void {
    this.overlay.style.display = "none";
    document.removeEventListener("keydown", this.boundKey);
  }

  public isOpen(): boolean {
    return this.overlay.style.display !== "none";
  }

  private paint(): void {
    this.paintToggle(this.musicBtn, !isMusicMuted());
    this.paintToggle(this.sfxBtn, !isMuted());
  }

  private paintToggle(btn: HTMLButtonElement, on: boolean): void {
    btn.textContent = on ? "♪ ON" : "OFF";
    btn.classList.toggle("set-toggle-on", on);
  }

  private announce(): void {
    window.dispatchEvent(new CustomEvent(AUDIO_CHANGE_EVENT));
  }

  private injectStyles(): void {
    if (document.getElementById("mournvale-settings-styles")) return;
    const s = document.createElement("style");
    s.id = "mournvale-settings-styles";
    s.textContent = `
      #settings-overlay { position:fixed; inset:0; z-index:260;
        background:rgba(16,11,6,.7); display:flex; align-items:center; justify-content:center;
        padding:16px; }
      #settings-card { width:min(400px, 94vw); padding:18px 20px 20px;
        background:
          radial-gradient(ellipse at 28% 18%, rgba(255,255,250,.5), transparent 58%),
          #ece4cf;
        border:2px solid #7a6344; border-radius:6px;
        box-shadow: inset 0 0 22px rgba(95,62,30,.18), 0 10px 30px rgba(0,0,0,.6);
        font-family:'Press Start 2P', monospace; color:#3b2f20; }
      .set-header { display:flex; justify-content:space-between; align-items:center;
        margin-bottom:14px; border-bottom:1px solid #c7b994; padding-bottom:10px; }
      .set-title { font-size:11px; letter-spacing:2px; color:#5a3a1c; }
      .set-close { background:#c8b485; border:2px solid #7a6344; color:#3b2f20;
        font-family:inherit; font-size:9px; padding:6px 9px; cursor:pointer; }
      .set-close:hover { background:#bda36f; }
      .set-row { display:flex; justify-content:space-between; align-items:center;
        gap:12px; padding:12px 10px; margin-bottom:8px;
        background:#ddd2b6; border:2px solid #7a6344; }
      .set-row-label { display:flex; flex-direction:column; gap:6px; min-width:0; }
      .set-row-name { font-size:9px; letter-spacing:1px; color:#3b2f20; }
      .set-row-desc { font-size:7px; line-height:1.6; color:#6e5c42; }
      .set-toggle { flex-shrink:0; min-width:76px; min-height:36px; cursor:pointer;
        font-family:inherit; font-size:8px; letter-spacing:1px;
        background:#b4a582; border:2px solid #7a6344; color:#6e5c42; }
      .set-toggle-on { background:#5c6442; border-color:#3f4630; color:#ece4cf; }
      .set-toggle:hover { border-color:#5a3a1c; }
    `;
    document.head.appendChild(s);
  }
}
