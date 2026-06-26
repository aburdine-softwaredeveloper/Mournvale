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
  CombatEvent,
  CombatActionSubmission,
} from "../../types/combat";
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
          <div id="cs-grid-wrap"><div id="cs-grid"></div></div>
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

  private playbackEvents(onDone: () => void): void {
    if (this.isAnimating) return;
    this.isAnimating = true;
    const next = (): void => {
      if (!this.eventQueue.length) { this.isAnimating = false; onDone(); return; }
      const event = this.eventQueue.shift()!;
      this.appendLog(event);
      const delay = ["entity_dies", "attack_crit", "combat_ends"].includes(event.type) ? 700 : 300;
      setTimeout(next, delay);
    };
    next();
  }

  // ─── Render ────────────────────────────────────────────────────────────────

  private render(): void {
    this.renderHeader();
    this.renderGrid();
    this.renderInitiative();
    this.renderActions();
    this.renderWaiting();
  }

  private renderHeader(): void {
    if (!this.state) return;
    const roundEl = this.el.querySelector("#cs-round");
    const phaseEl = this.el.querySelector("#cs-phase-label");
    if (roundEl) roundEl.textContent = `Round ${this.state.round}`;
    if (phaseEl) phaseEl.textContent = this.state.phase === "planning" ? "Planning" : "Resolving…";
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

    const me          = this.myEntity();
    const reachable   = me && this.mode === "selecting_move"   ? this.reachableCells(me) : new Set<string>();
    const attackable  = me && this.mode === "selecting_attack" ? this.attackableIds(me)  : new Set<string>();

    grid.innerHTML = "";
    grid.style.display              = "grid";
    grid.style.gridTemplateColumns  = "repeat(8, 60px)";
    grid.style.gridTemplateRows     = "repeat(8, 60px)";
    grid.style.gap                  = "2px";
    grid.classList.toggle("cs-iso", this.projection === "isometric");

    for (let row = 0; row < 8; row++) {
      for (let col = 0; col < 8; col++) {
        const cell    = this.state.grid[row]?.[col];
        const posKey  = `${col},${row}`;
        const entity  = cell?.entityId
          ? this.state.entities.find(e => e.id === cell.entityId)
          : undefined;

        const div = document.createElement("div");
        div.className = "cs-cell";
        if (!cell?.passable)           div.classList.add("cell-wall");
        if (reachable.has(posKey))     div.classList.add("cell-move");
        if (entity && attackable.has(entity.id)) div.classList.add("cell-attack");
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

          if (!entity.isDead && attackable.has(entity.id)) {
            div.addEventListener("click", () => this.selectAttackTarget(entity.id));
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

    panel.appendChild(this.actionBtn("Move",   this.mode === "selecting_move",   () => this.toggleMode("selecting_move")));
    panel.appendChild(this.actionBtn("Attack", this.mode === "selecting_attack", () => this.toggleMode("selecting_attack")));

    for (const ability of me.abilities ?? []) {
      const btn = this.actionBtn(ability.name, false,
        ability.usesLeft > 0 ? () => this.selectAbility(ability.id, ability.targetType) : undefined
      );
      btn.title = ability.description;
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
    this.renderGrid();
    this.renderActions();
  }

  private selectMoveDestination(pos: GridPosition): void {
    this.plan.move = pos;
    this.mode      = "idle";
    this.renderGrid();
    this.renderActions();
  }

  private selectAttackTarget(targetId: string): void {
    this.plan.action = { type: "attack", targetEntityId: targetId };
    this.mode        = "idle";
    this.renderGrid();
    this.renderActions();
  }

  private selectAbility(abilityId: string, targetType?: string): void {
    if (!targetType || targetType === "self") {
      this.plan.action = { type: "ability", abilityId };
      this.renderActions();
    } else {
      this.plan.action = { type: "ability", abilityId };
      this.mode        = "selecting_ability";
      this.renderGrid();
    }
  }

  private confirmSubmit(): void {
    const me = this.myEntity();
    if (!me || !this.state) return;
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

  private myEntity(): CombatEntityView | undefined {
    if (!this.state?.myEntityId) return undefined;
    return this.state.entities.find(e => e.id === this.state!.myEntityId);
  }

  private resetPlan(): void {
    this.plan             = { hasSubmitted: false };
    this.mode             = "idle";
    this.pendingPlayerIds = [];
  }

  private reachableCells(entity: CombatEntityView): Set<string> {
    if (!this.state) return new Set();
    const reachable = new Set<string>();
    const visited   = new Set<string>();
    const q: Array<{ pos: GridPosition; steps: number }> = [{ pos: entity.position, steps: 0 }];
    const dirs: Array<[number, number]> = [[-1,0],[1,0],[0,-1],[0,1],[-1,-1],[1,-1],[-1,1],[1,1]];
    while (q.length) {
      const { pos, steps } = q.shift()!;
      const key = `${pos.x},${pos.y}`;
      if (visited.has(key)) continue;
      visited.add(key);
      if (steps > 0) reachable.add(key);
      if (steps >= entity.speed) continue;
      for (const [dx, dy] of dirs) {
        const nx = pos.x + dx, ny = pos.y + dy;
        if (nx < 0 || ny < 0 || ny >= 8 || nx >= 8) continue;
        const cell = this.state!.grid[ny]?.[nx];
        if (!cell?.passable) continue;
        if (cell.entityId && cell.entityId !== entity.id) continue;
        q.push({ pos: { x: nx, y: ny }, steps: steps + 1 });
      }
    }
    return reachable;
  }

  private attackableIds(entity: CombatEntityView): Set<string> {
    if (!this.state || !entity.weapon) return new Set();
    const ids = new Set<string>();
    for (const e of this.state.entities) {
      if (e.type === entity.type || e.isDead) continue;
      const dist = Math.abs(e.position.x - entity.position.x) +
                   Math.abs(e.position.y - entity.position.y);
      if (dist <= entity.weapon.range) ids.add(e.id);
    }
    return ids;
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
      #cs-grid-wrap { flex:1; display:flex; align-items:center; justify-content:center; overflow:auto; perspective:1300px; perspective-origin:50% 38%; }
      #cs-grid { transition:transform .45s ease; transform-style:preserve-3d; }
      /* 2.5D isometric (dimetric) tilt — the board lies on a ground plane. */
      #cs-grid.cs-iso { transform:rotateX(55deg) rotateZ(45deg); }
      .cs-cell { width:60px; height:60px; background:#c9b489; border:1px solid #8a6f48; border-radius:4px; display:flex; align-items:center; justify-content:center; position:relative; box-sizing:border-box; transform-style:preserve-3d; }
      .cs-iso .cs-cell { box-shadow:inset 0 0 0 1px rgba(120,96,56,.5), 0 1px 0 rgba(60,44,24,.35); }
      .cell-wall { background:#6e5836; border-color:#5a4630; }
      .cell-move { background:rgba(92,100,66,.34); border-color:#5c6442; cursor:pointer; }
      .cell-move:hover { background:rgba(92,100,66,.5); }
      .cell-attack { background:rgba(138,59,42,.3); border-color:#8a3b2a; cursor:crosshair; }
      .cell-attack:hover { background:rgba(138,59,42,.45); }
      .cell-planned { border:2px dashed #8a5a2c; }
      .cs-token { width:50px; height:50px; border-radius:50%; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:2px; border:2px solid transparent; transition:transform .2s; }
      /* Billboard tokens upright (inverse of the grid tilt) and float them above the tile. */
      .cs-iso .cs-token { transform:rotateZ(-45deg) rotateX(-55deg) translateZ(24px); box-shadow:0 7px 9px rgba(20,12,6,.5); }
      .cs-iso .cs-token-mine { transform:rotateZ(-45deg) rotateX(-55deg) translateZ(30px); }
      .cs-token-player { background:#6e5230; border-color:#a07a44; }
      .cs-token-enemy  { background:#5a2e22; border-color:#8a3b2a; }
      .cs-token-mine   { border-color:#d8b878; box-shadow:0 0 0 2px rgba(216,184,120,.4) inset; }
      .cs-token-dead   { opacity:.3; filter:grayscale(1); }
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
