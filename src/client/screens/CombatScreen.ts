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
import { TERRAIN, entryCost, coverBonus, chebyshev } from "../../types/combat";
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

/**
 * ── ART DROP-IN SEAM: character/enemy sprites ──────────────────────────────
 *
 * Registered sprite art keys. A combatant's `sprite` (set server-side from its
 * class or enemy template — "warrior", "mage", "rat", "fog_wolf", …) is drawn
 * as a billboarded 2.5D sprite ONLY when its key is listed here; otherwise the
 * combatant falls back to the placeholder lettered token. Gating on this set
 * means we never request a PNG that doesn't exist yet (no 404 spam).
 *
 * TO ADD ART: drop `<key>.png` into `public/assets/sprites/` (a tall, upright,
 * transparent-background sprite — FF Tactics style) and add its `<key>` here.
 * That's the whole change; the renderer wires it to the existing step/hit/cast
 * animations automatically.
 */
const SPRITE_MANIFEST = new Set<string>([
  // e.g. "warrior", "mage", "archer", "healer", "rat", "fog_wolf", "fog_boss"
]);

/** Path to a registered sprite; callers must check SPRITE_MANIFEST first. */
function spriteUrl(key: string): string {
  return `/assets/sprites/${key}.png`;
}

export class CombatScreen {
  private readonly el: HTMLElement;
  private readonly playerId: string;
  private readonly onSubmitAction: (sub: CombatActionSubmission) => void;
  private readonly onCombatEnd: (outcome: string) => void;

  private state: CombatStateView | null = null;
  /**
   * Board projection. Phones default to the flat top-down view: an 8×8 grid
   * of 40px cells fits a 375px portrait screen exactly, while the isometric
   * diagonal (~450px + perspective) would clip tokens off both edges. The
   * header toggle still offers 2.5D (scaled down on mobile, see the media
   * block in injectStyles).
   */
  private projection: Projection =
    typeof window !== "undefined" && window.matchMedia("(max-width: 700px)").matches
      ? "flat"
      : "isometric";
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
          <button id="cs-view-toggle" title="Toggle 2.5D / flat view">${this.projection === "isometric" ? "⬗ 2.5D" : "▦ Flat"}</button>
          <span id="cs-waiting"></span>
        </div>
        <div id="cs-body">
          <div id="cs-grid-wrap">
            <div id="cs-grid"></div>
            <div id="cs-hint"><span class="cs-hint-icon">✦</span><span id="cs-hint-text">Your move. Pick an action on the right.</span></div>
          </div>
          <div id="cs-sidebar">
            <div class="cs-panel">
              <div class="cs-panel-title" title="Everyone plans at once, then acts in this order — combatants above you resolve their turn before yours.">Turn order · top acts first</div>
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
      case "item_used":
        this.flashToken(event.entityId, "cs-token-cast");
        setTimeout(done, CombatScreen.EVENT_MS);
        return;
      case "action_fizzles":
        // A plan that came to nothing (target gone, path blocked) — jolt the
        // actor so the "nothing happened" is visibly THEIR beat, not a freeze.
        this.flashToken(event.entityId, "cs-token-step");
        setTimeout(done, CombatScreen.EVENT_MS);
        return;
      case "flee": {
        // Second flee event ("escapes") removes the runner from the board.
        if (/escapes/.test(event.text)) {
          const e = this.state.entities.find(x => x.id === event.entityId);
          if (e) { e.isDead = true; this.clearGridCell(e.position); }
          this.renderGrid();
          setTimeout(done, CombatScreen.BIG_MS);
        } else {
          this.flashToken(event.entityId, "cs-token-step");
          setTimeout(done, CombatScreen.EVENT_MS);
        }
        return;
      }
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
    const reachable = me && this.mode === "selecting_move" ? this.reachableCells(me) : new Map<string, number>();
    // Tiles + targets in range of the chosen action, shaded so it's obvious what
    // the button can reach before you commit. Movement range is folded into the
    // shaded tiles too, so EVERY action lights up its full reach the moment you
    // pick it — not only on hover.
    const range     = me ? this.actionRange(me) : { tiles: new Set<string>(), targetIds: new Set<string>(), isAbility: false };
    for (const k of reachable.keys()) range.tiles.add(k);

    grid.innerHTML = "";
    // Track size must match the viewport: 60px tracks read well on desktop,
    // but 8 of them (+gaps) are ~495px — far wider than a 375px phone. 42px
    // tracks put the whole flat board on screen with the 40px mobile cells.
    // (Inline styles beat the stylesheet, so this can't live in the media
    // query alone.)
    const track = window.matchMedia("(max-width: 700px)").matches ? 42 : 60;
    grid.style.display              = "grid";
    grid.style.gridTemplateColumns  = `repeat(8, ${track}px)`;
    grid.style.gridTemplateRows     = `repeat(8, ${track}px)`;
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
        // Checkerboard tone variation so the ground reads as laid tiles/turf
        // rather than one flat wash (pure paint — no gameplay meaning).
        if ((col + row) % 2 === 1) div.classList.add("cs-cell-alt");
        div.dataset.x = String(col);
        div.dataset.y = String(row);
        div.addEventListener("mouseenter", () => this.onCellHover({ x: col, y: row }));
        div.addEventListener("mouseleave", () => this.onCellLeave());

