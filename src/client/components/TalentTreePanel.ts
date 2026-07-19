/**
 * TalentTreePanel.ts — Center-panel content for the character/skills screen.
 *
 * Shows the character portrait preview (reusing PortraitCompositor) above the
 * class talent tree. Nodes are laid out on a grid from each node's {col,row}
 * (see talents.ts). Clicking a node that `canRankUp` sends a `spend <nodeId>`
 * command; the server validates and re-emits the view, which re-renders here.
 */

import { portraitCompositor, type PortraitSpec } from "../../engine/assets/PortraitCompositor";
import type { SkillScreenView, SkillTalentNodeView } from "../../types/network";

export class TalentTreePanel {
  private readonly container: HTMLElement;
  /** Sends a raw command string (routed to the server). */
  private onCommand: ((command: string) => void) | null = null;
  private portraitSpec: PortraitSpec | null = null;
  /** The full-screen portrait overlay, while open. */
  private lightbox: HTMLElement | null = null;
  private readonly onLightboxKey = (e: KeyboardEvent): void => {
    if (e.key === "Escape") this.closeLightbox();
  };

  constructor(containerId: string) {
    const el = document.getElementById(containerId);
    if (!el) throw new Error(`TalentTreePanel: missing container #${containerId}`);
    this.container = el;
  }

  public setCommandHandler(handler: (command: string) => void): void {
    this.onCommand = handler;
  }

  /** Cached so the portrait can be drawn without re-fetching the spec. */
  public setPortraitSpec(spec: PortraitSpec | null): void {
    this.portraitSpec = spec;
  }

  public update(view: SkillScreenView): void {
    this.container.innerHTML = "";

    // ── Portrait preview (click to enlarge) ──
    const portrait = document.createElement("div");
    portrait.className = "talent-portrait";
    if (this.portraitSpec) {
      portrait.innerHTML = portraitCompositor.compose(this.portraitSpec);
      portrait.title = "Click to view full portrait";
      portrait.setAttribute("role", "button");
      portrait.setAttribute("tabindex", "0");
      portrait.addEventListener("click", () => this.openLightbox());
      portrait.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          this.openLightbox();
        }
      });
    }
    this.container.appendChild(portrait);

    const title = document.createElement("div");
    title.className = "panel-title";
    title.textContent = "◆ TALENTS";
    this.container.appendChild(title);

    const hint = document.createElement("div");
    hint.className = "talent-hint";
    hint.textContent = view.unspentSkillPoints > 0
      ? `Click a lit node to spend a point (${view.unspentSkillPoints} left).`
      : "Earn skill points by leveling up.";
    this.container.appendChild(hint);

    // ── Grid ──
    const cols = Math.max(...view.nodes.map((n) => n.pos.col)) + 1;
    const rows = Math.max(...view.nodes.map((n) => n.pos.row)) + 1;

    const grid = document.createElement("div");
    grid.className = "talent-grid";
    grid.style.gridTemplateColumns = `repeat(${cols}, 1fr)`;
    grid.style.gridTemplateRows = `repeat(${rows}, auto)`;

    for (const node of view.nodes) {
      grid.appendChild(this.renderNode(node));
    }
    this.container.appendChild(grid);
  }

  private renderNode(node: SkillTalentNodeView): HTMLElement {
    const cell = document.createElement("button");
    cell.type = "button";
    cell.className = `talent-node talent-node-${node.state}`;
    cell.style.gridColumn = `${node.pos.col + 1}`;
    cell.style.gridRow = `${node.pos.row + 1}`;
    cell.disabled = !node.canRankUp;

    const reqText = node.requires.length
      ? "\nRequires: " + node.requires.map((r) => `${r.nodeId} (${r.rank})`).join(", ")
      : "";
    cell.title = `${node.name} — ${node.description}\nRank ${node.rank}/${node.maxRank} · cost ${node.cost}${reqText}`;

    const name = document.createElement("span");
    name.className = "talent-node-name";
    name.textContent = node.name;

    const rank = document.createElement("span");
    rank.className = "talent-node-rank";
    rank.textContent = `${node.rank}/${node.maxRank}`;

    cell.append(name, rank);

    if (node.canRankUp) {
      cell.addEventListener("click", () => this.onCommand?.(`spend ${node.id}`));
    }
    return cell;
  }

  /**
   * Opens a full-screen, isolated view of the portrait so the player can see
   * their character clearly. Dismissed by the backdrop, the ✕, or Escape.
   */
  private openLightbox(): void {
    if (!this.portraitSpec || this.lightbox) return;

    const overlay = document.createElement("div");
    overlay.className = "portrait-lightbox";

    const figure = document.createElement("div");
    figure.className = "portrait-lightbox-figure";
    figure.innerHTML = portraitCompositor.compose(this.portraitSpec);

    const close = document.createElement("button");
    close.type = "button";
    close.className = "portrait-lightbox-close";
    close.textContent = "✕";
    close.setAttribute("aria-label", "Close portrait");
    close.addEventListener("click", () => this.closeLightbox());
    figure.appendChild(close);

    const name = document.createElement("div");
    name.className = "portrait-lightbox-name";
    name.textContent = `${this.portraitSpec.gender} ${this.portraitSpec.characterClass}`;

    overlay.append(figure, name);
    // Click anywhere on the dim backdrop (outside the framed figure) to close.
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay || e.target === name) this.closeLightbox();
    });

    document.body.appendChild(overlay);
    document.addEventListener("keydown", this.onLightboxKey);
    this.lightbox = overlay;
  }

  private closeLightbox(): void {
    if (!this.lightbox) return;
    document.removeEventListener("keydown", this.onLightboxKey);
    this.lightbox.remove();
    this.lightbox = null;
  }
}
