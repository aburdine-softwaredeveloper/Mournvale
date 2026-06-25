/**
 * CombatScreen.ts — Client-side tactical combat interface
 *
 * Mounts as an overlay over the game screen when combat_start is received.
 * Unmounts and calls onCombatEnd() when combat_end is received.
 *
 * Responsibilities:
 *   - Render the 8×8 CSS-grid combat board
 *   - Show entity tokens with HP bars
 *   - Highlight reachable tiles (blue) and attackable targets (red) on selection
 *   - Show action buttons (Move / Attack / Ability / End Turn)
 *   - Collect the player's plan and submit via onSubmitAction callback
 *   - Animate event playback (sequential, 300–700 ms per event)
 *   - Show the initiative order and combat log in a sidebar
 */

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
          // Greyscale: darker = wounded, lighter = healthy.
          hpFill.style.background = pct <= 30 ? "#2a2a2a" : "#6a6a6a";
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
    this.onSubmitAction({ entityId: me.id, move: this.plan.move, action: this.plan.action });
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
    const dirs = [[-1,0],[1,0],[0,-1],[0,1],[-1,-1],[1,-1],[-1,1],[1,1]];
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
    // Light-mode greyscale to match the rest of the UI. Player vs enemy
    // tokens are distinguished by shade (and the gold "mine" ring) rather
    // than hue, keeping the monochrome look readable.
    s.textContent = `
      #cs-root { display:flex; flex-direction:column; height:100%; background:#d8d8d8; color:#222222; font-family:inherit; }
      #cs-header { display:flex; align-items:center; gap:16px; padding:8px 16px; background:rgba(0,0,0,.06); font-size:13px; border-bottom:1px solid rgba(0,0,0,.15); }
      #cs-round { font-weight:500; }
      #cs-phase-label { color:#5a5a5a; }
      #cs-waiting { margin-left:auto; color:#1a1a1a; font-size:12px; }
      #cs-body { display:flex; flex:1; gap:12px; padding:12px; overflow:hidden; }
      #cs-grid-wrap { flex:0 0 auto; overflow:auto; }
      .cs-cell { width:60px; height:60px; background:#c4c4c4; border:1px solid #9a9a9a; border-radius:4px; display:flex; align-items:center; justify-content:center; position:relative; box-sizing:border-box; }
      .cell-wall { background:#a4a4a4; border-color:#8a8a8a; }
      .cell-move { background:rgba(0,0,0,.10); border-color:#4a4a4a; cursor:pointer; }
      .cell-move:hover { background:rgba(0,0,0,.18); }
      .cell-attack { background:rgba(0,0,0,.22); border-color:#1a1a1a; cursor:crosshair; }
      .cell-attack:hover { background:rgba(0,0,0,.32); }
      .cell-planned { border:2px dashed #1a1a1a; }
      .cs-token { width:50px; height:50px; border-radius:50%; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:2px; border:2px solid transparent; }
      .cs-token-player { background:#5a5a5a; border-color:#2a2a2a; }
      .cs-token-enemy  { background:#1f1f1f; border-color:#000000; }
      .cs-token-mine   { border-color:#000000; box-shadow:0 0 0 2px #ffffff inset; }
      .cs-token-dead   { opacity:.3; filter:grayscale(1); }
      .cs-token-letter { font-size:18px; font-weight:500; color:#fff; line-height:1; }
      .cs-hp-wrap { width:38px; height:4px; background:rgba(0,0,0,.35); border-radius:2px; overflow:hidden; }
      .cs-hp-fill { height:100%; border-radius:2px; transition:width .3s; }
      #cs-sidebar { width:200px; flex-shrink:0; display:flex; flex-direction:column; gap:8px; overflow-y:auto; }
      .cs-panel { background:rgba(0,0,0,.05); border-radius:8px; padding:10px; }
      .cs-panel-log { flex:1; display:flex; flex-direction:column; min-height:0; }
      .cs-panel-title { font-size:11px; color:#5a5a5a; margin-bottom:6px; }
      .cs-init-row { display:flex; align-items:center; gap:6px; padding:3px 0; font-size:12px; }
      .cs-init-name { flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
      .cs-init-hp { font-size:11px; color:#5a5a5a; }
      .cs-init-badge { font-size:11px; background:rgba(0,0,0,.10); padding:1px 5px; border-radius:3px; }
      .cs-init-dead { opacity:.35; text-decoration:line-through; }
      .cs-init-mine { color:#1a1a1a; font-weight:500; }
      .cs-btn { display:block; width:100%; padding:7px 10px; margin-bottom:5px; background:rgba(0,0,0,.06); border:1px solid rgba(0,0,0,.20); border-radius:6px; color:#222222; cursor:pointer; font-size:12px; text-align:left; transition:background .1s; }
      .cs-btn:hover:not([disabled]) { background:rgba(0,0,0,.13); }
      .cs-btn[disabled] { opacity:.35; cursor:not-allowed; }
      .cs-btn-active { border-color:#1a1a1a; color:#1a1a1a; }
      .cs-btn-confirm { border-color:#1a1a1a; color:#1a1a1a; margin-top:8px; }
      .cs-plan-summary { font-size:11px; color:#5a5a5a; padding:3px 0; }
      .cs-muted { font-size:12px; color:#5a5a5a; margin:0; }
      #cs-log { overflow-y:auto; flex:1; font-size:11px; line-height:1.7; }
      .cs-log-entry { border-bottom:1px solid rgba(0,0,0,.08); padding:1px 0; }
      .cs-log-entity_dies { color:#1a1a1a; font-weight:500; }
      .cs-log-attack_crit { color:#1a1a1a; font-weight:500; }
      .cs-log-attack_hit  { color:#333333; }
      .cs-log-attack_miss { color:#8a8a8a; }
      .cs-log-heal        { color:#4a4a4a; }
      .cs-log-burn_damage { color:#3a3a3a; }
      .cs-log-combat_ends { color:#1a1a1a; font-weight:500; }
      .cs-end-overlay { position:absolute; inset:0; background:rgba(0,0,0,.45); display:flex; align-items:center; justify-content:center; z-index:10; }
      .cs-end-card { background:#d4d4d4; border:1px solid #8a8a8a; border-radius:12px; padding:32px 40px; text-align:center; }
      .cs-end-title { margin:0 0 8px; font-size:22px; font-weight:500; color:#1a1a1a; }
      .cs-end-body  { margin:0 0 20px; color:#5a5a5a; font-size:14px; }
      #cs-return-btn { padding:10px 24px; background:#4a4a4a; border:none; border-radius:6px; color:#fff; cursor:pointer; font-size:14px; }
      #cs-return-btn:hover { background:#2a2a2a; }
    `;
    document.head.appendChild(s);
  }
}
