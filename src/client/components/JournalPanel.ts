/**
 * JournalPanel.ts — The character's campaign journal.
 *
 * A self-contained modal (creates its own DOM + styles, like MapPanel)
 * listing every piece of lore the character has noted down, in the order
 * they learned it. Entries arrive from the server's `journal` message
 * (the codex text lives server-side in quest/loreCodex.ts); this panel is
 * a pure view.
 *
 * Styled as handwritten notes on a parchment leaf — IM Fell English italic
 * over the page palette — so it reads as the character's own hand, not UI.
 */

export interface JournalEntry {
  title: string;
  text: string;
}

export class JournalPanel {
  private readonly overlay: HTMLElement;
  private readonly list: HTMLElement;
  private readonly boundKey = (e: KeyboardEvent) => {
    if (e.key === "Escape" && this.isOpen()) this.hide();
  };

  constructor() {
    this.injectStyles();
    this.overlay = document.createElement("div");
    this.overlay.id = "journal-overlay";
    this.overlay.className = "journal-overlay hidden";
    this.overlay.innerHTML = `
      <div class="journal-card">
        <div class="journal-head">
          <span class="journal-title">Journal — Things Worth Remembering</span>
          <button id="journal-close" class="journal-close" type="button">✕</button>
        </div>
        <div id="journal-list" class="journal-list"></div>
      </div>`;
    document.body.appendChild(this.overlay);

    this.list = this.overlay.querySelector("#journal-list") as HTMLElement;

    this.overlay.querySelector("#journal-close")?.addEventListener("click", () => this.hide());
    this.overlay.addEventListener("click", (e) => {
      if (e.target === this.overlay) this.hide();
    });
    window.addEventListener("keydown", this.boundKey);
  }

  /** Renders the entries and opens the panel. */
  public show(entries: JournalEntry[]): void {
    this.list.innerHTML = "";

    if (entries.length === 0) {
      const empty = document.createElement("div");
      empty.className = "journal-empty";
      empty.textContent =
        "The pages are still blank. Talk to the townsfolk — Mournvale rewards a good listener.";
      this.list.appendChild(empty);
    }

    for (const entry of entries) {
      const note = document.createElement("div");
      note.className = "journal-entry";

      const title = document.createElement("div");
      title.className = "journal-entry-title";
      title.textContent = `✦ ${entry.title}`;

      const text = document.createElement("div");
      text.className = "journal-entry-text";
      text.textContent = entry.text;

      note.appendChild(title);
      note.appendChild(text);
      this.list.appendChild(note);
    }

    this.overlay.classList.remove("hidden");
  }

  public hide(): void { this.overlay.classList.add("hidden"); }
  public isOpen(): boolean { return !this.overlay.classList.contains("hidden"); }

  private injectStyles(): void {
    if (document.getElementById("mournvale-journal-styles")) return;
    const s = document.createElement("style");
    s.id = "mournvale-journal-styles";
    s.textContent = `
      .journal-overlay { position:fixed; inset:0; background:rgba(20,12,6,.6); display:flex; align-items:center; justify-content:center; z-index:60; }
      .journal-overlay.hidden { display:none; }
      .journal-card { width:min(560px,94vw); max-height:86vh; display:flex; flex-direction:column;
        background:#ece4cf; color:#382f22; border:2px solid #7a6344; border-radius:10px;
        box-shadow:0 12px 40px rgba(10,6,3,.6); overflow:hidden; }
      .journal-head { display:flex; align-items:center; gap:12px; padding:10px 16px; background:#241f1a; color:#e8dcc0; flex-shrink:0; }
      .journal-title { font-family:'IM Fell English', serif; font-style:italic; font-size:16px; letter-spacing:.04em; color:#d8b878; }
      .journal-close { margin-left:auto; background:rgba(216,184,120,.14); border:1px solid rgba(216,184,120,.36); color:#d8b878; border-radius:5px; cursor:pointer; padding:2px 9px; font-family:inherit; }
      .journal-close:hover { background:rgba(216,184,120,.26); }
      .journal-list { overflow-y:auto; min-height:0; padding:16px 20px; display:flex; flex-direction:column; gap:14px;
        scrollbar-width:thin; scrollbar-color:#7a6344 transparent; }
      .journal-entry { border-bottom:1px dashed #c7b994; padding-bottom:12px; }
      .journal-entry:last-child { border-bottom:none; padding-bottom:2px; }
      .journal-entry-title { font-family:'Press Start 2P', monospace; font-size:9px; letter-spacing:1px; color:#5a3a1c; margin-bottom:6px; }
      .journal-entry-text { font-family:'IM Fell English', serif; font-style:italic; font-size:15px; line-height:1.55; color:#4a3c28; }
      .journal-empty { font-family:'IM Fell English', serif; font-style:italic; font-size:15px; color:#6e5c42; text-align:center; padding:22px 8px; }
      @media (max-width: 700px) {
        .journal-card { width:96vw; max-height:88dvh; }
        .journal-title { font-size:14px; }
        .journal-entry-text { font-size:14px; }
      }
    `;
    document.head.appendChild(s);
  }
}
