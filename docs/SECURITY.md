# Mournvale — Security Review

Reviewed 2026-07-08 against `main` (PR #9). Scope: the Node/WebSocket game
server, static file serving, persistence, the Ollama integration, and the
client's rendering of server/player-supplied text — i.e. everything that
matters once the game is shared beyond this machine.

**Bottom line:** the codebase is in good shape for **private hosting
(LAN or Tailscale)** today. Before exposing a **public** URL (Cloudflare
Tunnel / Funnel / VPS), fix the two Medium items below — both are small.

---

## What already holds up (verified in code)

- **Path traversal — safe.** The static handler
  ([httpStatic.ts](../src/server/httpStatic.ts)) decodes the URL, joins
  against the build root, and rejects anything that resolves outside it.
  Save files ([SaveStore.ts](../src/server/persistence/SaveStore.ts)) strip
  `playerId` to `[a-zA-Z0-9_-]` and hard-validate slot numbers, so a malicious
  identify payload can't escape `saves/`.
- **XSS — no findings.** All player-influenced text (chat log, names, room
  panels) is rendered with `textContent`, never `innerHTML`. The `innerHTML`
  sinks that exist (room art, portraits) only receive server/asset-generated
  SVG. Character names are additionally whitelisted to letters, spaces,
  hyphens, apostrophes (2–20 chars) at creation, so they can't smuggle markup
  anywhere.
- **Server-authoritative design.** Clients send intents; all outcomes (dice,
  combat resolution, gold, inventory mutations, quest gating, disposition)
  are computed server-side. Shop actions re-validate room co-location and
  prices; save slots are validated. There's no "trust the client's numbers"
  path.
- **LLM is flavor-only.** Ollama runs on localhost, is never exposed, and its
  output is only displayed as NPC speech. Skill checks, lore grants, and
  disposition changes are computed from server data, not from model output —
  so prompt injection can make an NPC *say* silly things but can't grant
  items, XP, or quest progress.
- **Secrets/data hygiene.** No API keys anywhere (Ollama needs none);
  `saves/` and `dist/` are gitignored, so player data never lands in the repo.
- **Crash containment.** Malformed JSON on the socket is caught and answered
  politely; disconnects mid-combat dissolve/resolve fights instead of wedging
  server state. PM2 auto-restarts on a crash.

---

## Findings

### M1 — No WebSocket payload cap or rate limiting (Medium)

`new WebSocketServer({ server })` in
[index.ts](../src/server/index.ts) uses the `ws` default `maxPayload`
(**100 MiB**), and every frame is `JSON.parse`d. A hostile client can send
huge frames (memory pressure) or thousands of small ones per second — and
each `say` to an NPC triggers an Ollama generation, so chat spam translates
directly into CPU/GPU burn and a stalled NPC queue for everyone.

**Fix (small):**
- `new WebSocketServer({ server: httpServer, maxPayload: 16 * 1024 })`.
- Cap free-text inputs (say/chat) to a few hundred characters server-side.
- Add a simple per-socket token bucket (e.g. 10 messages/sec, and ~1 LLM
  chat per 2–3 s) that drops excess with a "You're speaking too quickly"
  message.

Risk is theoretical among invited friends, **required before a public URL**.

### M2 — `playerId` is a self-asserted bearer token (Medium)

Identity is a client-generated UUID in `localStorage`, sent via `identify`
and accepted if it's 8–64 chars ([index.ts:379](../src/server/index.ts)).
Consequences:

- Anyone who learns another player's `playerId` can load, overwrite, or
  delete that player's saves and impersonate them. There is no secret beyond
  the ID itself.
- A second connection identifying with the same ID silently overwrites the
  `playerSockets` entry, hijacking that player's targeted messages
  (combat views, quest rewards).

Random UUIDs aren't guessable in practice, so on a private tailnet this is
acceptable. For public hosting, the minimal hardening is to treat the ID
strictly as a secret (it already never appears in URLs — good) and reject a
second live socket for an ID that already has one. The real fix — a
server-issued credential or accounts — is only worth it if the game grows
beyond a friend group.

### L1 — No transport encryption from the server itself (Low)

The server speaks plain `http://`/`ws://`. On a shared/public network,
traffic (including `playerId`) is sniffable. **Both recommended tunnels
erase this**: Tailscale encrypts end-to-end (WireGuard), and Cloudflare
Tunnel / `tailscale serve` terminate HTTPS, which the client auto-upgrades
to `wss://`. Just don't share your bare `http://<public-ip>:3000` via router
port-forwarding — use a tunnel.

### L2 — Binding 0.0.0.0 exposes the game to the whole LAN (Low, by design)

Intended for LAN play, fine. Once you host via Tailscale/Cloudflare, nothing
needs to reach port 3000 except localhost and the tunnel — if you ever play
from a café network, macOS's firewall (System Settings → Network → Firewall)
blocking inbound Node connections is cheap insurance.

### L3 — Log-forging via player text (Low)

Chat/commands are echoed into `pm2` logs (`[Traveler-1234] state:… type:…`
plus command text in various handlers). Multi-line or ANSI-laced input can
forge log lines. Cosmetic; fixed for free by the M1 length caps if you strip
control characters at the same time.

### N1 — Unused `express` dependency (Note)

`express` is in `dependencies` but the server uses only Node's `http` — the
static handler was hand-rolled precisely to avoid the framework. Remove it
(`npm uninstall express`) to shrink the supply-chain/audit surface.

### N2 — Ops notes (Note)

- Run `npm audit` before going public; keep `ws` and `tsx` current.
- `saves/` is the only stateful data — back it up (see maintenance doc).
- `pm2 startup` hasn't been run yet — an unattended reboot silently takes
  the game (and any tunnel pointing at it) offline.

---

## Checklist before each exposure level

**LAN / Tailscale (now):** nothing blocking. Optionally do N1.

**Public URL (Cloudflare Tunnel / Funnel):**
1. M1 — payload cap + input length caps + message rate limit
2. M2 — reject duplicate live sockets per playerId
3. N1/N2 — drop express, `npm audit`, `pm2 startup`, save backups
4. Always via the tunnel's HTTPS; never raw port-forward 3000