        // Elevation (visual only): lift the tile and give it side walls so the
        // board reads with real depth. Every tile has a base thickness (a solid
        // floor slab); raised tiles add height on top. The two visible block
        // faces (south + east in the 45° view) are drawn as .cs-riser children.
        const elev = cell?.elevation ?? 0;
        div.style.setProperty("--elev", String(elev));
        const riserS = document.createElement("div");
        riserS.className = "cs-riser cs-riser-s";
        const riserE = document.createElement("div");
        riserE.className = "cs-riser cs-riser-e";
        div.appendChild(riserS);
        div.appendChild(riserE);

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
        if (reachable.has(posKey)) {
          div.classList.add("cell-move");
          // Movement price stamped on the tile so terrain costs read at a glance.
          const badge = document.createElement("span");
          badge.className = "cs-move-cost";
          badge.textContent = String(reachable.get(posKey));
          div.appendChild(badge);
        }
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

          // Duplicate-name suffix ("Cellar Rat B") rides the token as a small
          // corner badge so the board matches the turn-order list at a glance.
          const suffix = entity.name.match(/ ([A-Z])$/)?.[1];
          if (suffix) {
            const tag = document.createElement("span");
            tag.className   = "cs-token-tag";
            tag.textContent = suffix;
            token.appendChild(tag);
          }

          // Art drop-in: if this combatant's sprite is registered, draw it as a
          // billboarded sprite that covers the placeholder token. The sprite
          // rides the same token element, so every step/hit/cast animation and
          // the iso billboard transform apply to it for free.
          if (entity.sprite && SPRITE_MANIFEST.has(entity.sprite)) {
            token.classList.add("cs-token-sprited");
            const sprite = document.createElement("div");
            sprite.className = "cs-token-sprite";
            sprite.style.backgroundImage = `url(${spriteUrl(entity.sprite)})`;
            token.appendChild(sprite);
          }

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
    const myId = this.myEntity()?.id;
    const myIdx = this.state.initiativeOrder.indexOf(myId ?? "");
    let n = 0;
    for (const id of this.state.initiativeOrder) {
      const e = this.state.entities.find(x => x.id === id);
      if (!e) continue;
      n++;
      const isMine = e.id === myId;
      const row = document.createElement("div");
      row.className = [
        "cs-init-row",
        e.isDead ? "cs-init-dead" : "",
        isMine ? "cs-init-mine" : "",
      ].join(" ");
      const idx = this.state.initiativeOrder.indexOf(id);
      row.title = e.isDead
        ? `${e.name} is out of the fight.`
        : isMine
          ? "Your turn resolves at this point in the round."
          : myIdx >= 0 && idx < myIdx
            ? `${e.name} acts BEFORE you — they may have moved by the time your attack lands.`
            : `${e.name} acts after you.`;
      row.innerHTML = `<span class="cs-init-num">${n}</span>
                       <span class="cs-init-name">${e.name}${isMine ? ' <span class="cs-init-you">YOU</span>' : ""}</span>
                       <span class="cs-init-hp">${e.hp}/${e.maxHp}</span>
                       <span class="cs-init-badge" title="Initiative roll">${e.initiative}</span>`;
      // Hovering a row spotlights that combatant's token on the board, so
      // "Cellar Rat B" is never a mystery.
      row.addEventListener("mouseenter", () => {
        const token = this.el.querySelector(`.cs-token[data-entity-id="${e.id}"]`);
        token?.classList.add("cs-token-focus");
      });
      row.addEventListener("mouseleave", () => {
        const token = this.el.querySelector(`.cs-token[data-entity-id="${e.id}"]`);
        token?.classList.remove("cs-token-focus");
      });
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

    // Dodge — trade the turn's action for a defensive stance.
    const dodgeBtn = this.actionBtn("Dodge", this.plan.action?.type === "dodge", () => this.selectDodge());
    this.onHover(dodgeBtn, "Dodge — attacks against you roll with disadvantage until you next act.");
    panel.appendChild(dodgeBtn);

    // Carried consumables — drinking one is the turn's action.
    for (const item of me.consumables ?? []) {
      const btn = this.actionBtn(
        `${item.name} ×${item.count}`,
        this.plan.action?.type === "item" && this.plan.action.itemId === item.itemId,
        item.count > 0 ? () => this.selectItem(item.itemId, item.name) : undefined
      );
      this.onHover(btn, `${item.name}${item.heal ? ` — heals ${item.heal}` : ""}. Using it takes your action this turn.`);
      panel.appendChild(btn);
    }

    if (this.plan.move || this.plan.action) {
      const summary = document.createElement("div");
      summary.className   = "cs-plan-summary";
      const parts: string[] = [];
      if (this.plan.move)   parts.push(`Move → (${this.plan.move.x},${this.plan.move.y})`);
      if (this.plan.action) parts.push(this.planActionLabel(this.plan.action));
      summary.textContent = parts.join(" + ");
      panel.appendChild(summary);

      const confirm = this.actionBtn("Confirm turn", false, () => this.confirmSubmit());
      confirm.classList.add("cs-btn-confirm");
      panel.appendChild(confirm);
    }

    const endBtn = this.actionBtn("End turn", false, () => this.submitEndTurn());
    this.onHover(endBtn, "End turn — do nothing this round.");
    panel.appendChild(endBtn);

    const fleeBtn = this.actionBtn("Flee", false, () => this.submitFlee());
    fleeBtn.classList.add("cs-btn-flee");
    this.onHover(fleeBtn, "Flee the fight — foes in reach each get one parting swipe as you run. No loot, no XP, but you keep your life.");
    panel.appendChild(fleeBtn);
  }

