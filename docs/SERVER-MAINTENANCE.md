# Mournvale — Server Maintenance & Hosting Guide

How to update the always-on game server on port 3000, what exactly is being
maintained on this machine, and how to share the game beyond your LAN with a
permanent tunnel.

---

## 1. The full picture — what is running

Everything lives in **this repo directory** (`~/Projects/Mournvale`). There is
no separate deploy copy: the production server runs the working tree.

| Component | What it is | Where / how |
| --- | --- | --- |
| **Game server (production)** | PM2 process **`mournvale`** → `npm start` → `tsx src/server/index.ts`. One process serves the built client **and** the WebSocket on **port 3000**, bound to all interfaces. | `pm2 status` / `pm2 logs mournvale` |
| **Built client** | Static bundle the server serves. Produced by `npm run build`. **Not** rebuilt automatically — deploys must rebuild it. | `dist/client/` (gitignored) |
| **Player saves** | JSON, one folder per player, 5 slots each. Never touched by deploys or PM2 reloads. **This is the only irreplaceable data — back it up.** | `saves/<playerId>/slot-N.json` (gitignored) |
| **NPC brain (optional)** | Ollama on `localhost:11434`, model `llama3.2:3b`. If it's down, NPCs use scripted dialogue — the game keeps working. | `ollama serve` (the Mac app keeps it running) |
| **Process config** | Ports, `OLLAMA_URL`/`OLLAMA_MODEL` env for the PM2 process. | [ecosystem.config.cjs](../ecosystem.config.cjs) |
| **Deploy script** | `npm ci` → build client → graceful PM2 reload → `pm2 save`. | [scripts/deploy.sh](../scripts/deploy.sh) |

**Port map** (all three can run at once):

| Port | Purpose |
| --- | --- |
| **3000** | Production (PM2, always-on) — the one you share |
| **3001** | `npm run dev` server (hot reload) |
| **3002** | Claude Code preview server (`.claude/launch.json`) |
| 11434 | Ollama (localhost only) |

**Important caveat — one working tree:** the PM2 process reads
`src/` **at the moment it (re)starts**. Day-to-day this is safe: sitting on a
dev branch does *not* affect the running server until something reloads it.
But it means **whatever branch is checked out when `deploy.sh` runs is what
goes live.** Always deploy from `main` (step 2 below). If this ever bites,
the clean fix is a second clone (e.g. `~/Deploy/Mournvale`) that only ever
checks out `main`, with the PM2 process pointed there.

---

## 2. Updating the port-3000 server

After merging your dev branch into `main` on GitHub:

```bash
cd ~/Projects/Mournvale
git checkout main
git pull
./scripts/deploy.sh        # npm ci → build client → pm2 reload → pm2 save
git checkout DEV-GameUpdate   # go back to your dev branch afterwards
```

That's the whole procedure. `deploy.sh` reloads gracefully — connected players
get disconnected briefly (their progress auto-saves on disconnect) and can
reload the page. Saves are never modified.

**Verify it worked:**

```bash
pm2 status                 # mournvale should be "online" with fresh uptime
pm2 logs mournvale --lines 20   # look for "🏰 Mournvale listening on http://localhost:3000"
```

Then open http://localhost:3000 in a browser.

**Rollback** (if a deploy breaks the game):

```bash
git checkout <last-good-commit-or-tag>
./scripts/deploy.sh
```

### Routine care

| Task | Command | When |
| --- | --- | --- |
| Health check | `pm2 status` · `lsof -nP -iTCP:3000 -sTCP:LISTEN` | Whenever something seems off |
| Read logs | `pm2 logs mournvale` (live) · `pm2 logs mournvale --lines 200` | Debugging |
| Restart without deploy | `pm2 restart mournvale` | Stale-process weirdness (e.g. portraits not emitting) |
| **Back up saves** | `cp -r saves ~/Backups/mournvale-saves-$(date +%F)` | Before risky changes; periodically |
| Update deps | `npm audit` · `npm outdated` | Occasionally, especially before public hosting |

### ⚠ One-time step still outstanding: survive reboots

`pm2 save` is done by every deploy, but PM2 itself is not yet registered to
launch at boot on this Mac. Run once:

```bash
pm2 startup
# …then copy-paste and run the sudo command it prints
```

Until you do this, a machine reboot means the game is down until you manually
run `pm2 resurrect` (or `./scripts/deploy.sh`).

---

## 3. Permanent tunneling — sharing the game

The client auto-connects its WebSocket to whatever origin the page loads from,
and upgrades to `wss://` under HTTPS — so any HTTP(S) tunnel that supports
WebSockets works with zero code changes. **No router port-forwarding is needed
with either option below**, which is itself a security win: your home network
stays closed.

### Option A — Tailscale (recommended for *private* sharing with friends)

Tailscale builds a private WireGuard mesh ("tailnet") between your devices and
your friends'. The game is reachable **only** by people you invite — it is
never exposed to the public internet, traffic is end-to-end encrypted, and the
URL never changes. Free for personal use (up to 3 users / 100 devices).

**Setup (once):**

1. Install Tailscale on this Mac (`brew install --cask tailscale`, or the Mac
   App Store app) and sign in. It runs from the menu bar and starts at login —
   that's your "permanent" part, no extra service config.
2. Invite friends from the [admin console](https://login.tailscale.com/admin)
   (**Users → Invite**), or share just this machine with
   **Machines → … → Share**. They install Tailscale and sign in.
3. Find your machine's tailnet name (e.g. `your-mac.tailnet-name.ts.net`) via
   `tailscale status`.
4. Friends open: **`http://your-mac.<tailnet>.ts.net:3000`** — done.

Optional polish — real HTTPS on the tailnet without exposing anything:

```bash
tailscale serve --bg 3000
# → https://your-mac.<tailnet>.ts.net  (valid cert, wss:// automatically)
```

(If you ever want a *public* URL through Tailscale, `tailscale funnel 3000`
does that — but then anyone with the link can join, so treat it like Option B
and read the security doc first.)

### Option B — Cloudflare Tunnel (for a *public* URL / custom domain)

A permanent named tunnel with a stable hostname, free, WebSocket-capable, with
HTTPS terminated by Cloudflare. Requires a domain you own (≈$10/yr) added to a
free Cloudflare account.

```bash
brew install cloudflared
cloudflared tunnel login                 # opens browser, pick your domain
cloudflared tunnel create mournvale
cloudflared tunnel route dns mournvale play.yourdomain.com
```

Create `~/.cloudflared/config.yml`:

```yaml
tunnel: mournvale
credentials-file: /Users/aburdine/.cloudflared/<tunnel-id>.json
ingress:
  - hostname: play.yourdomain.com
    service: http://localhost:3000
  - service: http_status:404
```

Make it permanent (installs a LaunchDaemon that starts at boot):

```bash
sudo cloudflared service install
```

Friends open **`https://play.yourdomain.com`** — no software needed on their
end. Since this is public to anyone who finds the URL, do the hardening items
in [SECURITY.md](SECURITY.md) first.

### What about ngrok?

Fine for a one-evening session, but the free tier gives a random URL each run
and interstitial pages — not a permanent solution. Prefer A or B.

### Recommendation

Start with **Tailscale** (Option A): it matches "private sharing with friends"
exactly, takes ~10 minutes, requires no domain, and sidesteps most of the
public-exposure security concerns because only invited people can reach the
server. Graduate to Cloudflare Tunnel later if you want a public
`play.yourdomain.com`.

Note on Ollama: it stays on `localhost:11434` on this Mac and is never
tunneled — remote players' NPC chat flows through the game server, which talks
to Ollama locally. Nothing to change.
