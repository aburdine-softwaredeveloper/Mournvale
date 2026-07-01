/**
 * CombatScreen.ts — Client-side tactical combat interface
 *
 * Mounts as an overlay over the game screen when combat_start is received.
 * Unmounts and calls onCombatEnd() when combat_end is received.
 *
 * Responsibilities:
 *   - Render the 8×8 combat board in a 2.5D isometric projection
 *   - Show entity tokens with HP bars
 *   - Highlight reachable tiles (blue) and attackable targets (red) on selection
 *   - Show action buttons (Move / Attack / Ability / End Turn)
 *   - Collect the player's plan and submit via onSubmitAction callback
 *   - Animate event playback (sequential, 300–700 ms per event)
 *   - Show the initiative order and combat log in a sidebar
 *
 * ── Rendering-layer swap seam (Godot-ready) ──────────────────────────────────
 * All combat *logic* is server-authoritative (see CombatManager): the client
 * only ever (a) consumes a CombatStateView and (b) emits a CombatActionSubmission.
 * The board's *presentation* is therefore fully replaceable. Today it is a CSS
 * 3D-transformed DOM grid (isometric projection). To drop in a Godot HTML5
 * module later, replace the `#cs-grid-wrap` subtree with the Godot <canvas> and
 * have it feed off the same two contracts — nothing else in the protocol moves.
 * The `projection` field below is the toggle between presentation modes; a Godot
 * renderer would be a third mode reading the identical state.
 */

/** Board presentation mode. Add "godot" here when that renderer lands. */
type Projection = "isometric" | "flat";

import type {
  CombatStateView,
  CombatEntityView,
  GridPosition,
  GridCellType,
  CombatEvent,
  CombatActionSubmission,
} from "../../types/combat";
import { TERRAIN, entryCost } from "../../types/combat";
import type {
  CombatStartMessage,
  CombatPlanningMessage,
  CombatResolutionMessage,
  CombatEndMessage,
} from "../../types/network";

type ActionMode = "idle" | "selecting_move" | "selecting_attack" | "selecting_ability";

interface Plan {
  move?: GridPosition;
  action?: CombatActionSubmission["action"];
  hasSubmitted: boolean;
}

/**
 * The visual "element" of an ability, driving the colour of its orb/burst. Ids
 * not listed fall back to a neutral arcane look; physical strikes (cleave, etc.)
 * have no projectile so they don't need an entry.
 */
const ABILITY_ELEMENT: Record<string, string> = {
  fireball: "fire", fire_bolt: "fire",
  frost_ray: "frost",
  guiding_bolt: "radiant", sacred_flame: "radiant",
  magic_missile: "force",
  whirlwind: "physical", cleave: "physical", quivering_palm: "physical",
  volley: "arrow", piercing_shot: "arrow", rapid_fire: "arrow", hunters_mark: "arrow",
};
function abilityElement(abilityId: string): string {
  return ABILITY_ELEMENT[abilityId] ?? "spell";
}

/** Defensive self-buffs glow cool; rallying/offensive ones glow warm. */
const DEFENSIVE_BUFFS = new Set([
  "shield_wall", "arcane_shield", "patient_defense", "vanish", "evasive_roll",
]);
function buffTone(abilityId: string): "ward" | "rally" {
  return DEFENSIVE_BUFFS.has(abilityId) ? "ward" : "rally";
}

export class CombatScreen {
  private readonly el: HTMLElement;
  private readonly playerId: string;
  private readonly onSubmitAction: (sub: CombatActionSubmission) => void;
  private readonly onCombatEnd: (outcome: string) => void;

  private state: CombatStateView | null = null;
  private projection: Projection = "isometric";
  private mode: ActionMode = "idle";
  private plan: Plan = { hasSubmitted: false };
  private pendingPlayerIds: string[] = [];
  private eventQueue: CombatEvent[] = [];
  private isAnimating = false;
  /** Cells the currently-animating mover has stepped through, for the trail. */
  private trail = new Set<string>();

  // Playback pacing (ms). Deliberately unhurried so a player can follow each
  // step, swing, and hit during the resolution replay. Tune here to taste.
  private static readonly MOVE_STEP_MS  = 230;  // per tile walked
  private static readonly MOVE_ARRIVE_MS = 320; // pause once the token arrives
  private static readonly HIT_MS         = 620; // a damage/heal lands
  private static readonly EVENT_MS       = 520; // a roll / generic beat
  private static readonly BIG_MS         = 1000; // a crit, a death, the finish

  constructor(
    container: HTMLElement,
    playerId: string,
    onSubmitAction: (sub: CombatActionSubmission) => void,
    onCombatEnd: (outcome: string) => void
  ) {
    this.el             = container;
    this.playerId       = playerId;
    this.onSubmitAction = onSubmitAction;
    this.onCombatEnd    = onCombatEnd;
  }

  // ─── Lifecycle ─────────────────────────────────────────────────────────────

  mount(): void {
    this.injectStyles();
    this.el.innerHTML = `
      <div id="cs-root">
        <div id="cs-header">
          <span id="cs-round">Round 1</span>
          <span id="cs-phase-label">Planning</span>
          <button id="cs-view-toggle" title="Toggle 2.5D / flat view">⬗ 2.5D</button>
          <span id="cs-waiting"></span>
        </div>
        <div id="cs-body">
          <div id="cs-grid-wrap">
            <div id="cs-grid"></div>
            <div id="cs-hint"><span class="cs-hint-icon">✦</span><span id="cs-hint-text">Your move. Pick an action on the right.</span></div>
          </div>
          <div id="cs-sidebar">
            <div class="cs-panel">
              <div class="cs-panel-title">Initiative</div>
              <div id="cs-init-list"></div>
            </div>
            <div class="cs-panel">
              <div class="cs-panel-title">Actions</div>
              <div id="cs-action-list"></div>
            </div>
            <div class="cs-panel cs-panel-log">
              <div class="cs-panel-title">Log</div>
              <div id="cs-log"></div>
            </div>
          </div>
        </div>
      </div>
    `;
    this.el.querySelector("#cs-view-toggle")?.addEventListener("click", () => this.toggleProjection());
  }

  unmount(): void {
    this.el.innerHTML = "";
  }

  // ─── Message handlers ──────────────────────────────────────────────────────

  handleCombatStart(msg: CombatStartMessage): void {
    this.state = msg.payload;
    this.resetPlan();
    this.render();
  }

  handleCombatPlanning(msg: CombatPlanningMessage): void {
    this.state             = msg.payload.state;
    this.pendingPlayerIds  = msg.payload.pendingPlayerIds;
    if (!msg.payload.pendingPlayerIds.includes(this.playerId)) {
      this.plan.hasSubmitted = true;
    }
    this.renderHeader();
    this.renderInitiative();
    this.renderActions();
    this.renderWaiting();
    this.setHint(this.baseHint());
  }

  handleCombatResolution(msg: CombatResolutionMessage): void {
    this.eventQueue.push(...msg.payload.events);
    const finalState = msg.payload.finalState;
    this.playbackEvents(() => {
      this.state = finalState;
      this.resetPlan();
      this.render();
    });
  }

  handleCombatEnd(msg: CombatEndMessage): void {
    this.showEndOverlay(msg);
  }

  // ─── Event playback ────────────────────────────────────────────────────────

  /**
   * Replays a resolved round on the board itself, not just the log. Each event
   * is applied to the working state (this.state, which still holds the pre-
   * resolution snapshot) and animated before the next plays — so tokens visibly
   * WALK their route, HP bars tick down on hits, and the fallen fade out. When
   * the queue drains, the caller swaps in the authoritative final state.
   */
  private playbackEvents(onDone: () => void): void {
    if (this.isAnimating) return;
    this.isAnimating = true;
    const next = (): void => {
      if (!this.eventQueue.length) {
        this.isAnimating = false;
        this.trail.clear();
        this.renderGrid();
        onDone();
        return;
      }
      const event = this.eventQueue.shift()!;
      this.appendLog(event);
      this.animateEvent(event, next);
    };
    next();
  }

