/**
 * ShopPanel.ts — The vendor trade overlay.
 *
 * A self-contained modal (like InventoryPanel) that shows a vendor's wares to
 * buy and the player's pack to sell back. Reuses the inventory panel's parchment
 * styling (inv-* classes) and adds a couple of shop-specific bits. Pure view +
 * input collector: the app injects the buy/sell/close callbacks and feeds it
 * ShopView snapshots; each action carries the vendorId of the current shop.
 */

import type { ShopView, ShopEntryView } from "../../types/network";

export class ShopPanel {
  private readonly overlay: HTMLElement;
  private vendorId = "";
  private onAction: ((action: "buy" | "sell", vendorId: string, itemId: string) => void) | null = null;
  private onClose: (() => void) | null = null;

  constructor() {
    this.injectStyles();
    this.overlay = document.createElement("div");
    this.overlay.id = "shop-overlay";
    this.overlay.className = "inv-overlay hidden";
    this.overlay.innerHTML = `
      <div class="inv-card">
        <div class="inv-head">
          <span class="inv-title" id="shop-title">Wares</span>
          <span id="shop-gold" class="inv-gold"></span>
          <button id="shop-close" class="inv-close" type="button">✕</button>
        </div>
        <div class="inv-list" id="shop-list"></div>
      </div>`;
    document.body.appendChild(this.overlay);

    this.overlay.querySelector("#shop-close")?.addEventListener("click", () => { this.hide(); this.onClose?.(); });
    this.overlay.addEventListener("click", (e) => {
      if (e.target === this.overlay) { this.hide(); this.onClose?.(); }
    });
  }

  public setHandlers(handlers: {
    onAction: (action: "buy" | "sell", vendorId: string, itemId: string) => void;
    onClose: () => void;
  }): void {
    this.onAction = handlers.onAction;
    this.onClose = handlers.onClose;
  }

  public show(): void { this.overlay.classList.remove("hidden"); }
  public hide(): void { this.overlay.classList.add("hidden"); }
  public isOpen(): boolean { return !this.overlay.classList.contains("hidden"); }

  public render(view: ShopView): void {
    this.vendorId = view.vendorId;
    const title = this.overlay.querySelector("#shop-title");
    if (title) title.textContent = `${view.vendorName}'s Wares`;
    const gold = this.overlay.querySelector("#shop-gold");
    if (gold) gold.textContent = `${view.gold} gold`;

    const list = this.overlay.querySelector("#shop-list") as HTMLElement | null;
    if (!list) return;
    list.innerHTML = "";

    list.appendChild(this.sectionHeader("For Sale"));
    if (view.forSale.length === 0) list.appendChild(this.note("Nothing in stock."));
    for (const item of view.forSale) list.appendChild(this.buildRow(item, "buy"));

    list.appendChild(this.sectionHeader("Sell From Your Pack"));
    if (view.sellable.length === 0) list.appendChild(this.note("You've nothing to sell."));
    for (const item of view.sellable) list.appendChild(this.buildRow(item, "sell"));
  }

  private buildRow(item: ShopEntryView, mode: "buy" | "sell"): HTMLElement {
    const row = document.createElement("div");
    row.className = `inv-row inv-rarity-${item.rarity}`;

    const main = document.createElement("div");
    main.className = "inv-main";
    const nameRow = document.createElement("div");
    nameRow.className = "inv-name-row";
    const name = document.createElement("span");
    name.className = "inv-name";
    name.textContent = item.name;
    nameRow.appendChild(name);
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

    const actions = document.createElement("div");
    actions.className = "inv-actions";
    const label = mode === "buy" ? `Buy (${item.price}g)` : `Sell (${item.price}g)`;
    const btn = document.createElement("button");
    btn.className = `inv-btn ${mode === "sell" ? "inv-btn-sell" : ""}`.trim();
    btn.type = "button";
    btn.textContent = label;
    if (mode === "buy" && item.affordable === false) {
      btn.disabled = true;
      btn.classList.add("shop-btn-disabled");
    } else {
      btn.addEventListener("click", () => this.onAction?.(mode, this.vendorId, item.itemId));
    }
    actions.appendChild(btn);
    row.appendChild(actions);
    return row;
  }

  private sectionHeader(text: string): HTMLElement {
    const h = document.createElement("div");
    h.className = "shop-section";
    h.textContent = text;
    return h;
  }

  private note(text: string): HTMLElement {
    const n = document.createElement("div");
    n.className = "inv-empty";
    n.textContent = text;
    return n;
  }

  private injectStyles(): void {
    if (document.getElementById("mournvale-shop-styles")) return;
    const s = document.createElement("style");
    s.id = "mournvale-shop-styles";
    // Shop-specific bits; the shared card/row/button styling comes from the
    // inventory panel's inv-* classes (both panels exist at app start).
    s.textContent = `
      .shop-section { font-size:11px; letter-spacing:.08em; text-transform:uppercase; color:#8a5a2c;
        padding:8px 4px 3px; border-bottom:1px solid #cbbd9c; margin-top:4px; font-weight:600; }
      .shop-btn-disabled { opacity:.45; cursor:not-allowed; }
    `;
    document.head.appendChild(s);
  }
}
