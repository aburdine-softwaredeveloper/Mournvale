/**
 * InventoryPanel.ts — The inventory / pack overlay.
 *
 * A self-contained modal (creates its own DOM + styles, like CombatScreen) so it
 * needs no markup in index.html. Renders the server's InventoryView — gold, the
 * combined gear bonus, and a row per item with Equip / Unequip / Sell actions —
 * and forwards the player's choices back through onAction. Pure view + input
 * collector: the app injects the callbacks and feeds it fresh snapshots.
 */

import type { InventoryView, InventoryItemView } from "../../types/network";
import type { ItemSlot } from "../../types/items";

type InvAction = "equip" | "unequip" | "use" | "sell";

export class InventoryPanel {
  private readonly overlay: HTMLElement;
  private onAction: ((action: InvAction, itemId?: string, slot?: ItemSlot) => void) | null = null;
  private onClose: (() => void) | null = null;

  constructor() {
    this.injectStyles();
    this.overlay = document.createElement("div");
    this.overlay.id = "inv-overlay";
    this.overlay.className = "inv-overlay hidden";
    this.overlay.innerHTML = `
      <div class="inv-card">
        <div class="inv-head">
          <span class="inv-title">Pack</span>
          <span id="inv-gold" class="inv-gold"></span>
          <button id="inv-close" class="inv-close" type="button">✕</button>
        </div>
        <div id="inv-summary" class="inv-summary"></div>
        <div id="inv-list" class="inv-list"></div>
      </div>`;
    document.body.appendChild(this.overlay);

    this.overlay.querySelector("#inv-close")?.addEventListener("click", () => {
      this.hide();
      this.onClose?.();
    });
    // Click the dim backdrop (outside the card) to close.
    this.overlay.addEventListener("click", (e) => {
      if (e.target === this.overlay) { this.hide(); this.onClose?.(); }
    });
  }

  public setHandlers(handlers: {
    onAction: (action: InvAction, itemId?: string, slot?: ItemSlot) => void;
    onClose: () => void;
  }): void {
    this.onAction = handlers.onAction;
    this.onClose = handlers.onClose;
  }

  public show(): void { this.overlay.classList.remove("hidden"); }
  public hide(): void { this.overlay.classList.add("hidden"); }
  public isOpen(): boolean { return !this.overlay.classList.contains("hidden"); }

  public render(view: InventoryView): void {
    const gold = this.overlay.querySelector("#inv-gold");
    if (gold) gold.textContent = `${view.gold} gold`;
    const summary = this.overlay.querySelector("#inv-summary");
    if (summary) summary.textContent = view.bonusSummary;

    const list = this.overlay.querySelector("#inv-list") as HTMLElement | null;
    if (!list) return;
    list.innerHTML = "";
    if (view.items.length === 0) {
      const empty = document.createElement("div");
      empty.className = "inv-empty";
      empty.textContent = "Your pack is empty. Slay something, or take up a job.";
      list.appendChild(empty);
      return;
    }
    for (const item of view.items) list.appendChild(this.buildRow(item));
  }

  private buildRow(item: InventoryItemView): HTMLElement {
    const row = document.createElement("div");
    row.className = `inv-row inv-rarity-${item.rarity}${item.equipped ? " inv-equipped" : ""}`;

    const main = document.createElement("div");
    main.className = "inv-main";

    const nameRow = document.createElement("div");
    nameRow.className = "inv-name-row";
    const name = document.createElement("span");
    name.className = "inv-name";
    name.textContent = item.name;
    nameRow.appendChild(name);
    if (item.equipped) nameRow.appendChild(this.tag("EQUIPPED", "inv-tag-equipped"));
    else if (item.count > 1) nameRow.appendChild(this.tag(`×${item.count}`, "inv-tag-count"));
    if (item.slot) nameRow.appendChild(this.tag(item.slot, "inv-tag-slot"));
    main.appendChild(nameRow);

    const stat = document.createElement("div");
    stat.className = "inv-stat";
    stat.textContent = item.statLine;
    main.appendChild(stat);

    const desc = document.createElement("div");
    desc.className = "inv-desc";
    desc.textContent = item.description;
    main.appendChild(desc);

    row.appendChild(main);

    // Actions
    const actions = document.createElement("div");
    actions.className = "inv-actions";
    if (item.equipped && item.slot) {
      actions.appendChild(this.btn("Unequip", () => this.onAction?.("unequip", undefined, item.slot)));
    } else if (item.slot) {
      actions.appendChild(this.btn("Equip", () => this.onAction?.("equip", item.id)));
    }
    if (item.usable && !item.equipped) {
      actions.appendChild(this.btn("Use", () => this.onAction?.("use", item.id)));
    }
    if (!item.equipped && item.count > 0) {
      actions.appendChild(this.btn(`Sell (${item.sellValue}g)`, () => this.onAction?.("sell", item.id), "inv-btn-sell"));
    }
    row.appendChild(actions);
    return row;
  }

