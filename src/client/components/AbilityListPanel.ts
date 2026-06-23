/**
 * AbilityListPanel.ts — Right-panel content for the character/skills screen.
 *
 * Shows the ability loadout: a row of slots (filled or empty) plus the list of
 * known abilities. Clicking a filled slot's ✕ sends `unequip <n>`; each known
 * ability offers per-slot buttons that send `equip <id> <n>`. Slot numbers in
 * the command protocol are 1-based (the server converts to 0-based).
 *
 * The server validates every move and re-emits the view, so this panel is a
 * pure render of SkillScreenView — it holds no loadout state of its own.
 */

import type { SkillScreenView, SkillAbilityView } from "../../types/network";

export class AbilityListPanel {
  private readonly container: HTMLElement;
  private onCommand: ((command: string) => void) | null = null;

  constructor(containerId: string) {
    const el = document.getElementById(containerId);
    if (!el) throw new Error(`AbilityListPanel: missing container #${containerId}`);
    this.container = el;
  }

  public setCommandHandler(handler: (command: string) => void): void {
    this.onCommand = handler;
  }

  public update(view: SkillScreenView): void {
    this.container.innerHTML = "";

    const title = document.createElement("div");
    title.className = "panel-title";
    title.textContent = "◆ ABILITY SLOTS";
    this.container.appendChild(title);

    // Map slotted ability id → its display name for slot labels.
    const nameById = new Map(view.knownAbilities.map((a) => [a.id, a.name]));

    // ── Slots row ──
    const slots = document.createElement("div");
    slots.className = "ability-slots";
    view.abilitySlots.forEach((id, i) => {
      const slot = document.createElement("div");
      slot.className = `ability-slot ${id ? "ability-slot-filled" : "ability-slot-empty"}`;

      const num = document.createElement("span");
      num.className = "ability-slot-num";
      num.textContent = `${i + 1}`;
      slot.appendChild(num);

      const label = document.createElement("span");
      label.className = "ability-slot-label";
      label.textContent = id ? (nameById.get(id) ?? id) : "— empty —";
      slot.appendChild(label);

      if (id) {
        const clear = document.createElement("button");
        clear.className = "ability-slot-clear";
        clear.textContent = "✕";
        clear.title = "Unequip";
        clear.addEventListener("click", () => this.onCommand?.(`unequip ${i + 1}`));
        slot.appendChild(clear);
      }
      slots.appendChild(slot);
    });
    this.container.appendChild(slots);

    // ── Known abilities ──
    const divider = document.createElement("div");
    divider.className = "panel-divider";
    this.container.appendChild(divider);

    const knownTitle = document.createElement("div");
    knownTitle.className = "panel-title";
    knownTitle.textContent = "◆ KNOWN ABILITIES";
    this.container.appendChild(knownTitle);

    const list = document.createElement("div");
    list.className = "ability-list";
    const slotCount = view.abilitySlots.length;
    for (const ability of view.knownAbilities) {
      list.appendChild(this.renderAbility(ability, slotCount));
    }
    this.container.appendChild(list);
  }

  private renderAbility(ability: SkillAbilityView, slotCount: number): HTMLElement {
    const row = document.createElement("div");
    row.className = `ability-row ${ability.equipped ? "ability-row-equipped" : ""}`;

    const head = document.createElement("div");
    head.className = "ability-row-head";
    const name = document.createElement("span");
    name.className = "ability-name";
    name.textContent = ability.name;
    const tag = document.createElement("span");
    tag.className = "ability-tag";
    tag.textContent = ability.equipped ? `slot ${ability.slotIndex! + 1}` : ability.type;
    head.append(name, tag);
    row.appendChild(head);

    const desc = document.createElement("div");
    desc.className = "ability-desc";
    desc.textContent = ability.description;
    row.appendChild(desc);

    // Per-slot equip buttons (1-based). The currently-occupied slot is marked.
    const actions = document.createElement("div");
    actions.className = "ability-actions";
    for (let i = 0; i < slotCount; i++) {
      const btn = document.createElement("button");
      btn.className = "ability-slot-btn";
      btn.textContent = `${i + 1}`;
      const isHere = ability.slotIndex === i;
      btn.title = isHere ? `Already in slot ${i + 1}` : `Equip to slot ${i + 1}`;
      if (isHere) btn.classList.add("ability-slot-btn-active");
      btn.addEventListener("click", () => this.onCommand?.(`equip ${ability.id} ${i + 1}`));
      actions.appendChild(btn);
    }
    row.appendChild(actions);

    return row;
  }
}