  /** Apply + animate one event on the working board, then call `done`. */
  private animateEvent(event: CombatEvent, done: () => void): void {
    if (!this.state) { done(); return; }
    const recipient = event.targetId ?? event.entityId;

    switch (event.type) {
      case "move":
        this.animateMove(event, done);
        return;
      case "damage":
      case "burn_damage":
        this.applyHpDelta(recipient, -(event.value ?? 0));
        this.renderGrid();
        this.flashToken(recipient, "cs-token-hit");
        setTimeout(done, CombatScreen.HIT_MS);
        return;
      case "heal":
        this.applyHpDelta(recipient, event.value ?? 0);
        this.renderGrid();
        this.flashToken(recipient, "cs-token-heal");
        setTimeout(done, CombatScreen.HIT_MS);
        return;
      case "ability_used":
        this.animateAbility(event, done);
        return;
      case "entity_dies": {
        const e = this.state.entities.find(x => x.id === event.entityId);
        if (e) { e.isDead = true; this.clearGridCell(e.position); }
        this.renderGrid();
        setTimeout(done, CombatScreen.BIG_MS);
        return;
      }
      default: {
        const delay = ["attack_crit", "combat_ends"].includes(event.type)
          ? CombatScreen.BIG_MS : CombatScreen.EVENT_MS;
        setTimeout(done, delay);
      }
    }
  }

  /** Walk a token tile-by-tile along the server-provided path, leaving a trail. */
  private animateMove(event: CombatEvent, done: () => void): void {
    const e = this.state?.entities.find(x => x.id === event.entityId);
    const path = event.path;
    if (!e || !path || path.length < 2) {
      if (e && event.position) { this.moveWorkingEntity(e, event.position); this.renderGrid(); }
      setTimeout(done, CombatScreen.MOVE_ARRIVE_MS);
      return;
    }

    this.trail = new Set(path.map(p => `${p.x},${p.y}`));
    let i = 1;
    const walk = (): void => {
      if (i >= path.length) {
        // Let the arrival read for a beat, then fade the trail.
        setTimeout(() => { this.trail.clear(); this.renderGrid(); done(); }, CombatScreen.MOVE_ARRIVE_MS);
        return;
      }
      this.moveWorkingEntity(e, path[i]!);
      this.renderGrid();
      this.flashToken(e.id, "cs-token-step");
      i++;
      setTimeout(walk, CombatScreen.MOVE_STEP_MS);
    };
    walk();
  }

  /**
   * Animate an ability by reading the effects it's ABOUT to cause from the queued
   * events that follow it (the damage/heal this ability produces this turn):
   *   - heals          → a warm green-gold burst rises on each mended ally/self.
   *   - no targets      → a self/buff cast → a coloured aura swells on the caster.
   *   - one struck foe  → an element-tinted orb flies in and bursts.
   *   - many struck foes → an area spell: the orb flies to the centre, then a
   *                        shockwave ring and a burst bloom on every hit tile.
   * The caster always flares as they channel.
   */
  private animateAbility(event: CombatEvent, done: () => void): void {
    const caster = this.state?.entities.find(e => e.id === event.entityId);
    this.flashToken(event.entityId, "cs-token-cast");
    if (!caster) { setTimeout(done, CombatScreen.EVENT_MS); return; }

    const element = abilityElement(event.abilityId ?? "");
    const effects = this.collectAbilityEffects(caster.id);
    const heals   = effects.filter(e => e.kind === "heal").map(e => e.pos);
    const strikes = effects.filter(e => e.kind === "strike").map(e => e.pos);

    // Healing / support sparkles land on the mended.
    for (const p of heals) this.effectAt(p, "cs-fx cs-fx-heal", 650);

    const remote = strikes.filter(p => p.x !== caster.position.x || p.y !== caster.position.y);

    if (remote.length === 0) {
      // Pure buff / self ability (or a self-heal): a swelling aura on the caster.
      if (heals.length === 0) {
        this.effectAt(caster.position, `cs-fx cs-fx-buff cs-buff-${buffTone(event.abilityId ?? "")}`, 600);
      }
      setTimeout(done, CombatScreen.EVENT_MS);
      return;
    }

    // Offensive: an orb flies to the (primary) target tile, then detonates.
    const primary = remote[0]!;
    this.spellProjectile(caster.position, primary, element, () => {
      if (remote.length > 1) {
        // Area effect: a shockwave at the centre + a burst on every struck tile.
        this.effectAt(primary, `cs-fx cs-fx-shock cs-el-${element}`, 520);
        for (const p of remote) this.effectAt(p, `cs-fx cs-fx-burst cs-el-${element}`, 460);
      }
      setTimeout(done, remote.length > 1 ? 320 : 160);
    });
  }

  /**
   * The damage/heal effects an ability is about to apply this turn: scan the
   * queued events that immediately follow, belonging to the same caster, until
   * the next mover/caster. Strikes (damage, burns, hits AND misses) drive the
   * projectile; heals drive the green sparkle.
   */
  private collectAbilityEffects(casterId: string): Array<{ pos: GridPosition; kind: "strike" | "heal" }> {
    const out: Array<{ pos: GridPosition; kind: "strike" | "heal" }> = [];
    for (const e of this.eventQueue) {
      if (e.type === "move" || e.type === "ability_used") break;
      if (e.entityId !== casterId) break;
      if (!e.targetId) continue;
      const t = this.state?.entities.find(x => x.id === e.targetId);
      if (!t) continue;
      if (e.type === "heal") out.push({ pos: { ...t.position }, kind: "heal" });
      else if (["damage", "burn_damage", "attack_hit", "attack_miss"].includes(e.type)) {
        out.push({ pos: { ...t.position }, kind: "strike" });
      }
    }
    return out;
  }

  /** Centre of a grid cell in viewport coords (works through the iso transform). */
  private cellCenter(pos: GridPosition): { x: number; y: number } | null {
    const cell = this.el.querySelector(`#cs-grid .cs-cell[data-x="${pos.x}"][data-y="${pos.y}"]`);
    if (!cell) return null;
    const r = cell.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }

  /** Spawn a transient effect element centred on a tile, removed after lifeMs. */
  private effectAt(pos: GridPosition, className: string, lifeMs: number): void {
    const c = this.cellCenter(pos);
    if (!c) return;
    const fx = document.createElement("div");
    fx.className = className;
    fx.style.left = `${c.x}px`;
    fx.style.top  = `${c.y}px`;
    document.body.appendChild(fx);
    setTimeout(() => fx.remove(), lifeMs);
  }

  /** Fly an element-tinted orb from one tile to another, bursting on arrival. */
  private spellProjectile(from: GridPosition, to: GridPosition, element: string, onArrive: () => void): void {
    const a = this.cellCenter(from), b = this.cellCenter(to);
    if (!a || !b) { onArrive(); return; }
    const dx = b.x - a.x, dy = b.y - a.y;
    const orb = document.createElement("div");
    orb.className = `cs-projectile cs-el-${element}`;
    orb.style.left = `${a.x}px`;
    orb.style.top  = `${a.y}px`;
    document.body.appendChild(orb);
    // Next frame: glide to the target (CSS transitions the transform).
    requestAnimationFrame(() => {
      orb.style.transform = `translate(${dx}px, ${dy}px)`;
    });
    setTimeout(() => {
      // Burst AT the target — keep the translate, add scale + fade.
      orb.style.transition = "transform .26s ease, opacity .26s ease";
      orb.style.transform = `translate(${dx}px, ${dy}px) scale(3.4)`;
      orb.style.opacity = "0";
      setTimeout(() => orb.remove(), 280);
      onArrive();
    }, 360);
  }

