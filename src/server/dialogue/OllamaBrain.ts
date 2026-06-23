/**
 * OllamaBrain.ts — Free, local LLM backend via Ollama (https://ollama.com).
 *
 * Ollama runs a model entirely on the host machine and exposes a local HTTP API
 * at http://localhost:11434 — no API key, no account, no per-token cost, and it
 * works offline. We talk to it with the built-in `fetch` (no SDK dependency).
 *
 * Setup (one time):
 *   1. Install Ollama, then `ollama pull llama3.2:3b` (≈2 GB; any small chat
 *      model works — qwen2.5:3b, gemma2:2b, phi3.5 are all fine).
 *   2. Make sure `ollama serve` is running (the app does this automatically).
 * Override the endpoint/model with OLLAMA_URL / OLLAMA_MODEL env vars.
 *
 * If Ollama isn't running, isAvailable() returns false (cheaply, cached) and the
 * caller falls back to ScriptedBrain — the game never blocks on the LLM.
 */

import type { NpcBrain, NpcReplyContext } from "./NpcBrain";
import { buildNpcSystemPrompt } from "./NpcBrain";

const DEFAULT_URL = "http://localhost:11434";
const DEFAULT_MODEL = "llama3.2:3b";

/** Re-probe availability at most this often (ms), so a started/stopped Ollama
 * is picked up without a server restart but we don't ping on every message. */
const AVAILABILITY_TTL_MS = 30_000;

export class OllamaBrain implements NpcBrain {
  readonly name = "ollama";

  private readonly url: string;
  private readonly model: string;
  private available = false;
  private lastChecked = 0;

  constructor(
    url: string = process.env["OLLAMA_URL"] ?? DEFAULT_URL,
    model: string = process.env["OLLAMA_MODEL"] ?? DEFAULT_MODEL
  ) {
    this.url = url.replace(/\/$/, "");
    this.model = model;
  }

  async isAvailable(): Promise<boolean> {
    const now = Date.now();
    if (now - this.lastChecked < AVAILABILITY_TTL_MS) return this.available;
    this.lastChecked = now;

    try {
      const res = await this.fetchWithTimeout(`${this.url}/api/tags`, { method: "GET" }, 1500);
      this.available = res.ok;
    } catch {
      this.available = false;
    }
    if (!this.available) {
      console.log(`[npc-brain] Ollama not reachable at ${this.url} — using scripted fallback.`);
    }
    return this.available;
  }

  async generateReply(ctx: NpcReplyContext): Promise<string> {
    const messages = [
      { role: "system", content: buildNpcSystemPrompt(ctx) },
      ...ctx.history,
      { role: "user", content: ctx.message },
    ];

    const res = await this.fetchWithTimeout(
      `${this.url}/api/chat`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model: this.model,
          stream: false,
          messages,
          options: { temperature: 0.8, num_predict: 160 },
        }),
      },
      20_000
    );

    if (!res.ok) throw new Error(`Ollama responded ${res.status}`);
    const data = (await res.json()) as { message?: { content?: string } };
    const text = sanitize(data.message?.content ?? "");
    if (!text) throw new Error("Ollama returned an empty reply");
    return text;
  }

  private async fetchWithTimeout(
    url: string,
    init: RequestInit,
    timeoutMs: number
  ): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetch(url, { ...init, signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }
  }
}

/**
 * Tidy a raw model reply for display: strip wrapping quotes a model sometimes
 * adds, collapse whitespace, and hard-cap length so one runaway generation
 * can't flood the log.
 */
function sanitize(raw: string): string {
  let text = raw.trim();
  if (text.length >= 2 && text.startsWith('"') && text.endsWith('"')) {
    text = text.slice(1, -1).trim();
  }
  text = text.replace(/\s+/g, " ");
  if (text.length > 600) text = text.slice(0, 597).trimEnd() + "…";
  return text;
}