  /** Human label for a planned action in the summary line. */
  private planActionLabel(action: NonNullable<Plan["action"]>): string {
    switch (action.type) {
      case "item": {
        const item = this.myEntity()?.consumables?.find(c => c.itemId === action.itemId);
        return item ? `Use ${item.name}` : "Use item";
      }
      case "ability": {
        const a = this.myEntity()?.abilities?.find(x => x.id === action.abilityId);
        return a?.name ?? "ability";
      }
      case "dodge":  return "Dodge";
      case "attack": {
        const t = this.state?.entities.find(e => e.id === action.targetEntityId);
        return t ? `Attack ${t.name}` : "Attack";
      }
      default: return action.type;
    }
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

  private selectDodge(): void {
    this.plan.action = { type: "dodge" };
    this.mode        = "idle";
    this.renderGrid();
    this.renderActions();
    this.setHint("Dodge set — you'll weave defensively this round. Confirm turn when ready.");
  }

  private selectItem(itemId: string, name: string): void {
    this.plan.action = { type: "item", itemId };
    this.mode        = "idle";
    this.renderGrid();
    this.renderActions();
    this.setHint(`${name} set — you'll use it as your action. Confirm turn when ready.`);
  }

  private submitEndTurn(): void {
    const me = this.myEntity();
    if (!me) return;
    this.onSubmitAction({ entityId: me.id, action: { type: "end_turn" } });
    this.plan.hasSubmitted = true;
    this.renderActions();
    this.renderWaiting();
  }

  /** Flee is a whole-turn commitment: it replaces any planned move/action. */
  private submitFlee(): void {
    const me = this.myEntity();
    if (!me) return;
    this.onSubmitAction({ entityId: me.id, action: { type: "flee" } });
    this.plan.hasSubmitted = true;
    this.mode = "idle";
    this.renderActions();
    this.renderWaiting();
    this.setHint("You brace to run — the round resolves…");
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
    const { outcome, xpReward, goldReward, items } = msg.payload;
    const win  = outcome === "players_win";
    const fled = outcome === "fled";

    const title = win ? "Victory!" : fled ? "You got away" : "Defeated";
    let body: string;
    if (win) {
      body = `+${xpReward} XP &nbsp;·&nbsp; +${goldReward} gold`;
      if (items && items.length) {
        body += `<br><span class="cs-end-spoils">Spoils: ${items.join(", ")}</span>`;
      }
    } else if (fled) {
      body = "You slip away into the dark — alive, but empty-handed.";
    } else {
      body = "The party has fallen…";
    }

    this.setHint("The fight is over.");
    const overlay = document.createElement("div");
    overlay.className = "cs-end-overlay";
    overlay.innerHTML = `
      <div class="cs-end-card">
        <h2 class="cs-end-title">${title}</h2>
        <p class="cs-end-body">${body}</p>
        <button id="cs-return-btn">Return</button>
      </div>
    `;
    root.appendChild(overlay);
    overlay.querySelector("#cs-return-btn")?.addEventListener("click", () =>
      this.onCombatEnd(outcome)
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
   * Tiles the entity can reach this turn (key → movement cost), honoring
   * terrain entry costs (rubble costs 2). Uniform-cost search that mirrors the
   * server's findPath, so the highlight never offers a tile the server would
   * reject — and each tile knows its price, for the cost badges.
   */
  private reachableCells(entity: CombatEntityView): Map<string, number> {
    const reachable = new Map<string, number>();
    if (!this.state) return reachable;
    const best = new Map<string, number>([[`${entity.position.x},${entity.position.y}`, 0]]);
    const dirs: Array<[number, number]> = [[-1,0],[1,0],[0,-1],[0,1],[-1,-1],[1,-1],[-1,1],[1,1]];
    const frontier: Array<{ pos: GridPosition; cost: number }> = [{ pos: entity.position, cost: 0 }];
    while (frontier.length) {
      let bi = 0;
      for (let i = 1; i < frontier.length; i++) if (frontier[i]!.cost < frontier[bi]!.cost) bi = i;
      const { pos, cost } = frontier.splice(bi, 1)[0]!;
      const key = `${pos.x},${pos.y}`;
      if (cost > (best.get(key) ?? Infinity)) continue;
      if (cost > 0) reachable.set(key, cost);
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

  /** One-line read on a combatant: vitals, reach and hit odds in attack mode. */
  private entityHint(e: CombatEntityView, me: CombatEntityView | undefined): string {
    if (e.isDead) return `${e.name} — down.`;
    const vitals = `${e.name} — ${e.hp}/${e.maxHp} HP, AC ${e.ac}`;
    if (me && this.mode === "selecting_attack" && e.type !== me.type && me.weapon) {
      const dist = chebyshev(e.position, this.actionOrigin(me));
      const fromMove = this.plan.move ? " after your move" : "";
      return dist <= me.weapon.range
        ? `${vitals}. In reach${fromMove} (range ${dist}/${me.weapon.range})${this.hitChanceNote(e, me)} — click to strike.`
        : `${vitals}. Too far — range ${dist}, your weapon reaches ${me.weapon.range}.`;
    }
    const cond = e.conditions.length ? ` · ${e.conditions.join(", ")}` : "";
    return `${vitals}${cond}.`;
  }

  /** "~65% to hit" estimate from my attack bonus vs the target's AC (+cover). */
  private hitChanceNote(target: CombatEntityView, me: CombatEntityView): string {
    if (me.attackModifier === undefined) return "";
    const cell  = this.state?.grid[target.position.y]?.[target.position.x];
    const cover = cell ? coverBonus(cell.type) : 0;
    const needed = target.ac + cover - me.attackModifier;
    // d20: nat 1 always misses, nat 20 always hits → clamp to [5%, 95%].
    const pct = Math.max(5, Math.min(95, (21 - needed) * 5));
    const coverNote = cover > 0 ? ` (+${cover} AC cover)` : "";
    return `, ~${pct}% to hit${coverNote}`;
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
        if (chebyshev({ x, y }, origin) <= R) tiles.add(`${x},${y}`);
      }
      for (const e of this.state.entities) {
        if (e.type !== me.type && !e.isDead && chebyshev(e.position, origin) <= R) targetIds.add(e.id);
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
          if (chebyshev({ x, y }, origin) <= reach) tiles.add(`${x},${y}`);
        }
        // …and only in-reach living targets of the right side are clickable.
        for (const e of this.state.entities) {
          if (e.isDead) continue;
          const match = want === "enemy" ? e.type !== me.type : e.type === me.type;
          if (match && chebyshev(e.position, origin) <= reach) targetIds.add(e.id);
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
      /* --base-thick: slab thickness every tile has; --elev-step: added height
         per elevation level. Both feed the tile lift + riser (side-wall) faces. */
      #cs-grid { transition:transform .45s ease; transform-style:preserve-3d; --base-thick:7px; --elev-step:16px; }
      /* 2.5D isometric (dimetric) tilt — the board lies on a ground plane. */
      #cs-grid.cs-iso { transform:rotateX(55deg) rotateZ(45deg); }
      /* Ground tiles: worn field flagstone — a soft top-light, two crossed
         grain passes, and scattered speckles so no tile reads as flat paint.
         Colour lives in background-color so the .cs-cell-alt checkerboard
         only swaps the tone underneath the shared texture layers. */
      .cs-cell { width:60px; height:60px;
        background-image:
          radial-gradient(140% 100% at 28% 20%, rgba(255,246,214,.20), transparent 55%),
          radial-gradient(circle at 72% 68%, rgba(110,80,42,.14) 0 8%, transparent 14%),
          radial-gradient(circle at 24% 78%, rgba(110,80,42,.10) 0 5%, transparent 11%),
          repeating-linear-gradient(97deg, rgba(122,90,48,.07) 0 3px, transparent 3px 8px),
          repeating-linear-gradient(8deg, rgba(90,64,32,.05) 0 2px, transparent 2px 9px);
        background-color:#c9b489;
        border:1px solid #8a6f48; border-radius:4px; display:flex; align-items:center; justify-content:center; position:relative; box-sizing:border-box; transform-style:preserve-3d; }
      .cs-cell-alt { background-color:#bfa87a; }
      .cs-iso .cs-cell { box-shadow:inset 0 0 0 1px rgba(120,96,56,.5),
        inset 0 2px 3px rgba(255,244,210,.22), inset 0 -2px 3px rgba(70,50,26,.22),
        0 1px 0 rgba(60,44,24,.35); }
      /* ── Tile extrusion + elevation (iso only) ──
         Lift the tile top by its total block height, then hang two side faces
         (south + east — the shaded sides in a 45° view) down to the ground so
         the tile reads as a solid block / raised ground. Flat rooms keep a thin
         uniform slab (base-thick); raised tiles rise on top. Visual only. */
      .cs-iso .cs-cell { transform:translateZ(calc(var(--base-thick) + var(--elev,0) * var(--elev-step))); }
      .cs-riser { display:none; }
      .cs-iso .cs-riser { display:block; position:absolute; pointer-events:none; z-index:0;
        --h:calc(var(--base-thick) + var(--elev,0) * var(--elev-step)); }
      /* South wall: hinged along the tile's bottom edge, swung down to ground.
         Earth strata lines make raised ground read as cut soil, not plastic. */
      .cs-iso .cs-riser-s { left:-1px; right:-1px; top:100%; height:var(--h);
        transform-origin:top center; transform:rotateX(-90deg);
        background:
          repeating-linear-gradient(180deg, rgba(0,0,0,.16) 0 2px, transparent 2px 7px),
          repeating-linear-gradient(92deg, rgba(255,220,160,.05) 0 4px, transparent 4px 11px),
          linear-gradient(#8a6f48 0%, #6b5334 55%, #4e3b22 100%); }
      /* East wall: hinged along the tile's right edge, swung down to ground. */
      .cs-iso .cs-riser-e { top:-1px; bottom:-1px; left:100%; width:var(--h);
        transform-origin:left center; transform:rotateY(90deg);
        background:
          repeating-linear-gradient(90deg, rgba(0,0,0,.13) 0 2px, transparent 2px 7px),
          repeating-linear-gradient(2deg, rgba(255,220,160,.05) 0 4px, transparent 4px 11px),
          linear-gradient(90deg, #9a7c52 0%, #7c6138 55%, #5a4628 100%); }
      .cell-wall { background:#6e5836; border-color:#5a4630; }
      /* Interaction highlights are scoped under #cs-grid so their specificity
         (id + class) beats any board THEME rule (e.g. the cellar's grey
         ".cs-theme-cellar .cs-cell"), which would otherwise hide them. */
      #cs-grid .cell-move { background:rgba(92,100,66,.5); border-color:#7c8a52; cursor:pointer; }
      #cs-grid .cell-move:hover { background:rgba(92,100,66,.68); }
      /* Movement price stamped on each reachable tile. */
      .cs-move-cost { position:absolute; top:2px; right:3px; font-size:9px; line-height:1; color:#ece4cf; background:rgba(59,47,32,.72); padding:1px 3px; border-radius:3px; pointer-events:none; z-index:2; }
      .cs-iso .cs-move-cost { transform:rotateZ(-45deg) rotateX(-55deg); transform-origin:top right; }
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
      /* Rubble: collapsed masonry — chunks with lit tops and shadowed feet
         over a bed of grit, so the stones read as three-dimensional. */
      .cell-rubble { background:
          radial-gradient(circle at 28% 32%, #c2b498 0 2px, #94866c 2px 5px, rgba(60,52,38,.55) 5px 6px, transparent 7px),
          radial-gradient(circle at 66% 58%, #b8a988 0 3px, #8a7d66 3px 6px, rgba(60,52,38,.5) 6px 7px, transparent 8px),
          radial-gradient(circle at 46% 78%, #ab9c7d 0 2px, #7d7058 2px 4px, rgba(60,52,38,.5) 4px 5px, transparent 6px),
          radial-gradient(circle at 82% 26%, #9a8d76 0 2px, rgba(60,52,38,.4) 2px 3px, transparent 4px),
          radial-gradient(circle at 14% 62%, #9a8d76 0 1.5px, transparent 3px),
          radial-gradient(circle at 58% 14%, rgba(60,52,38,.35) 0 1.5px, transparent 3px),
          repeating-linear-gradient(23deg, rgba(90,80,60,.10) 0 2px, transparent 2px 6px),
          #a89878; border-color:#776a4f; }
      /* Embers: a banked fire pit — white-hot motes over cracked coals,
         ringed by charred ground, breathing light. */
      .cell-embers { background:
          radial-gradient(circle at 40% 46%, rgba(255,240,180,.95) 0 7%, transparent 15%),
          radial-gradient(circle at 62% 64%, rgba(255,200,110,.9) 0 6%, transparent 14%),
          radial-gradient(circle at 28% 68%, rgba(255,160,70,.8) 0 5%, transparent 12%),
          radial-gradient(circle at 70% 34%, rgba(255,150,60,.6) 0 4%, transparent 10%),
          repeating-linear-gradient(31deg, rgba(20,6,2,.5) 0 2px, transparent 2px 7px),
          radial-gradient(circle at 50% 55%, #e8763a 0 34%, #96351a 62%, #4e1c0c 88%, #2e0f06 100%);
          border-color:#3a1206; animation:cs-ember 1.3s ease-in-out infinite alternate;
          box-shadow:0 0 14px 2px rgba(255,120,40,.28); }
      @keyframes cs-ember { from { filter:brightness(.85); } to { filter:brightness(1.25); } }
      /* Prop tiles — the ground beneath standing scenery. Barrel/crate tiles
         are dusty cellar floor; the cover tile is cool paving so it reads as
         a defensible spot even before the barricade renders on it. */
      .cell-barrel, .cell-crate { background:#b4b0a6; border-color:#6e6b64; }
      .cell-cover { background:
          radial-gradient(circle at 30% 30%, rgba(255,255,255,.12) 0 4px, transparent 6px),
          linear-gradient(135deg, #8c9aa6 0 50%, #76828d 50% 100%);
          border-color:#5d6975; }
      .cell-barrel::after, .cell-crate::after, .cell-cover::after {
        content:""; position:absolute; left:50%; top:62%; width:62%; height:30%;
        transform:translate(-50%,-50%); border-radius:50%;
        background:radial-gradient(ellipse, rgba(20,12,6,.5) 0 55%, rgba(20,12,6,0) 75%); }
      /* A prop billboards upright off its tile so it stands like a real object. */
      .cs-prop { position:absolute; left:50%; bottom:14%; transform-origin:center bottom;
        transform:translateX(-50%); }
      .cs-iso .cs-prop { transform:translateX(-50%) rotateZ(-45deg) rotateX(-55deg) translateZ(10px); }
      /* Barrel — an oak cask: curved body shading, stave seams that follow
         the curve, two iron hoops with a glint, and a recessed lid on top. */
      .cs-prop-barrel { width:27px; height:35px; position:relative;
        border-radius:48% 48% 42% 42% / 13% 13% 11% 11%;
        background:
          linear-gradient(100deg, transparent 6%, rgba(255,240,205,.30) 20%, rgba(255,240,205,.06) 38%, transparent 58%),
          linear-gradient(180deg,
            transparent 0 15%, #2e2a26 15% 21%, rgba(255,255,255,.20) 21% 22.5%, transparent 22.5% 74%,
            #2e2a26 74% 80%, rgba(255,255,255,.16) 80% 81.5%, transparent 81.5%),
          repeating-linear-gradient(90deg, transparent 0 3px, rgba(30,16,6,.45) 3px 4px),
          linear-gradient(90deg, #33200e 0%, #6e4a2a 20%, #9a6c3c 46%, #6e4a2a 76%, #2c1c0c 100%);
        border:1px solid #241505;
        box-shadow:inset 0 2px 2px rgba(255,225,170,.28), inset 0 -3px 4px rgba(15,8,3,.5),
                   0 6px 7px rgba(15,9,4,.55); }
      .cs-prop-barrel::before { content:""; position:absolute; left:7%; right:7%; top:-3px;
        height:8px; border-radius:50%;
        background:radial-gradient(ellipse at 50% 30%, #a87c48 0%, #7d5830 55%, #4a3016 100%);
        border:1px solid #241505;
        box-shadow:inset 0 1px 1px rgba(255,230,180,.35); }
      /* Crate — rough pine: horizontal planks, a nailed diagonal brace,
         grain streaks, and iron nail heads in the corners. */
      .cs-prop-crate { width:31px; height:29px; position:relative; border-radius:2px;
        background:
          linear-gradient(180deg, rgba(255,235,185,.30) 0 12%, transparent 32%),
          linear-gradient(45deg, transparent 0 43%, rgba(58,38,16,.50) 43% 47%, rgba(178,138,86,.55) 47% 53%, rgba(58,38,16,.50) 53% 57%, transparent 57%),
          repeating-linear-gradient(0deg, transparent 0 6px, rgba(46,28,10,.5) 6px 7px),
          repeating-linear-gradient(90deg, rgba(255,220,160,.07) 0 2px, transparent 2px 5px),
          linear-gradient(135deg, #9a7444 0%, #85623a 55%, #5f421e 100%);
        border:2px solid #3f2a12;
        box-shadow:inset 0 0 0 2px rgba(210,170,110,.28), inset 0 -4px 6px rgba(20,12,4,.35),
                   0 6px 7px rgba(15,9,4,.5); }
      .cs-prop-crate::before { content:""; position:absolute; inset:0; border-radius:2px;
        background:
          radial-gradient(circle at 12% 14%, #241708 0 1.4px, rgba(255,235,190,.55) 1.4px 2.1px, transparent 2.8px),
          radial-gradient(circle at 88% 14%, #241708 0 1.4px, rgba(255,235,190,.55) 1.4px 2.1px, transparent 2.8px),
          radial-gradient(circle at 12% 86%, #241708 0 1.4px, rgba(255,235,190,.45) 1.4px 2.1px, transparent 2.8px),
          radial-gradient(circle at 88% 86%, #241708 0 1.4px, rgba(255,235,190,.45) 1.4px 2.1px, transparent 2.8px); }
      /* Cover — a drystone barricade: mortared granite blocks, mottled faces,
         a sun-caught top course and a shadowed footing. */
      .cs-prop-cover { width:37px; height:21px; border-radius:4px 5px 3px 4px;
        background:
          linear-gradient(90deg, transparent 0 31%, rgba(40,48,56,.55) 31% 33.5%, transparent 33.5% 64%, rgba(40,48,56,.55) 64% 66.5%, transparent 66.5%),
          linear-gradient(0deg, transparent 0 47%, rgba(40,48,56,.5) 47% 53%, transparent 53%),
          radial-gradient(circle at 20% 28%, rgba(255,255,255,.18) 0 3px, transparent 5px),
          radial-gradient(circle at 72% 62%, rgba(20,26,32,.28) 0 3px, transparent 5px),
          radial-gradient(circle at 48% 76%, rgba(255,255,255,.10) 0 2px, transparent 4px),
          linear-gradient(135deg, #a2adb6 0%, #7e8b96 52%, #545f6a 100%);
        border:1px solid #38434e;
        box-shadow:inset 0 2px 2px rgba(255,255,255,.32), inset 0 -3px 4px rgba(15,20,26,.45),
                   0 5px 6px rgba(15,9,4,.5); }
      /* Cellar palette: cold flagstone instead of the warm parchment map —
         same texture recipe as the field tiles, in dungeon greys. */
      .cs-theme-cellar .cs-cell {
        background-image:
          radial-gradient(140% 100% at 28% 20%, rgba(255,255,255,.12), transparent 55%),
          radial-gradient(circle at 70% 66%, rgba(50,50,46,.16) 0 8%, transparent 14%),
          radial-gradient(circle at 26% 80%, rgba(50,50,46,.12) 0 5%, transparent 11%),
          repeating-linear-gradient(93deg, rgba(70,68,62,.09) 0 3px, transparent 3px 8px),
          repeating-linear-gradient(4deg, rgba(50,50,46,.06) 0 2px, transparent 2px 9px);
        background-color:#bdb9af; border-color:#6e6b64; }
      .cs-theme-cellar .cs-cell-alt { background-color:#b2ada1; }
      .cs-theme-cellar.cs-iso .cs-cell { box-shadow:inset 0 0 0 1px rgba(90,88,82,.5),
        inset 0 2px 3px rgba(255,255,255,.14), inset 0 -2px 3px rgba(40,40,36,.22),
        0 1px 0 rgba(40,40,38,.4); }
      .cs-theme-cellar .cell-wall { background:#7d7a73; border-color:#5a5852; }
      /* Cellar block sides: cold grey stone to match the floor slab. */
      .cs-theme-cellar.cs-iso .cs-riser-s { background:linear-gradient(#6e6b64,#4a4843); }
      .cs-theme-cellar.cs-iso .cs-riser-e { background:linear-gradient(90deg,#7d7a72,#565450); }
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
      /* ── Sprite art (drop-in) ──
         When a registered sprite is drawn, the placeholder disc/letter give way
         to the artwork. The sprite is anchored to the tile at its base and rises
         above the token, so tall FF-Tactics-style characters stand up off the
         board. HP bar stays on top (later sibling). */
      .cs-token-sprited { background:none !important; border-color:transparent !important; box-shadow:none !important; }
      .cs-token-sprited .cs-token-letter { display:none; }
      .cs-token-sprite { position:absolute; left:-20%; right:-20%; bottom:0; top:-70%;
        background-repeat:no-repeat; background-position:center bottom; background-size:contain;
        pointer-events:none; filter:drop-shadow(0 5px 4px rgba(15,9,4,.55)); }
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
      .cs-init-row { display:flex; align-items:center; gap:6px; padding:3px 0; font-size:12px; cursor:default; }
      .cs-init-row:hover { background:rgba(90,58,28,.08); }
      .cs-init-num { font-size:10px; color:#8a7a5e; min-width:12px; text-align:right; }
      .cs-init-name { flex:1; white-space:normal; line-height:1.25; overflow-wrap:anywhere; }
      .cs-init-you { font-size:9px; background:#5c6442; color:#ece4cf; padding:1px 4px; border-radius:3px; vertical-align:1px; }
      .cs-init-hp { font-size:11px; color:#6e5c42; }
      .cs-init-badge { font-size:11px; background:rgba(90,58,28,.14); padding:1px 5px; border-radius:3px; }
      .cs-init-dead { opacity:.4; text-decoration:line-through; }
      .cs-init-mine { color:#5a3a1c; font-weight:500; }
      /* Spotlight ring when the matching turn-order row is hovered. */
      .cs-token-focus { outline:3px solid #c9a24b; outline-offset:2px; }
      /* A/B duplicate-name badge riding the token's corner. */
      .cs-token-tag { position:absolute; top:-5px; right:-5px; font-size:8px; line-height:1; background:#3b2f20; color:#ece4cf; padding:2px 3px; border-radius:3px; border:1px solid #8a7a5e; }
      .cs-btn { display:block; width:100%; padding:7px 10px; margin-bottom:5px; background:#c8b485; border:1px solid #7a6344; border-radius:6px; color:#3b2f20; cursor:pointer; font-size:12px; text-align:left; transition:background .1s; }
      .cs-btn:hover:not([disabled]) { background:#bda36f; }
      .cs-btn[disabled] { opacity:.4; cursor:not-allowed; }
      .cs-btn-active { border-color:#8a5a2c; color:#5a3a1c; }
      .cs-btn-confirm { border-color:#5c6442; color:#4a5232; margin-top:8px; }
      .cs-btn-flee { border-color:#8a3b2a; color:#7a3424; }
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
      .cs-log-action_fizzles { color:#7a5c8a; font-style:italic; }
      .cs-log-flee { color:#8a5a2c; font-style:italic; }
      .cs-log-item_used { color:#5c6442; }
      .cs-end-spoils { font-size:12px; color:#5a4a32; }
      .cs-end-overlay { position:absolute; inset:0; background:rgba(20,12,6,.6); display:flex; align-items:center; justify-content:center; z-index:10; }
      .cs-end-card { background:#dac7a2; border:2px solid #8a5a2c; border-radius:12px; padding:32px 40px; text-align:center; }
      .cs-end-title { margin:0 0 8px; font-size:22px; font-weight:500; color:#5a3a1c; }
      .cs-end-body  { margin:0 0 20px; color:#6e5c42; font-size:14px; }
      #cs-return-btn { padding:10px 24px; background:#6e5230; border:none; border-radius:6px; color:#f0e4c8; cursor:pointer; font-size:14px; }
      #cs-return-btn:hover { background:#5a3a1c; }

      /* ── Mobile: board on top, panels swipe horizontally beneath ──
         Cells shrink 60→40px so the 8×8 board (and its 45° iso diagonal)
         fits a ~375px viewport; elevation steps shrink in proportion. */
      @media (max-width: 700px) {
        #cs-header { flex-wrap:wrap; gap:8px; padding:6px 10px; font-size:11px; }
        #cs-body { flex-direction:column; gap:8px; padding:8px; }
        #cs-grid-wrap { flex:1.5; min-height:0; perspective:1400px;
          flex-direction:column; overflow:hidden; }
        #cs-grid { --base-thick:5px; --elev-step:11px; }
        /* 2.5D on a phone: shrink the whole projection so the 45° diagonal
           (with its perspective flare) fits the narrow viewport instead of
           throwing corner tokens off both screen edges. */
        #cs-grid.cs-iso { transform:scale(.62) rotateX(55deg) rotateZ(45deg); }
        /* The hint joins the layout flow under the board — as an overlay it
           covered the player's own spawn row on short screens. */
        #cs-hint { position:static; margin-top:6px; width:100%; }
        .cs-cell { width:40px; height:40px; }
        .cs-token { width:34px; height:34px; }
        .cs-token-letter { font-size:12px; }
        .cs-hp-wrap { width:26px; }
        .cs-prop-barrel { width:19px; height:25px; }
        .cs-prop-crate { width:21px; height:20px; }
        .cs-prop-cover { width:24px; height:15px; }
        #cs-sidebar { width:100%; flex:1; min-height:150px;
          flex-direction:row; overflow-x:auto; overflow-y:hidden; gap:8px;
          -webkit-overflow-scrolling:touch; }
        #cs-sidebar .cs-panel { min-width:230px; flex-shrink:0; max-height:100%; overflow-y:auto; }
        /* Actions (2nd in DOM) leads the swipe row — it's what turns need. */
        #cs-sidebar .cs-panel:nth-child(2) { order:-1; }
        .cs-panel-log { flex:0 0 auto; }
        .cs-btn { padding:10px 12px; font-size:13px; }
        #cs-hint { left:6px; right:6px; bottom:6px; padding:6px 9px; font-size:11px; }
        .cs-end-card { padding:22px 24px; margin:0 12px; }
      }
    `;
    document.head.appendChild(s);
  }
}