  // ─── Working-state mutation (playback only) ──────────────────────────────────

  private moveWorkingEntity(e: CombatEntityView, to: GridPosition): void {
    if (!this.state) return;
    const fromCell = this.state.grid[e.position.y]?.[e.position.x];
    if (fromCell && fromCell.entityId === e.id) delete fromCell.entityId;
    e.position = { x: to.x, y: to.y };
    const toCell = this.state.grid[to.y]?.[to.x];
    if (toCell) toCell.entityId = e.id;
  }

  private clearGridCell(pos: GridPosition): void {
    const cell = this.state?.grid[pos.y]?.[pos.x];
    if (cell) delete cell.entityId;
  }

  private applyHpDelta(entityId: string, delta: number): void {
    const e = this.state?.entities.find(x => x.id === entityId);
    if (!e) return;
    e.hp = Math.max(0, Math.min(e.maxHp, e.hp + delta));
  }

  /** Briefly add a CSS class to an entity's token for a hit/heal/step flash. */
  private flashToken(entityId: string, cls: string): void {
    const token = this.el.querySelector(`.cs-token[data-entity-id="${entityId}"]`) as HTMLElement | null;
    if (!token) return;
    token.classList.add(cls);
    setTimeout(() => token.classList.remove(cls), 300);
  }

  // ─── Render ────────────────────────────────────────────────────────────────

  private render(): void {
    this.renderHeader();
    this.renderGrid();
    this.renderInitiative();
    this.renderActions();
    this.renderWaiting();
    this.setHint(this.baseHint());
  }

  private renderHeader(): void {
    if (!this.state) return;
    const roundEl = this.el.querySelector("#cs-round");
    const phaseEl = this.el.querySelector("#cs-phase-label");
    if (roundEl) roundEl.textContent = `Round ${this.state.round}`;
    if (phaseEl) phaseEl.textContent = this.state.phase === "planning" ? "Planning" : "Resolving…";
  }

  /** Update the hover-info bar under the board. */
  private setHint(text: string): void {
    const el = this.el.querySelector("#cs-hint-text");
    if (el) el.textContent = text;
  }

  /** The resting hint for the current mode (shown when nothing is hovered). */
  private baseHint(): string {
    const me = this.myEntity();
    if (!me || this.plan.hasSubmitted) return "Waiting for the round to resolve…";
    switch (this.mode) {
      case "selecting_move":
        return `Move — up to ${me.speed} tiles (glowing). Hover one to preview the route, click to set it.`;
      case "selecting_attack":
        return "Attack — shaded tiles are in reach. Click a target ringed in red.";
      case "selecting_ability":
        return "Ability — shaded tiles show valid targets. Click one (or it hits you).";
      default:
        return "Your move. Choose Move, Attack, or an ability on the right.";
    }
  }

  private renderWaiting(): void {
    const el = this.el.querySelector("#cs-waiting");
    if (!el) return;
    el.textContent = (this.plan.hasSubmitted && this.pendingPlayerIds.length > 0)
      ? `Waiting for ${this.pendingPlayerIds.length} player${this.pendingPlayerIds.length > 1 ? "s" : ""}…`
      : "";
  }

  private renderGrid(): void {
    const grid = this.el.querySelector("#cs-grid") as HTMLElement | null;
    if (!grid || !this.state) return;

    const me        = this.myEntity();
    const reachable = me && this.mode === "selecting_move" ? this.reachableCells(me) : new Set<string>();
    // Tiles + targets in range of the chosen action, shaded so it's obvious what
    // the button can reach before you commit. Movement range is folded into the
    // shaded tiles too, so EVERY action lights up its full reach the moment you
    // pick it — not only on hover.
    const range     = me ? this.actionRange(me) : { tiles: new Set<string>(), targetIds: new Set<string>(), isAbility: false };
    for (const k of reachable) range.tiles.add(k);

    grid.innerHTML = "";
    grid.style.display              = "grid";
    grid.style.gridTemplateColumns  = "repeat(8, 60px)";
    grid.style.gridTemplateRows     = "repeat(8, 60px)";
    grid.style.gap                  = "2px";
    grid.classList.toggle("cs-iso", this.projection === "isometric");
    // Room-appropriate board palette (e.g. grey stone for the tavern cellar).
    grid.classList.toggle("cs-theme-cellar", this.themeForRoom(this.state.roomId) === "cellar");

    for (let row = 0; row < 8; row++) {
      for (let col = 0; col < 8; col++) {
        const cell    = this.state.grid[row]?.[col];
        const posKey  = `${col},${row}`;
        const entity  = cell?.entityId
          ? this.state.entities.find(e => e.id === cell.entityId)
          : undefined;

        const div = document.createElement("div");
        div.className = "cs-cell";
        div.dataset.x = String(col);
        div.dataset.y = String(row);
        div.addEventListener("mouseenter", () => this.onCellHover({ x: col, y: row }));
        div.addEventListener("mouseleave", () => this.onCellLeave());
        const terrain = (cell?.type ?? "floor") as GridCellType;
        if (terrain !== "floor") {
          div.classList.add(`cell-${terrain}`);
          div.title = TERRAIN[terrain].label;
        }
        // Standing 3D props for scenery terrain (billboarded upright in iso).
        if (terrain === "barrel" || terrain === "crate" || terrain === "cover") {
          const prop = document.createElement("div");
          prop.className = `cs-prop cs-prop-${terrain}`;
          div.appendChild(prop);
        }
        if (!cell?.passable)           div.classList.add("cell-wall");
        if (this.trail.has(posKey))    div.classList.add("cell-trail");
        if (range.tiles.has(posKey))   div.classList.add("cell-range");
        if (reachable.has(posKey))     div.classList.add("cell-move");
        if (entity && range.targetIds.has(entity.id)) div.classList.add(range.isAbility ? "cell-target" : "cell-attack");
        if (this.plan.move?.x === col && this.plan.move?.y === row) div.classList.add("cell-planned");

        if (entity) {
          const isMine = entity.id === me?.id;
          const token  = document.createElement("div");
          token.className = [
            "cs-token",
            entity.type === "player" ? "cs-token-player" : "cs-token-enemy",
            isMine ? "cs-token-mine" : "",
            entity.isDead ? "cs-token-dead" : "",
          ].join(" ");
          token.title = `${entity.name} — ${entity.hp}/${entity.maxHp} HP (AC ${entity.ac})`;
          token.dataset.entityId = entity.id;

          const letter = document.createElement("span");
          letter.className   = "cs-token-letter";
          letter.textContent = entity.name.charAt(0).toUpperCase();

          const hpWrap = document.createElement("div");
          hpWrap.className = "cs-hp-wrap";
          const hpFill = document.createElement("div");
          hpFill.className = "cs-hp-fill";
          const pct = Math.round((entity.hp / entity.maxHp) * 100);
          hpFill.style.width      = `${pct}%`;
          // Oxblood when wounded, moss when healthy — muted, book-like.
          hpFill.style.background = pct <= 30 ? "#8a3b2a" : "#5c6442";
          hpWrap.appendChild(hpFill);

          token.appendChild(letter);
          token.appendChild(hpWrap);
          div.appendChild(token);

          if (!entity.isDead && range.targetIds.has(entity.id)) {
            div.addEventListener("click", () =>
              range.isAbility ? this.selectAbilityTarget(entity.id) : this.selectAttackTarget(entity.id)
            );
          }
        }

        if (!entity && reachable.has(posKey)) {
          div.addEventListener("click", () => this.selectMoveDestination({ x: col, y: row }));
        }

        grid.appendChild(div);
      }
    }
  }

