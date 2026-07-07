# Mournvale

A multiplayer, text-based MUD set in a grim-gothic fog-bound village. The
**server is authoritative** — it owns all game state and streams lean "View"
snapshots to clients over WebSocket. The **client is vanilla TypeScript + DOM**
(no framework); it renders snapshots and sends intents.

## Quick start

```bash
npm install
npm run dev        # runs server (:3001) + client (Vite) together
```

Dev deliberately uses port **3001** so it never collides with the always-on
PM2/production server holding **3000** on the same machine — both can run at
once.

Then open the Vite URL. Other scripts:

| Script | What it does |
| --- | --- |
| `npm run dev` | Server + client with hot reload |
| `npm run dev:server` | Server only (`tsx watch`) |
| `npm run dev:client` | Client only (Vite) |
| `npm run build` | Production client bundle → `dist/client` |
| `npm start` | Run the server, serving the built client (production) |
| `npm run typecheck` | `tsc --noEmit` across the whole project |
| `npm test` | Runs every `*.smoke.ts` (see Testing) |

## Hosting (play with others)

In production the **server serves the client too**, so the whole game lives at a
single address/port — players just open it in a browser and the client connects
its WebSocket back to the same origin (no hardcoded URL).

```bash
npm run build     # bundle the client → dist/client
npm start         # serve client + WebSocket on one port (PORT env, default 3000)
```

The server binds all interfaces, so reach it at `http://<host>:3000`:

- **Same network:** share your machine's LAN IP — `http://192.168.x.x:3000`.
- **Friends anywhere (your machine stays on):** a tunnel like
  [Tailscale](https://tailscale.com), [Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/),
  or `ngrok http 3000`.
- **Always-on (the real goal):** a small VPS (Hetzner, DigitalOcean, Fly.io,
  Railway, or Oracle Cloud's free tier). Run `npm ci && npm run build && npm start`
  there, ideally behind a reverse proxy (Caddy/nginx) terminating **HTTPS** — the
  client auto-upgrades to `wss://` when served over HTTPS.

Notes:
- **Saves** are JSON files under `./saves` — give the host a **persistent disk**
  (some free tiers wipe the filesystem on redeploy).
- **Ollama** runs on the *server* host. For good multiplayer NPC chat, either run
  the server on a box with decent CPU/GPU, or point `OLLAMA_URL` at a separate
  machine (e.g. your home GPU box over Tailscale). Without Ollama, NPCs use the
  scripted fallback — the game still works.
- **Config:** `PORT` (listen port), `OLLAMA_URL` / `OLLAMA_MODEL` (NPC brain),
  and `VITE_SERVER_URL` (build-time override if the client and server live at
  different addresses).

### One-command deploy (self-host, always-on)

Player saves live in `./saves` and are **never touched by a deploy** — both paths
below keep them on the host, so you can ship updates while characters and load
slots are preserved.

**Native (PM2) — lightest for leaving your own machine running:**

```bash
npm install -g pm2        # one time
pm2 startup               # one time — run the line it prints (survives reboot)

./scripts/deploy.sh       # deploy
git pull && ./scripts/deploy.sh   # update (graceful reload, saves intact)
```

**Docker — portable to a VPS, fully isolated:**

```bash
docker compose up -d --build          # deploy OR update (same command)
docker compose logs -f                # tail logs
```

Saves are bind-mounted (`./saves`) so they survive rebuilds and `docker compose
down`. The container is disposable; the saves are not.

### Updating safely (don't break existing saves)

Two rules keep updates from corrupting players' saves/loads:

1. **Never delete or move `./saves`.** It's gitignored and host-resident; deploys
   only rebuild code. Keep it on a persistent disk/volume.
2. **When you change the save *shape*, bump the version + migrate.** `SaveData`
   carries a `version`; on load, old saves are upgraded in
   [`SaveStore.load`](src/server/persistence/SaveStore.ts). The existing v1→v2
   migration (which backfilled `progression`) is the template: bump
   `SAVE_VERSION` in [`saveTypes.ts`](src/server/persistence/saveTypes.ts) and add
   a branch that fills in any new fields with sensible defaults. Do this and a
   player who saved on an old build loads cleanly on the new one.

### Auto-deploy on push (GitHub Actions)

[`.github/workflows/deploy.yml`](.github/workflows/deploy.yml) SSHes into your VPS
on every push to `main` and runs `git pull && ./scripts/deploy.sh`. The Action
doesn't host anything — **your VPS runs the server 24/7**; the Action is just the
"push to update" button. Saves on the VPS are never touched.

**One-time VPS setup (you start the server exactly once):**

```bash
# on the VPS
sudo apt install -y nodejs npm git        # or your distro's equivalent (Node 20+)
npm install -g pm2
git clone <your-repo-url> ~/Mournvale && cd ~/Mournvale
./scripts/deploy.sh        # builds + launches under PM2 (also runs `pm2 save` for you)
pm2 startup                # prints a `sudo … pm2 startup …` line — run THAT line once
                           #   to enable boot startup. (pm2 startup only prints it;
                           #   the sudo line is what registers it.)
```

`pm2 startup` doesn't enable boot-start by itself — it prints a `sudo …` command,
and running *that* is the actual step. You don't run `pm2 save` separately;
`deploy.sh` already did. Verify with `pm2 status` (should show `mournvale` online)
and `pm2 resurrect` (simulates a reboot bringing it back).

**Then add these repo secrets** (Settings → Secrets and variables → Actions):

| Secret | Value |
| --- | --- |
| `VPS_HOST` | server IP or domain |
| `VPS_USER` | the SSH user from above |
| `VPS_SSH_KEY` | a **private** SSH key whose public half is in that user's `~/.ssh/authorized_keys` |
| `VPS_APP_DIR` | the clone path, e.g. `/home/you/Mournvale` |
| `VPS_SSH_PORT` | optional, defaults to `22` |

After that, **`git push` is your whole deploy** — and you never start the server
by hand again. `deploy.sh` uses `pm2 startOrReload`, so it starts the server if
it's down and gracefully reloads it if it's up; `pm2 startup` keeps it alive
across crashes and reboots. (Using Docker instead? Change the remote command in
the workflow to `docker compose up -d --build` and skip the PM2 steps.)

## Project layout

```
src/
  types/      Shared client/server contracts — the single source of truth for
              every shape that crosses the socket or defines game data:
              network.ts (the WS message union), character.ts, progression.ts,
              talents.ts, combat.ts, quest.ts, npc.ts, party.ts, game.ts, story.ts
  server/     Authoritative game server
    index.ts          Entry point + socket I/O orchestration (only this file
                      touches sockets; everything else is pure logic)
    gameState.ts      The live player/room registry
    commands/         Text command router (look, move, say, help)
    world/            Rooms, NPCs, WorldManager (static world data + lookups)
    quest/            QuestManager + authored/generated quest data
    combat/           CombatManager — grid combat, initiative, enemy AI
    party/            PartyManager
    character/        Character creation + the skills-screen view builder
    persistence/      SaveStore (JSON files) + save shapes + migration
    skills/           SkillEngine — dice rolls, attacks, skill checks
  client/     Vanilla-TS DOM client
    app.ts            Entry point; owns the single WebSocket, routes messages
    screens/          Full-screen scenes (Menu, Intro, Creation, Game, Combat)
    components/        In-screen widgets (CommandMenu, PartyPanel, QuestBoard,
                      CharacterPanel/TalentTreePanel/AbilityListPanel, …)
    data/, util/      Intro cinematic data, typewriter helper
    index.html, *.css
  engine/     Shared rendering helpers
    assets/           AssetRegistry (asset URL/cache) + PortraitCompositor
public/assets/  Room tiles (.svg) and character portraits/glasses (.png)
scripts/        Tooling (run-smoke.mjs test runner)
docs/           Dev progress logs
```

## Architecture notes

- **One message contract.** Every socket message is a member of the
  `ServerMessage` / `ClientMessage` discriminated unions in
  [`src/types/network.ts`](src/types/network.ts). Never introduce ad-hoc shapes.
- **Server-authoritative state.** Progression (XP, talents, ability loadout,
  attribute allocations) lives on the server, is persisted per save slot, and is
  projected into combat. Clients render `SkillScreenView` and send commands; the
  pure helpers in [`src/types/progression.ts`](src/types/progression.ts) validate
  every mutation.
- **Pure, testable logic.** Engines (SkillEngine, CombatManager, progression,
  QuestManager) are side-effect-free where possible; `index.ts` does the I/O.

## NPC conversation (free local LLM, optional)

NPCs can hold a free-text conversation: `ask <name> <message>` (or the **Chat**
button) rolls a server-authoritative d20 skill check, and a **brain** renders the
NPC's reply conditioned on the result tier. Backends are pluggable
([`src/server/dialogue/`](src/server/dialogue/)) and tried in order:

1. **Ollama** — a free, local LLM (no API key, no fees, runs offline). Install
   [Ollama](https://ollama.com), then `ollama pull llama3.2:3b`. The server auto-
   detects it at `http://localhost:11434`.
2. **Scripted fallback** — the authored `dialogueBranches` in `npcs.ts`. Always
   available, used automatically whenever Ollama isn't running. **No setup
   required** — the feature works out of the box, just less free-form.

Env overrides: `OLLAMA_URL` (default `http://localhost:11434`), `OLLAMA_MODEL`
(default `llama3.2:3b` — any small chat model works: `qwen2.5:3b`, `gemma2:2b`,
`phi3.5`). Game mechanics stay server-side regardless of backend, so the LLM only
ever produces words, never game state.

## Testing

There's no heavyweight test framework. Logic is covered by **standalone smoke
tests** — plain `node:assert` scripts named `*.smoke.ts`, co-located next to the
code they exercise. Run them all with:

```bash
npm test
```

`scripts/run-smoke.mjs` discovers every `*.smoke.ts` under `src/` and runs each
via `tsx`, failing the run if any assertion fails.