  private btn(label: string, onClick: () => void, extra = ""): HTMLButtonElement {
    const b = document.createElement("button");
    b.className = `inv-btn ${extra}`.trim();
    b.type = "button";
    b.textContent = label;
    b.addEventListener("click", onClick);
    return b;
  }

  private tag(text: string, cls: string): HTMLElement {
    const s = document.createElement("span");
    s.className = `inv-tag ${cls}`;
    s.textContent = text;
    return s;
  }

  private injectStyles(): void {
    if (document.getElementById("mournvale-inventory-styles")) return;
    const s = document.createElement("style");
    s.id = "mournvale-inventory-styles";
    // Spellbook theme: a parchment ledger over the dark leather cover.
    s.textContent = `
      .inv-overlay { position:fixed; inset:0; background:rgba(20,12,6,.6); display:flex; align-items:center; justify-content:center; z-index:60; }
      .inv-overlay.hidden { display:none; }
      .inv-card { width:min(560px,92vw); max-height:86vh; display:flex; flex-direction:column;
        background:#ece4cf; color:#382f22; border:2px solid #7a6344; border-radius:10px;
        box-shadow:0 12px 40px rgba(10,6,3,.6); font-family:inherit; overflow:hidden; }
      .inv-head { display:flex; align-items:center; gap:12px; padding:12px 16px; background:#241f1a; color:#e8dcc0; }
      .inv-title { font-size:16px; letter-spacing:.06em; color:#d8b878; }
      .inv-gold { margin-left:auto; font-size:13px; color:#e6c074; }
      .inv-close { background:rgba(216,184,120,.14); border:1px solid rgba(216,184,120,.36); color:#d8b878; border-radius:5px; cursor:pointer; padding:2px 9px; font-family:inherit; }
      .inv-close:hover { background:rgba(216,184,120,.26); }
      .inv-summary { padding:8px 16px; font-size:12px; color:#6e5c42; border-bottom:1px solid #cbbd9c; background:#e3d9bf; }
      .inv-list { overflow-y:auto; padding:8px; display:flex; flex-direction:column; gap:7px; }
      .inv-empty { padding:24px; text-align:center; color:#6e5c42; font-size:13px; }
      .inv-row { display:flex; gap:10px; padding:9px 11px; border:1px solid #cbbd9c; border-left-width:4px; border-radius:7px; background:#f2ecda; }
      .inv-equipped { background:#e8f0d6; }
      .inv-main { flex:1; min-width:0; }
      .inv-name-row { display:flex; align-items:center; gap:6px; flex-wrap:wrap; }
      .inv-name { font-size:13px; font-weight:600; color:#3b2f20; }
      .inv-stat { font-size:12px; color:#6e5c42; margin-top:2px; }
      .inv-desc { font-size:11px; color:#8a7a5a; margin-top:2px; font-style:italic; }
      .inv-actions { display:flex; flex-direction:column; gap:4px; justify-content:center; flex-shrink:0; }
      .inv-btn { padding:4px 10px; font-size:11px; background:#c8b485; border:1px solid #7a6344; border-radius:5px; color:#3b2f20; cursor:pointer; font-family:inherit; white-space:nowrap; }
      .inv-btn:hover { background:#bda36f; }
      .inv-btn-sell { background:#d8c3a0; color:#5a3a1c; }
      .inv-tag { font-size:9px; letter-spacing:.04em; padding:1px 5px; border-radius:3px; text-transform:uppercase; }
      .inv-tag-equipped { background:#5c6442; color:#eef3dd; }
      .inv-tag-count { background:rgba(90,58,28,.14); color:#5a3a1c; }
      .inv-tag-slot { background:rgba(90,58,28,.1); color:#6e5c42; }
      /* Rarity accents on the left border. */
      .inv-rarity-common   { border-left-color:#9a8a68; }
      .inv-rarity-uncommon { border-left-color:#5c8a52; }
      .inv-rarity-rare     { border-left-color:#3c6ea0; }
      .inv-rarity-epic     { border-left-color:#8a5aa0; }
    `;
    document.head.appendChild(s);
  }
}