  private renderInitiative(): void {
    const list = this.el.querySelector("#cs-init-list") as HTMLElement | null;
    if (!list || !this.state) return;
    list.innerHTML = "";
    for (const id of this.state.initiativeOrder) {
      const e = this.state.entities.find(x => x.id === id);
      if (!e) continue;
      const row = document.createElement("div");
      row.className = [
        "cs-init-row",
        e.isDead ? "cs-init-dead" : "",
        e.id === this.myEntity()?.id ? "cs-init-mine" : "",
      ].join(" ");
      row.innerHTML = `<span class="cs-init-name">${e.name}</span>
                       <span class="cs-init-hp">${e.hp}/${e.maxHp}</span>
                       <span class="cs-init-badge">${e.initiative}</span>`;
      list.appendChild(row);
    }
  }

  private renderActions(): void {
    const panel = this.el.querySelector("#cs-action-list") as HTMLElement | null;
    if (!panel) return;
    panel.innerHTML = "";

    const me = this.myEntity();
    if (!me || this.plan.hasSubmitted) {
      panel.innerHTML = '<p class="cs-muted">Waiting…</p>';
      return;
    }

    const moveBtn = this.actionBtn("Move", this.mode === "selecting_move", () => this.toggleMode("selecting_move"));
    this.onHover(moveBtn, `Move — travel up to ${me.speed} tiles. Rough ground (rubble) costs extra.`);
    panel.appendChild(moveBtn);

    const atkBtn = this.actionBtn("Attack", this.mode === "selecting_attack", () => this.toggleMode("selecting_attack"));
    this.onHover(atkBtn, me.weapon ? `Attack — ${me.weapon.name}, reach ${me.weapon.range} tile${me.weapon.range > 1 ? "s" : ""}.` : "Attack a target in reach.");
    panel.appendChild(atkBtn);

    for (const ability of me.abilities ?? []) {
      const btn = this.actionBtn(ability.name, false,
        ability.usesLeft > 0 ? () => this.selectAbility(ability.id, ability.targetType) : undefined
      );
      btn.title = ability.description;
      this.onHover(btn, this.abilityHint(ability));
      if (ability.usesLeft <= 0) btn.setAttribute("disabled", "true");
      panel.appendChild(btn);
    }

    if (this.plan.move || this.plan.action) {
      const summary = document.createElement("div");
      summary.className   = "cs-plan-summary";
      const parts: string[] = [];
      if (this.plan.move)   parts.push(`Move → (${this.plan.move.x},${this.plan.move.y})`);
      if (this.plan.action) parts.push(this.plan.action.type);
      summary.textContent = parts.join(" + ");
      panel.appendChild(summary);

      const confirm = this.actionBtn("Confirm turn", false, () => this.confirmSubmit());
      confirm.classList.add("cs-btn-confirm");
      panel.appendChild(confirm);
    }

    const endBtn = this.actionBtn("End turn", false, () => this.submitEndTurn());
    panel.appendChild(endBtn);
  }

  // ─── Interaction ───────────────────────────────────────────────────────────

  private toggleProjection(): void {
    this.projection = this.projection === "isometric" ? "flat" : "isometric";
    const btn = this.el.querySelector("#cs-view-toggle");
    if (btn) btn.textContent = this.projection === "isometric" ? "⬗ 2.5D" : "▦ Flat";
    this.renderGrid();
  }

  private toggleMode(mode: ActionMode): void {
    this.mode = this.mode === mode ? "idle" : mode;
    this.clearPathPreview();
    this.renderGrid();
    this.renderActions();
    this.setHint(this.baseHint());
  }

  private selectMoveDestination(pos: GridPosition): void {
    this.plan.move = pos;
    this.mode      = "idle";
    this.clearPathPreview();
    this.renderGrid();
    this.renderActions();
    this.setHint(`Move set → (${pos.x}, ${pos.y}). Add an attack or ability, then Confirm turn.`);
  }

  private selectAttackTarget(targetId: string): void {
    this.plan.action = { type: "attack", targetEntityId: targetId };
    this.mode        = "idle";
    this.renderGrid();
    this.renderActions();
    const name = this.state?.entities.find(e => e.id === targetId)?.name ?? "your target";
    this.setHint(`Attack set → ${name}. Confirm turn when ready.`);
  }

  private selectAbility(abilityId: string, targetType?: string): void {
    const name = this.myEntity()?.abilities?.find(a => a.id === abilityId)?.name ?? "ability";
    if (!targetType || targetType === "self") {
      this.plan.action = { type: "ability", abilityId };
      this.mode        = "idle";
      this.renderGrid();
      this.renderActions();
      this.setHint(`${name} set (on yourself). Confirm turn when ready.`);
    } else {
      this.plan.action = { type: "ability", abilityId };
      this.mode        = "selecting_ability";
      this.renderGrid();
      this.renderActions();
      this.setHint(`${name} — click a highlighted ${targetType === "ally" ? "ally" : "enemy"} to target.`);
    }
  }

  private selectAbilityTarget(targetId: string): void {
    const abilityId = this.plan.action?.abilityId;
    if (!abilityId) return;
    this.plan.action = { type: "ability", abilityId, targetEntityId: targetId };
    this.mode        = "idle";
    this.renderGrid();
    this.renderActions();
    const name = this.state?.entities.find(e => e.id === targetId)?.name ?? "your target";
    this.setHint(`Ability set → ${name}. Confirm turn when ready.`);
  }

  private confirmSubmit(): void {
    const me = this.myEntity();
    if (!me || !this.state) return;

    // Guard the easy mistake: an ability that needs a target but never got one
    // would silently fizzle on the server. Block the submit and say why, rather
    // than wasting the player's turn.
    if (this.plan.action?.type === "ability" && !this.plan.action.targetEntityId) {
      const ability = me.abilities?.find(a => a.id === this.plan.action?.abilityId);
      if (ability && (ability.targetType === "enemy" || ability.targetType === "ally")) {
        this.mode = "selecting_ability";
        this.renderGrid();
        this.setHint(`Pick a target for ${ability.name} first — click a highlighted ${ability.targetType === "ally" ? "ally" : "enemy"}.`);
        return;
      }
    }

    this.onSubmitAction({
      entityId: me.id,
      ...(this.plan.move && { move: this.plan.move }),
      ...(this.plan.action && { action: this.plan.action }),
    });
    this.plan.hasSubmitted = true;
    this.mode = "idle";
    this.renderActions();
    this.renderWaiting();
  }

  private submitEndTurn(): void {
    const me = this.myEntity();
    if (!me) return;
    this.onSubmitAction({ entityId: me.id, action: { type: "end_turn" } });
    this.plan.hasSubmitted = true;
    this.renderActions();
    this.renderWaiting();
  }

  // ─── Log ───────────────────────────────────────────────────────────────────

  private appendLog(event: CombatEvent): void {
    const log = this.el.querySelector("#cs-log") as HTMLElement | null;
    if (!log) return;
    const entry = document.createElement("div");
    entry.className = `cs-log-entry cs-log-${event.type}`;
    entry.textContent = event.text;
    log.appendChild(entry);
    if (log.children.length > 60) log.removeChild(log.children[0]!);
    log.scrollTop = log.scrollHeight;
  }

  // ─── End overlay ───────────────────────────────────────────────────────────

  private showEndOverlay(msg: CombatEndMessage): void {
    const root = this.el.querySelector("#cs-root");
    if (!root) return;
    const win     = msg.payload.outcome === "players_win";
    const overlay = document.createElement("div");
    overlay.className = "cs-end-overlay";
    overlay.innerHTML = `
      <div class="cs-end-card">
        <h2 class="cs-end-title">${win ? "Victory!" : "Defeated"}</h2>
        <p class="cs-end-body">${win
          ? `+${msg.payload.xpReward} XP &nbsp;·&nbsp; +${msg.payload.goldReward} gold`
          : "The party has fallen…"
        }</p>
        <button id="cs-return-btn">Return</button>
      </div>
    `;
    root.appendChild(overlay);
    overlay.querySelector("#cs-return-btn")?.addEventListener("click", () =>
      this.onCombatEnd(msg.payload.outcome)
    );
  }

