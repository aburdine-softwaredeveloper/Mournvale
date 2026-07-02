/**
 * audio.ts — Tiny retro sound layer (WebAudio, no asset files)
 *
 * The whole point is the classic "blip" that older games play as text
 * scrolls across the screen. We synthesize it on the fly with an
 * OscillatorGain pair so there are no audio files to ship and no latency.
 *
 * Browsers suspend the AudioContext until the first user gesture, so we
 * lazily create it and attach one-time resume handlers to the document.
 * Until the player clicks/keys once (which they always do — the boot
 * splash and intro both require input), blips are simply no-ops.
 *
 * A global mute flag lets the UI silence everything; it's persisted to
 * localStorage so the player's choice survives reloads.
 */

const MUTE_KEY = "mournvale.muted";

let ctx: AudioContext | null = null;
let muted = loadMuted();
let gestureHooked = false;
/** Throttle: ignore blips that arrive faster than this (ms). */
const MIN_BLIP_GAP_MS = 28;
let lastBlipAt = 0;

function loadMuted(): boolean {
  try {
    return window.localStorage.getItem(MUTE_KEY) === "1";
  } catch {
    return false;
  }
}

/** Lazily build the shared AudioContext and wire a one-time resume. */
function getContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AC) return null;

  if (!ctx) {
    try {
      ctx = new AC();
    } catch {
      return null;
    }
  }

  // Resume on first gesture — most browsers start contexts "suspended".
  if (!gestureHooked) {
    gestureHooked = true;
    const resume = (): void => {
      void ctx?.resume();
      document.removeEventListener("pointerdown", resume);
      document.removeEventListener("keydown", resume);
    };
    document.addEventListener("pointerdown", resume, { passive: true });
    document.addEventListener("keydown", resume, { passive: true });
  }

  return ctx;
}

/**
 * Plays one short low-tone "text" blip — a soft square-ish chirp with a
 * fast decay. Safe to call on every typed character; it self-throttles
 * and never throws.
 */
export function playBlip(): void {
  if (muted) return;
  const now = (typeof performance !== "undefined" ? performance.now() : Date.now());
  if (now - lastBlipAt < MIN_BLIP_GAP_MS) return;
  lastBlipAt = now;

  const audio = getContext();
  if (!audio || audio.state !== "running") return;

  try {
    const t = audio.currentTime;
    const osc = audio.createOscillator();
    const gain = audio.createGain();

    // Low, slightly detuned tone for a warm 8-bit feel. A touch of
    // per-blip pitch jitter keeps repeated characters from sounding flat.
    osc.type = "square";
    osc.frequency.value = 220 + Math.random() * 30; // ~A3, gentle wobble

    // Quick pluck envelope: near-instant attack, ~50 ms decay.
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.06, t + 0.005);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);

    osc.connect(gain);
    gain.connect(audio.destination);
    osc.start(t);
    osc.stop(t + 0.06);
  } catch {
    /* never let sound break the UI */
  }
}

/** Plays a soft confirm/select tone (menu navigation, advancing scenes). */
export function playSelect(): void {
  if (muted) return;
  const audio = getContext();
  if (!audio || audio.state !== "running") return;

  try {
    const t = audio.currentTime;
    const osc = audio.createOscillator();
    const gain = audio.createGain();
    osc.type = "triangle";
    osc.frequency.setValueAtTime(330, t);
    osc.frequency.exponentialRampToValueAtTime(523, t + 0.08);
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.09, t + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.14);
    osc.connect(gain);
    gain.connect(audio.destination);
    osc.start(t);
    osc.stop(t + 0.16);
  } catch {
    /* ignore */
  }
}

/**
 * Exposes the shared AudioContext so the music layer (music.ts) rides the
 * same context (and the same first-gesture resume hook) as the blips.
 */
export function getAudioContext(): AudioContext | null {
  return getContext();
}

export function isMuted(): boolean {
  return muted;
}

/** Sets the sound-effects mute directly and persists it. */
export function setMuted(value: boolean): void {
  muted = value;
  try {
    window.localStorage.setItem(MUTE_KEY, muted ? "1" : "0");
  } catch {
    /* ignore persistence failure */
  }
}

/** Toggles global mute, persists it, and returns the new state. */
export function toggleMute(): boolean {
  setMuted(!muted);
  return muted;
}
