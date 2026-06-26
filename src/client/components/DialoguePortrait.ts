/**
 * DialoguePortrait.ts — Sliding conversation portraits over the room image
 *
 * Recreates the classic JRPG beat where a speaker's portrait slides in over
 * the scene as they talk. Two slots, by screen side:
 *
 *   • NPC you're talking to        → slides in from the LEFT
 *   • You / a party member talking  → slides in from the RIGHT (during NPC chat)
 *   • You talking to the room (say) → slides in from the LEFT
 *
 * The layer is absolutely positioned inside the room-image box so portraits
 * appear "in front of" the scene. Each portrait auto-dismisses after a short
 * hold; showing a new one in the same slot refreshes it.
 *
 * Pure view: it's handed pre-composed SVG markup + a label and does the
 * sliding/timeout bookkeeping. It never touches the socket or asset layer.
 */

type Side = "left" | "right";

/**
 * Safety net only. Portraits are now sticky — they stay until the conversation
 * is over (a new speaker, the player leaving the room, etc.), which the owner
 * (GameScreen) decides by watching the log. This long timeout just guarantees a
 * portrait never gets stuck forever if a dismissal signal is somehow missed; it
 * is deliberately far longer than any LLM reply + read time.
 */
const SAFETY_HIDE_MS = 45000;

interface Slot {
  wrap: HTMLElement;
  hideTimer: number | null;
}

export class DialoguePortrait {
  private readonly layer: HTMLElement;
  private readonly slots: Record<Side, Slot>;

  /**
   * @param host the element to overlay (the room-image box). The layer is
   *             appended to it; the host is made position:relative via CSS.
   */
  constructor(host: HTMLElement) {
    this.layer = document.createElement("div");
    this.layer.className = "dlg-portrait-layer";
    this.layer.setAttribute("aria-hidden", "true");

    this.slots = {
      left: this.buildSlot("left"),
      right: this.buildSlot("right"),
    };
    this.layer.appendChild(this.slots.left.wrap);
    this.layer.appendChild(this.slots.right.wrap);

    host.appendChild(this.layer);
  }

  private buildSlot(side: Side): Slot {
    const wrap = document.createElement("div");
    wrap.className = `dlg-portrait dlg-portrait-${side}`;
    wrap.innerHTML = `
      <div class="dlg-portrait-frame"></div>
      <div class="dlg-portrait-name"></div>
    `;
    return { wrap, hideTimer: null };
  }

  /**
   * Shows a portrait in the given side slot, sliding it in. Replaces whatever
   * was there and (re)starts the auto-dismiss timer.
   */
  public show(side: Side, svg: string, label: string): void {
    const slot = this.slots[side];
    const frame = slot.wrap.querySelector<HTMLElement>(".dlg-portrait-frame");
    const name = slot.wrap.querySelector<HTMLElement>(".dlg-portrait-name");
    if (frame) frame.innerHTML = svg;
    if (name) name.textContent = label;

    // Restart the enter animation even if already visible.
    slot.wrap.classList.remove("dlg-portrait-in");
    void slot.wrap.offsetWidth; // reflow to replay the transition
    slot.wrap.classList.add("dlg-portrait-in");

    if (slot.hideTimer !== null) clearTimeout(slot.hideTimer);
    slot.hideTimer = window.setTimeout(() => this.hide(side), SAFETY_HIDE_MS);
  }

  /** Slides the given side slot back out. */
  public hide(side: Side): void {
    const slot = this.slots[side];
    slot.wrap.classList.remove("dlg-portrait-in");
    if (slot.hideTimer !== null) {
      clearTimeout(slot.hideTimer);
      slot.hideTimer = null;
    }
  }

  /** Hides both slots immediately (e.g. on room change). */
  public hideAll(): void {
    this.hide("left");
    this.hide("right");
  }
}