  // ─── Helpers ───────────────────────────────────────────────────────────────

  /**
   * Presentational board palette for a room. Purely cosmetic (the server owns
   * what terrain is actually there), so this small roomId→theme mapping lives on
   * the client. Unknown rooms use the default parchment battle-map look.
   */
  private themeForRoom(roomId: string): "cellar" | "default" {
    return roomId === "cellar" ? "cellar" : "default";
  }

  private myEntity(): CombatEntityView | undefined {
    if (!this.state?.myEntityId) return undefined;
    return this.state.entities.find(e => e.id === this.state!.myEntityId);
  }

  private resetPlan(): void {
    this.plan             = { hasSubmitted: false };
    this.mode             = "idle";
    this.pendingPlayerIds = [];
  }

  /**
   * Tiles the entity can reach this turn, honoring terrain entry costs (rubble
   * costs 2). Uniform-cost search that mirrors the server's findPath, so the
   * blue highlight never offers a tile the server would reject.
   */
  private reachableCells(entity: CombatEntityView): Set<string> {
    if (!this.state) return new Set();
    const reachable = new Set<string>();
    const best = new Map<string, number>([[`${entity.position.x},${entity.position.y}`, 0]]);
    const dirs: Array<[number, number]> = [[-1,0],[1,0],[0,-1],[0,1],[-1,-1],[1,-1],[-1,1],[1,1]];
    const frontier: Array<{ pos: GridPosition; cost: number }> = [{ pos: entity.position, cost: 0 }];
    while (frontier.length) {
      let bi = 0;
      for (let i = 1; i < frontier.length; i++) if (frontier[i]!.cost < frontier[bi]!.cost) bi = i;
      const { pos, cost } = frontier.splice(bi, 1)[0]!;
      const key = `${pos.x},${pos.y}`;
      if (cost > (best.get(key) ?? Infinity)) continue;
      if (cost > 0) reachable.add(key);
      for (const [dx, dy] of dirs) {
        const nx = pos.x + dx, ny = pos.y + dy;
        if (nx < 0 || ny < 0 || ny >= 8 || nx >= 8) continue;
        const cell = this.state!.grid[ny]?.[nx];
        if (!cell?.passable) continue;
        if (cell.entityId && cell.entityId !== entity.id) continue;
        const next = cost + entryCost(cell.type);
        if (next > entity.speed) continue;
        const nk = `${nx},${ny}`;
        if (next < (best.get(nk) ?? Infinity)) {
          best.set(nk, next);
          frontier.push({ pos: { x: nx, y: ny }, cost: next });
        }
      }
    }
    return reachable;
  }

  // ─── Hover guidance (accessibility / readability) ────────────────────────────

  /** React to the cursor entering a tile: preview a route, or explain what's there. */
  private onCellHover(pos: GridPosition): void {
    if (!this.state) return;
    const me     = this.myEntity();
    const cell   = this.state.grid[pos.y]?.[pos.x];
    const entity = cell?.entityId ? this.state.entities.find(e => e.id === cell.entityId) : undefined;

    // Move mode over a reachable empty tile → draw the route and show the cost.
    if (me && !this.plan.hasSubmitted && this.mode === "selecting_move" && !entity) {
      const route = this.pathTo(me, pos);
      if (route) {
        this.showPathPreview(route.path);
        const left = me.speed - route.cost;
        this.setHint(`Move here — costs ${route.cost} of ${me.speed} movement (${left} left).`);
        return;
      }
    }
    this.clearPathPreview();

    if (entity) { this.setHint(this.entityHint(entity, me)); return; }
    if (cell && cell.type !== "floor") { this.setHint(this.terrainHint(cell.type)); return; }
    this.setHint(this.baseHint());
  }

  private onCellLeave(): void {
    this.clearPathPreview();
    this.setHint(this.baseHint());
  }

  /** One-line read on a combatant: vitals, and reach in attack mode. */
  private entityHint(e: CombatEntityView, me: CombatEntityView | undefined): string {
    if (e.isDead) return `${e.name} — down.`;
    const vitals = `${e.name} — ${e.hp}/${e.maxHp} HP, AC ${e.ac}`;
    if (me && this.mode === "selecting_attack" && e.type !== me.type && me.weapon) {
      const dist = this.manhattan(e.position, this.actionOrigin(me));
      const fromMove = this.plan.move ? " after your move" : "";
      return dist <= me.weapon.range
        ? `${vitals}. In reach${fromMove} (range ${dist}/${me.weapon.range}) — click to strike.`
        : `${vitals}. Too far — range ${dist}, your weapon reaches ${me.weapon.range}.`;
    }
    const cond = e.conditions.length ? ` · ${e.conditions.join(", ")}` : "";
    return `${vitals}${cond}.`;
  }

  /** Plain-language explanation of a terrain tile's effect. */
  private terrainHint(type: GridCellType): string {
    const m = TERRAIN[type];
    if (!m.passable) return `${m.label} — blocks the way; move around it.`;
    const effects: string[] = [];
    if (m.moveCost > 1)     effects.push(`costs ${m.moveCost} movement to cross`);
    if (m.coverBonus > 0)   effects.push(`+${m.coverBonus} AC while you fight from here`);
    if (m.hazardDamage > 0) effects.push(`${m.hazardDamage} fire damage if you end your move here`);
    return effects.length ? `${m.label} — ${effects.join("; ")}.` : `${m.label}.`;
  }

  /**
   * Shortest route from an entity to `dest` honoring terrain cost — the same
   * uniform-cost search as reachableCells, but tracking predecessors so it can
   * return the actual path (for the on-hover preview). Null if out of range.
   */
  private pathTo(entity: CombatEntityView, dest: GridPosition): { path: GridPosition[]; cost: number } | null {
    if (!this.state) return null;
    const key = (p: GridPosition) => `${p.x},${p.y}`;
    const start = entity.position;
    if (dest.x === start.x && dest.y === start.y) return { path: [start], cost: 0 };
    const best = new Map<string, number>([[key(start), 0]]);
    const prev = new Map<string, GridPosition>();
    const dirs: Array<[number, number]> = [[-1,0],[1,0],[0,-1],[0,1],[-1,-1],[1,-1],[-1,1],[1,1]];
    const frontier: Array<{ pos: GridPosition; cost: number }> = [{ pos: start, cost: 0 }];
    while (frontier.length) {
      let bi = 0;
      for (let i = 1; i < frontier.length; i++) if (frontier[i]!.cost < frontier[bi]!.cost) bi = i;
      const { pos, cost } = frontier.splice(bi, 1)[0]!;
      if (cost > (best.get(key(pos)) ?? Infinity)) continue;
      if (pos.x === dest.x && pos.y === dest.y) {
        const path: GridPosition[] = [pos];
        let cur = pos;
        while (prev.has(key(cur))) { cur = prev.get(key(cur))!; path.unshift(cur); }
        return { path, cost };
      }
      for (const [dx, dy] of dirs) {
        const nx = pos.x + dx, ny = pos.y + dy;
        if (nx < 0 || ny < 0 || ny >= 8 || nx >= 8) continue;
        const c = this.state.grid[ny]?.[nx];
        if (!c?.passable) continue;
        if (c.entityId && c.entityId !== entity.id) continue;
        const next = cost + entryCost(c.type);
        if (next > entity.speed) continue;
        const nk = `${nx},${ny}`;
        if (next < (best.get(nk) ?? Infinity)) {
          best.set(nk, next);
          prev.set(nk, pos);
          frontier.push({ pos: { x: nx, y: ny }, cost: next });
        }
      }
    }
    return null;
  }

  private showPathPreview(path: GridPosition[]): void {
    this.clearPathPreview();
    path.forEach((p, i) => {
      if (i === 0) return; // origin tile
      const cell = this.el.querySelector(`#cs-grid .cs-cell[data-x="${p.x}"][data-y="${p.y}"]`);
      cell?.classList.add(i === path.length - 1 ? "cell-dest" : "cell-path");
    });
  }

