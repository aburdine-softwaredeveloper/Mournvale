# Mournvale

A multiplayer, text-based MUD set in a grim-gothic fog-bound village. The
**server is authoritative** — it owns all game state and streams lean "View"
snapshots to clients over WebSocket. The **client is vanilla TypeScript + DOM**
(no framework); it renders snapshots and sends intents.

## Quick start

```bash
npm install
npm run dev        # runs server (:3000) + client (Vite) together
```

Then open the Vite URL. Other scripts:

| Script | What it does |
| --- | --- |
| `npm run dev` | Server + client with hot reload |
| `npm run dev:server` | Server only (`tsx watch`) |
| `npm run dev:client` | Client only (Vite) |
| `npm run build:client` | Production client bundle → `dist/client` |
| `npm run typecheck` | `tsc --noEmit` across the whole project |
| `npm test` | Runs every `*.smoke.ts` (see Testing) |

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