  private clearPathPreview(): void {
    this.el.querySelectorAll("#cs-grid .cell-path, #cs-grid .cell-dest")
      .forEach(c => c.classList.remove("cell-path", "cell-dest"));
  }

  private manhattan(a: GridPosition, b: GridPosition): number {
    return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
  }

  /**
   * The position an action reaches FROM. If a move is already planned, that's
   * the tile the entity will be standing on when its action resolves (the server
   * processes move-then-action), so attacks and abilities are measured from
   * there — which is exactly what lets a player move AND strike in one turn.
   */
  private actionOrigin(entity: CombatEntityView): GridPosition {
    return this.plan.move ?? entity.position;
  }

  /**
   * What the currently-selected action can reach: the tiles to shade and the
   * entities that are valid, clickable targets. Computed from the post-move
   * origin so range shading updates the moment a move is planned.
   *   - attack  → weapon-range tiles; enemies within are targets.
   *   - ability → by targetType: enemies (damage), allies+self (support), or just
   *     self. Abilities have no server-side range cap, so every valid target is lit.
   */
  private actionRange(me: CombatEntityView): { tiles: Set<string>; targetIds: Set<string>; isAbility: boolean } {
    const tiles = new Set<string>();
    const targetIds = new Set<string>();
    if (!this.state || this.plan.hasSubmitted) return { tiles, targetIds, isAbility: false };
    const origin = this.actionOrigin(me);

    if (this.mode === "selecting_attack" && me.weapon) {
      const R = me.weapon.range;
      for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
        if (x === origin.x && y === origin.y) continue;
        if (this.manhattan({ x, y }, origin) <= R) tiles.add(`${x},${y}`);
      }
      for (const e of this.state.entities) {
        if (e.type !== me.type && !e.isDead && this.manhattan(e.position, origin) <= R) targetIds.add(e.id);
      }
      return { tiles, targetIds, isAbility: false };
    }

    if (this.mode === "selecting_ability") {
      const ability = me.abilities?.find(a => a.id === this.plan.action?.abilityId);
      const tt = ability?.targetType;
      const want: "enemy" | "ally" | null = tt === "enemy" ? "enemy" : tt === "ally" ? "ally" : null;
      const reach = ability?.range ?? Infinity;
      if (want) {
        // Shade the reachable tiles (like attack) so the ability's range reads…
        for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
          if (x === origin.x && y === origin.y) continue;
          if (this.manhattan({ x, y }, origin) <= reach) tiles.add(`${x},${y}`);
        }
        // …and only in-reach living targets of the right side are clickable.
        for (const e of this.state.entities) {
          if (e.isDead) continue;
          const match = want === "enemy" ? e.type !== me.type : e.type === me.type;
          if (match && this.manhattan(e.position, origin) <= reach) targetIds.add(e.id);
        }
      }
      return { tiles, targetIds, isAbility: true };
    }

    return { tiles, targetIds, isAbility: false };
  }

  /** Make an element explain itself in the hint bar while hovered. */
  private onHover(el: HTMLElement, hint: string): void {
    el.addEventListener("mouseenter", () => this.setHint(hint));
    el.addEventListener("mouseleave", () => this.setHint(this.baseHint()));
  }

  /** A full read on an ability: what it does, who it targets, uses remaining. */
  private abilityHint(a: NonNullable<CombatEntityView["abilities"]>[number]): string {
    const target =
      a.targetType === "self"  ? "on yourself" :
      a.targetType === "ally"  ? "on an ally"  :
      a.targetType === "enemy" ? "on an enemy" : "";
    const uses = a.usesLeft > 0 ? `${a.usesLeft} use${a.usesLeft > 1 ? "s" : ""} left` : "no uses left this fight";
    return `${a.name} — ${a.description} (${[target, uses].filter(Boolean).join(", ")}).`;
  }

  private actionBtn(label: string, active: boolean, onClick?: () => void): HTMLButtonElement {
    const btn = document.createElement("button");
    btn.className   = `cs-btn${active ? " cs-btn-active" : ""}`;
    btn.textContent = label;
    if (onClick) btn.addEventListener("click", onClick);
    else btn.setAttribute("disabled", "true");
    return btn;
  }

  // ─── Styles ────────────────────────────────────────────────────────────────

  private injectStyles(): void {
    if (document.getElementById("mournvale-combat-styles")) return;
    const s = document.createElement("style");
    s.id = "mournvale-combat-styles";
    // Spellbook theme: a parchment battle-map laid on the dark leather cover.
    // Tokens read by warm hue (leather ally / oxblood foe, gold "mine" ring);
    // sidebar panels are parchment pages printed in sepia ink.
    s.textContent = `
      #cs-root { display:flex; flex-direction:column; height:100%; background:#241f1a; color:#e8dcc0; font-family:inherit; }
      #cs-header { display:flex; align-items:center; gap:16px; padding:8px 16px; background:rgba(0,0,0,.3); font-size:13px; border-bottom:1px solid rgba(216,184,120,.18); }
      #cs-round { font-weight:500; color:#e8dcc0; }
      #cs-phase-label { color:#b8915a; }
      #cs-view-toggle { background:rgba(216,184,120,.12); border:1px solid rgba(216,184,120,.32); color:#d8b878; font-size:11px; padding:3px 9px; border-radius:5px; cursor:pointer; font-family:inherit; }
      #cs-view-toggle:hover { background:rgba(216,184,120,.22); }
      #cs-waiting { margin-left:auto; color:#d8b878; font-size:12px; }
      #cs-body { display:flex; flex:1; gap:12px; padding:12px; overflow:hidden; }
      /* Perspective stage — the swap seam: a Godot <canvas> would replace #cs-grid. */
      #cs-grid-wrap { position:relative; flex:1; display:flex; align-items:center; justify-content:center; overflow:auto; perspective:1300px; perspective-origin:50% 38%; }
      /* Hover-guidance bar: always-visible plain-language read of what you're pointing at. */
      #cs-hint { position:absolute; left:12px; right:12px; bottom:10px; z-index:5;
        display:flex; align-items:center; gap:8px; padding:8px 12px;
        background:rgba(28,22,16,.82); border:1px solid rgba(216,184,120,.28); border-radius:7px;
        color:#ece0c4; font-size:12.5px; line-height:1.4; pointer-events:none;
        box-shadow:0 3px 10px rgba(0,0,0,.4); }
      .cs-hint-icon { color:#d8b878; flex-shrink:0; }
      #cs-hint-text { flex:1; }
      #cs-grid { transition:transform .45s ease; transform-style:preserve-3d; }
      /* 2.5D isometric (dimetric) tilt — the board lies on a ground plane. */
      #cs-grid.cs-iso { transform:rotateX(55deg) rotateZ(45deg); }
      .cs-cell { width:60px; height:60px; background:#c9b489; border:1px solid #8a6f48; border-radius:4px; display:flex; align-items:center; justify-content:center; position:relative; box-sizing:border-box; transform-style:preserve-3d; }
      .cs-iso .cs-cell { box-shadow:inset 0 0 0 1px rgba(120,96,56,.5), 0 1px 0 rgba(60,44,24,.35); }
      .cell-wall { background:#6e5836; border-color:#5a4630; }
      /* Interaction highlights are scoped under #cs-grid so their specificity
         (id + class) beats any board THEME rule (e.g. the cellar's grey
         ".cs-theme-cellar .cs-cell"), which would otherwise hide them. */
      #cs-grid .cell-move { background:rgba(92,100,66,.5); border-color:#7c8a52; cursor:pointer; }
      #cs-grid .cell-move:hover { background:rgba(92,100,66,.68); }
      /* Route preview: the path the token would walk to the hovered tile. */
      #cs-grid .cell-path { background:rgba(216,184,120,.4); border-color:#caa468; }
      #cs-grid .cell-path::before { content:""; position:absolute; inset:38%; border-radius:50%; background:rgba(216,184,120,.85); }
      #cs-grid .cell-dest { background:rgba(216,184,120,.55); border:2px solid #e6c074;
        box-shadow:0 0 8px 2px rgba(216,184,120,.5); }
      #cs-grid .cell-attack { background:rgba(170,64,44,.5); border-color:#b04632; cursor:crosshair; }
      #cs-grid .cell-attack:hover { background:rgba(170,64,44,.66); }
      /* Range shadow — a soft inset vignette marking every tile the chosen
         action can reach, so range is legible the moment you pick a button. */
      #cs-grid .cell-range { box-shadow:inset 0 0 16px 5px rgba(20,12,6,.42); }
      #cs-grid.cs-iso .cell-range { box-shadow:inset 0 0 14px 4px rgba(20,12,6,.5); }
      /* Ability target tile (heal an ally, etc.) — a gold, clickable highlight. */
      #cs-grid .cell-target { background:rgba(216,184,120,.45); border-color:#caa468; cursor:pointer; }
      #cs-grid .cell-target:hover { background:rgba(216,184,120,.6); }
      #cs-grid .cell-planned { border:2px dashed #f0c878; }
      /* ── Tactical terrain ── */
      /* Rubble: broken stone — difficult ground, mottled grey. */
      .cell-rubble { background:
          radial-gradient(circle at 30% 35%, #9a8d76 0 3px, transparent 3px),
          radial-gradient(circle at 68% 62%, #8a7d66 0 4px, transparent 4px),
          radial-gradient(circle at 50% 80%, #7d7058 0 2px, transparent 2px),
          #a89878; border-color:#776a4f; }
      /* Cover: crates / low wall you fight from — bluish stone with a notch. */
      .cell-cover { background:
          linear-gradient(135deg, #8c9aa6 0 50%, #76828d 50% 100%);
          border:2px solid #5d6975; box-shadow:inset 0 0 0 2px rgba(255,255,255,.12); }
      /* Embers: hazard — a banked glow that flickers. */
      .cell-embers { background:
          radial-gradient(circle at 50% 60%, #ffb347 0 18%, #d8551f 40%, #7a2410 100%);
          border-color:#5a1c0c; animation:cs-ember 1.3s ease-in-out infinite alternate; }
      @keyframes cs-ember { from { filter:brightness(.85); } to { filter:brightness(1.2); } }
      /* Basement props — plain impassable scenery. Rendered as standing 3D
         objects (see .cs-prop) that billboard upright in the iso view; the tile
         itself keeps a soft contact shadow so they read as sitting on the floor. */
      .cell-barrel, .cell-crate { background:#b4b0a6; border-color:#6e6b64; }
      .cell-barrel::after, .cell-crate::after, .cell-cover::after {
        content:""; position:absolute; left:50%; top:62%; width:62%; height:30%;
        transform:translate(-50%,-50%); border-radius:50%;
        background:radial-gradient(ellipse, rgba(20,12,6,.5) 0 55%, rgba(20,12,6,0) 75%); }
      /* A prop billboards upright off its tile so it stands like a real object. */
      .cs-prop { position:absolute; left:50%; bottom:14%; transform-origin:center bottom;
        transform:translateX(-50%); }
      .cs-iso .cs-prop { transform:translateX(-50%) rotateZ(-45deg) rotateX(-55deg) translateZ(10px); }
      /* Barrel — a staved cask with hoop bands and a curved wood gradient. */
      .cs-prop-barrel { width:26px; height:34px; border-radius:42% 42% 30% 30% / 26% 26% 18% 18%;
        background:linear-gradient(90deg,#3e2814 0%,#6e4a2a 22%,#9a6c3c 46%,#6e4a2a 70%,#3a2512 100%);
        border:1px solid #2c1c0d;
        box-shadow:inset 0 6px 0 -4px rgba(20,12,4,.6), inset 0 -6px 0 -4px rgba(20,12,4,.6),
                   inset 0 0 0 1px rgba(225,185,120,.25), 0 6px 7px rgba(15,9,4,.55); }
      /* Crate — a planked box with a lighter top face for a 3D read. */
      .cs-prop-crate { width:30px; height:28px;
        background:linear-gradient(135deg,#8a6536 0%,#a37c48 48%,#6f5028 100%);
        border:2px solid #4c3318;
        box-shadow:inset 0 0 0 2px rgba(20,12,4,.18), inset 0 9px 0 -7px rgba(255,230,180,.3),
                   inset 9px 0 0 -7px rgba(255,230,180,.15), 0 6px 7px rgba(15,9,4,.5); }
      /* Cover — a low stone barricade you fight from. */
      .cs-prop-cover { width:34px; height:20px; border-radius:3px;
        background:linear-gradient(135deg,#9aa6b0 0%,#7a8893 50%,#5d6975 100%);
        border:1px solid #4a5560;
        box-shadow:inset 0 6px 0 -5px rgba(255,255,255,.3), 0 5px 6px rgba(15,9,4,.5); }
      /* Cellar palette: cold grey stone instead of the warm parchment map. */
      .cs-theme-cellar .cs-cell { background:#bdb9af; border-color:#6e6b64; }
      .cs-theme-cellar.cs-iso .cs-cell { box-shadow:inset 0 0 0 1px rgba(90,88,82,.5), 0 1px 0 rgba(40,40,38,.4); }
      .cs-theme-cellar .cell-wall { background:#7d7a73; border-color:#5a5852; }
      /* Movement trail: faint footfalls the mover has just crossed. */
      .cell-trail::after { content:""; position:absolute; inset:32%;
        border-radius:50%; background:rgba(216,184,120,.5);
        box-shadow:0 0 6px 2px rgba(216,184,120,.35); }
      .cs-theme-cellar .cell-trail::after { background:rgba(150,150,142,.6); box-shadow:0 0 6px 2px rgba(150,150,142,.4); }
      .cs-token { width:50px; height:50px; border-radius:50%; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:2px; border:2px solid transparent; transition:transform .2s; }
      /* Billboard tokens upright (inverse of the grid tilt) and float them above the tile. */
      .cs-iso .cs-token { transform:rotateZ(-45deg) rotateX(-55deg) translateZ(24px); box-shadow:0 7px 9px rgba(20,12,6,.5); }
      .cs-iso .cs-token-mine { transform:rotateZ(-45deg) rotateX(-55deg) translateZ(30px); }
      /* Tokens read as rounded 3D pieces: lit from the upper-left, rim-lit edge,
         and a deep contact shadow so they sit on the board rather than float. */
      .cs-token-player { background:radial-gradient(circle at 36% 28%, #c39a5c 0%, #6e5230 58%, #43331d 100%);
        border-color:#caa468; box-shadow:0 8px 10px rgba(15,9,4,.6), inset 0 2px 4px rgba(255,235,190,.4), inset 0 -5px 7px rgba(0,0,0,.4); }
      .cs-token-enemy  { background:radial-gradient(circle at 36% 28%, #a84e39 0%, #5a2e22 58%, #341a12 100%);
        border-color:#b04632; box-shadow:0 8px 10px rgba(15,9,4,.6), inset 0 2px 4px rgba(255,200,180,.35), inset 0 -5px 7px rgba(0,0,0,.45); }
      .cs-token-mine   { border-color:#f0d28a; box-shadow:0 8px 10px rgba(15,9,4,.6), 0 0 0 2px rgba(240,210,138,.55) inset, inset 0 2px 4px rgba(255,235,190,.4); }
      .cs-token-dead   { opacity:.3; filter:grayscale(1); }
      /* Playback flashes — a step pop, a hit jolt, a heal glow. */
      .cs-token-step { animation:cs-step .15s ease; }
      @keyframes cs-step { 50% { transform:scale(1.14); } }
      .cs-iso .cs-token-step { animation:cs-step-iso .15s ease; }
      @keyframes cs-step-iso { 50% { transform:rotateZ(-45deg) rotateX(-55deg) translateZ(34px) scale(1.1); } }
      .cs-token-hit  { animation:cs-hit .3s ease; box-shadow:0 0 0 3px rgba(138,59,42,.6) !important; }
      @keyframes cs-hit { 0%,100% { } 25% { transform:translateX(-3px); } 75% { transform:translateX(3px); } }
      .cs-token-heal { box-shadow:0 0 10px 3px rgba(92,100,66,.7) !important; }
      /* Ability cast — the caster flares as they channel. */
      .cs-token-cast { animation:cs-cast .45s ease; }
      @keyframes cs-cast { 0%,100% { box-shadow:0 0 0 0 rgba(216,184,120,0); } 40% { box-shadow:0 0 16px 6px rgba(216,184,120,.85); } }
      /* Element palette — each ability's orb/burst/shockwave reads these vars. */
      .cs-el-fire     { --el-core:#ffd27a; --el-edge:#e0641e; }
      .cs-el-frost    { --el-core:#dff4ff; --el-edge:#39a3da; }
      .cs-el-radiant  { --el-core:#fff3c4; --el-edge:#e2b53c; }
      .cs-el-force    { --el-core:#ecccff; --el-edge:#8a4ad0; }
      .cs-el-arrow    { --el-core:#ece3cd; --el-edge:#8a7a52; }
      .cs-el-physical { --el-core:#f1dab2; --el-edge:#9a6a3a; }
      .cs-el-spell    { --el-core:#ffe1a2; --el-edge:#c88030; }
      /* Spell orb in flight (position:fixed; placed at viewport coords). */
      .cs-projectile { position:fixed; width:18px; height:18px; margin:-9px 0 0 -9px; border-radius:50%;
        z-index:50; pointer-events:none; transition:transform .36s cubic-bezier(.4,.05,.5,1);
        background:radial-gradient(circle, var(--el-core,#ffd27a) 0 30%, var(--el-edge,#e0641e) 60%, transparent 100%);
        box-shadow:0 0 14px 5px var(--el-edge,#e0641e); }
      /* Transient ability effects — placed at a tile centre, removed after life. */
      .cs-fx { position:fixed; pointer-events:none; z-index:49; }
      .cs-fx-heal { width:46px; height:46px; margin:-23px 0 0 -23px; border-radius:50%;
        background:radial-gradient(circle, rgba(206,242,158,.95) 0 24%, rgba(120,180,70,.55) 54%, transparent 76%);
        animation:cs-heal-rise .65s ease-out forwards; }
      @keyframes cs-heal-rise { 0% { transform:translateY(8px) scale(.4); opacity:0; } 35% { opacity:1; }
        100% { transform:translateY(-34px) scale(1.1); opacity:0; } }
      .cs-fx-buff { width:54px; height:54px; margin:-27px 0 0 -27px; border-radius:50%; border:3px solid;
        animation:cs-aura .6s ease-out forwards; }
      .cs-buff-ward  { border-color:rgba(126,196,232,.95); box-shadow:0 0 18px 4px rgba(120,190,230,.6); }
      .cs-buff-rally { border-color:rgba(232,184,92,.95); box-shadow:0 0 18px 4px rgba(230,150,60,.6); }
      @keyframes cs-aura { 0% { transform:scale(.3); opacity:0; } 30% { opacity:1; } 100% { transform:scale(1.5); opacity:0; } }
      .cs-fx-burst { width:50px; height:50px; margin:-25px 0 0 -25px; border-radius:50%;
        background:radial-gradient(circle, var(--el-core,#ffd27a) 0 20%, var(--el-edge,#e0641e) 55%, transparent 78%);
        animation:cs-burst .46s ease-out forwards; }
      @keyframes cs-burst { 0% { transform:scale(.3); opacity:.95; } 100% { transform:scale(2.2); opacity:0; } }
      .cs-fx-shock { width:60px; height:60px; margin:-30px 0 0 -30px; border-radius:50%;
        border:3px solid var(--el-edge,#e0641e); box-shadow:0 0 16px 3px var(--el-edge,#e0641e);
        animation:cs-shock .5s ease-out forwards; }
      @keyframes cs-shock { 0% { transform:scale(.2); opacity:.9; } 100% { transform:scale(3.4); opacity:0; } }
      .cs-token-letter { font-size:18px; font-weight:500; color:#f0e4c8; line-height:1; }
      .cs-hp-wrap { width:38px; height:4px; background:rgba(0,0,0,.4); border-radius:2px; overflow:hidden; }
      .cs-hp-fill { height:100%; border-radius:2px; transition:width .3s; }
      #cs-sidebar { width:200px; flex-shrink:0; display:flex; flex-direction:column; gap:8px; overflow-y:auto; }
      .cs-panel { background:#dac7a2; color:#3b2f20; border:1px solid #7a6344; border-radius:8px; padding:10px; }
      .cs-panel-log { flex:1; display:flex; flex-direction:column; min-height:0; }
      .cs-panel-title { font-size:11px; color:#6e5c42; margin-bottom:6px; }
      .cs-init-row { display:flex; align-items:center; gap:6px; padding:3px 0; font-size:12px; }
      .cs-init-name { flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
      .cs-init-hp { font-size:11px; color:#6e5c42; }
      .cs-init-badge { font-size:11px; background:rgba(90,58,28,.14); padding:1px 5px; border-radius:3px; }
      .cs-init-dead { opacity:.4; text-decoration:line-through; }
      .cs-init-mine { color:#5a3a1c; font-weight:500; }
      .cs-btn { display:block; width:100%; padding:7px 10px; margin-bottom:5px; background:#c8b485; border:1px solid #7a6344; border-radius:6px; color:#3b2f20; cursor:pointer; font-size:12px; text-align:left; transition:background .1s; }
      .cs-btn:hover:not([disabled]) { background:#bda36f; }
      .cs-btn[disabled] { opacity:.4; cursor:not-allowed; }
      .cs-btn-active { border-color:#8a5a2c; color:#5a3a1c; }
      .cs-btn-confirm { border-color:#5c6442; color:#4a5232; margin-top:8px; }
      .cs-plan-summary { font-size:11px; color:#6e5c42; padding:3px 0; }
      .cs-muted { font-size:12px; color:#6e5c42; margin:0; }
      #cs-log { overflow-y:auto; flex:1; font-size:11px; line-height:1.7; }
      .cs-log-entry { border-bottom:1px solid rgba(90,58,28,.12); padding:1px 0; }
      .cs-log-entity_dies { color:#8a3b2a; font-weight:500; }
      .cs-log-attack_crit { color:#8a5a2c; font-weight:500; }
      .cs-log-attack_hit  { color:#3b2f20; }
      .cs-log-attack_miss { color:#9a8866; }
      .cs-log-heal        { color:#5c6442; }
      .cs-log-burn_damage { color:#8a5a2c; }
      .cs-log-combat_ends { color:#5a3a1c; font-weight:500; }
      .cs-end-overlay { position:absolute; inset:0; background:rgba(20,12,6,.6); display:flex; align-items:center; justify-content:center; z-index:10; }
      .cs-end-card { background:#dac7a2; border:2px solid #8a5a2c; border-radius:12px; padding:32px 40px; text-align:center; }
      .cs-end-title { margin:0 0 8px; font-size:22px; font-weight:500; color:#5a3a1c; }
      .cs-end-body  { margin:0 0 20px; color:#6e5c42; font-size:14px; }
      #cs-return-btn { padding:10px 24px; background:#6e5230; border:none; border-radius:6px; color:#f0e4c8; cursor:pointer; font-size:14px; }
      #cs-return-btn:hover { background:#5a3a1c; }
    `;
    document.head.appendChild(s);
  }
}
