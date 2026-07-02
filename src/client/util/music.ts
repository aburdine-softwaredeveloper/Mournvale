/**
 * music.ts — Procedural background music (WebAudio, no asset files)
 *
 * Two looping themes, synthesized live so nothing ships as an audio file
 * (same philosophy as the blips in audio.ts):
 *
 *   "town"   — eerie, dreading, sleepy. A low detuned drone breathing under
 *              sparse minor bell notes fed through a long feedback delay,
 *              a slow bell toll, and a whisper of band-passed wind.
 *   "combat" — dangerous. A driving sawtooth ostinato on D minor with a
 *              tritone snarl, kick / snare / hat percussion carved out of
 *              noise, and a tense tremolo string overhead.
 *
 * Architecture: a single lookahead scheduler (setInterval + AudioContext
 * clock) walks a step counter and schedules a lookahead window of notes,
 * so timing is sample-accurate even though JS timers jitter. Sustained
 * layers (drones, wind, tremolo) are built once per track and torn down
 * on switch. setMusic() crossfades between tracks via per-track master
 * gains feeding one global music bus.
 *
 * The AudioContext is shared with audio.ts and stays suspended until the
 * player's first gesture — the scheduler simply idles until it's running,
 * so it is always safe to call setMusic() early (e.g. on an auto-advanced
 * boot splash). Mute (audio.ts) is polled every tick and ducks the bus.
 */

import { getAudioContext, isMuted } from "./audio";

export type MusicTrack = "town" | "combat" | "none";

// ── Music-only mute (independent of the SFX mute in audio.ts) ────────────────

const MUSIC_MUTE_KEY = "mournvale.musicMuted";

/**
 * Defaults to the global SFX mute on first run, so players who muted the
 * game before music existed stay silent until they opt back in.
 */
let musicMuted: boolean = loadMusicMuted();

function loadMusicMuted(): boolean {
  try {
    const stored = window.localStorage.getItem(MUSIC_MUTE_KEY);
    if (stored !== null) return stored === "1";
  } catch {
    /* fall through to the SFX default */
  }
  return isMuted();
}

export function isMusicMuted(): boolean {
  return musicMuted;
}

/** Mutes/unmutes music only; the scheduler keeps time so it ducks silently. */
export function setMusicMuted(value: boolean): void {
  musicMuted = value;
  try {
    window.localStorage.setItem(MUSIC_MUTE_KEY, value ? "1" : "0");
  } catch {
    /* ignore persistence failure */
  }
}

// ── Tuning constants ──────────────────────────────────────────────────────────

/** Overall music level — background presence, never foreground. */
const BUS_LEVEL = 0.5;
/** Crossfade time between tracks (s). */
const FADE_S = 1.6;
/** Scheduler lookahead window (s) and tick period (ms). */
const LOOKAHEAD_S = 0.4;
const TICK_MS = 90;

/** Seconds per scheduler step, per track. Town breathes; combat drives. */
const STEP_S: Record<Exclude<MusicTrack, "none">, number> = {
  town: 0.85,
  combat: 0.214, // 8th notes at ~140 BPM
};

// Note frequencies (Hz) — D natural-minor territory.
const D2 = 73.42, F2 = 87.31, Ab2 = 103.83, C2 = 65.41, A2 = 110.0;
const D3 = 146.83;
const D4 = 293.66, Eb4 = 311.13, E4 = 329.63, F4 = 349.23,
      A4 = 440.0, Bb4 = 466.16, C5 = 523.25;

/** Sparse, weighted pool the town bells draw from (minor, unresolved). */
const TOWN_BELLS = [D4, F4, A4, D4, F4, C5, Bb4, E4];

/**
 * Combat bass ostinato — two bars of 8ths. 0 = rest. The Ab2 tritone
 * against D is what makes it read "dangerous" rather than merely fast.
 */
const COMBAT_BASS = [
  D2, 0, D2, F2, D2, 0, Ab2, D2,
  D2, 0, D2, F2, C2, D2, Ab2, 0,
];

// ── Module state ──────────────────────────────────────────────────────────────

let desired: MusicTrack = "none";
let current: MusicTrack = "none";

let bus: GainNode | null = null;          // global music bus (mute ducking)
let trackGain: GainNode | null = null;    // current track's master (crossfades)
let sustained: AudioNode[] = [];          // long-lived sources to stop on switch
let delaySend: GainNode | null = null;    // town: input to the echo network

let tickTimer: number | null = null;
let step = 0;
let nextNoteTime = 0;

// ─────────────────────────────────────────────
// PUBLIC API
// ─────────────────────────────────────────────

/**
 * Requests a music track. Idempotent; crossfades if something else is
 * playing. Safe to call before the AudioContext is unlocked.
 */
export function setMusic(track: MusicTrack): void {
  desired = track;
  if (tickTimer === null) {
    tickTimer = window.setInterval(tick, TICK_MS);
  }
}

// ─────────────────────────────────────────────
// SCHEDULER
// ─────────────────────────────────────────────

function tick(): void {
  const ctx = getAudioContext();
  if (!ctx || ctx.state !== "running") return; // idle until first gesture

  ensureBus(ctx);

  // Debug breadcrumb for live verification (harmless in production).
  (window as unknown as { __mournvaleMusic?: string }).__mournvaleMusic =
    `${current}:${ctx.state}`;

  // Duck the whole bus when music is muted (poll — cheap, survives toggles).
  bus!.gain.setTargetAtTime(musicMuted ? 0 : BUS_LEVEL, ctx.currentTime, 0.06);

  if (desired !== current) switchTrack(ctx);
  if (current === "none" || !trackGain) return;

  // If the tab slept, don't try to catch up on missed steps.
  if (nextNoteTime < ctx.currentTime) nextNoteTime = ctx.currentTime + 0.05;

  const stepDur = STEP_S[current];
  while (nextNoteTime < ctx.currentTime + LOOKAHEAD_S) {
    if (current === "town") scheduleTownStep(ctx, trackGain, step, nextNoteTime);
    else scheduleCombatStep(ctx, trackGain, step, nextNoteTime);
    nextNoteTime += stepDur;
    step++;
  }
}

function ensureBus(ctx: AudioContext): void {
  if (bus) return;
  bus = ctx.createGain();
  bus.gain.value = musicMuted ? 0 : BUS_LEVEL;
  bus.connect(ctx.destination);
}

/** Fades out the old track, tears it down, and builds the new one. */
function switchTrack(ctx: AudioContext): void {
  const t = ctx.currentTime;

  // Retire the old track: ramp its master to silence, stop sources after.
  if (trackGain) {
    const dying = trackGain;
    const dyingNodes = sustained;
    dying.gain.cancelScheduledValues(t);
    dying.gain.setValueAtTime(dying.gain.value, t);
    dying.gain.linearRampToValueAtTime(0.0001, t + FADE_S);
    window.setTimeout(() => {
      for (const n of dyingNodes) {
        try { (n as AudioScheduledSourceNode).stop?.(); } catch { /* ignore */ }
      }
      try { dying.disconnect(); } catch { /* ignore */ }
    }, (FADE_S + 0.3) * 1000);
  }

  trackGain = null;
  sustained = [];
  delaySend = null;
  current = desired;
  step = 0;

  if (current === "none") return;

  // Build the new track's master and fade it in.
  const master = ctx.createGain();
  master.gain.setValueAtTime(0.0001, t);
  master.gain.linearRampToValueAtTime(1, t + FADE_S);
  master.connect(bus!);
  trackGain = master;
  nextNoteTime = t + 0.1;

  if (current === "town") buildTownSustained(ctx, master);
  else buildCombatSustained(ctx, master);
}

// ─────────────────────────────────────────────
// SHARED VOICES
// ─────────────────────────────────────────────

/** One enveloped oscillator note into `out`. Returns nothing; self-stops. */
function note(
  ctx: AudioContext, out: AudioNode, opts: {
    freq: number; type: OscillatorType; at: number;
    peak: number; attack: number; decay: number; detune?: number;
    filterHz?: number;
  }
): void {
  const osc = ctx.createOscillator();
  osc.type = opts.type;
  osc.frequency.value = opts.freq;
  if (opts.detune) osc.detune.value = opts.detune;

  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.0001, opts.at);
  gain.gain.exponentialRampToValueAtTime(opts.peak, opts.at + opts.attack);
  gain.gain.exponentialRampToValueAtTime(0.0001, opts.at + opts.attack + opts.decay);

  if (opts.filterHz) {
    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = opts.filterHz;
    osc.connect(filter);
    filter.connect(gain);
  } else {
    osc.connect(gain);
  }
  gain.connect(out);
  osc.start(opts.at);
  osc.stop(opts.at + opts.attack + opts.decay + 0.05);
}

/** A shaped burst of white noise (percussion / wind gusts). */
function noiseBurst(
  ctx: AudioContext, out: AudioNode, opts: {
    at: number; peak: number; decay: number;
    filterType: BiquadFilterType; filterHz: number;
  }
): void {
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer(ctx);
  const filter = ctx.createBiquadFilter();
  filter.type = opts.filterType;
  filter.frequency.value = opts.filterHz;
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(opts.peak, opts.at);
  gain.gain.exponentialRampToValueAtTime(0.0001, opts.at + opts.decay);
  src.connect(filter);
  filter.connect(gain);
  gain.connect(out);
  src.start(opts.at);
  src.stop(opts.at + opts.decay + 0.05);
}

let cachedNoise: AudioBuffer | null = null;
function noiseBuffer(ctx: AudioContext): AudioBuffer {
  if (cachedNoise && cachedNoise.sampleRate === ctx.sampleRate) return cachedNoise;
  const len = ctx.sampleRate; // 1 s of noise, looped where needed
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  cachedNoise = buf;
  return buf;
}

/** A slow LFO wired to a gain param — the "breathing" of drones. */
function lfo(
  ctx: AudioContext, param: AudioParam, rateHz: number, depth: number
): void {
  const osc = ctx.createOscillator();
  osc.frequency.value = rateHz;
  const scale = ctx.createGain();
  scale.gain.value = depth;
  osc.connect(scale);
  scale.connect(param);
  osc.start();
  sustained.push(osc);
}

// ─────────────────────────────────────────────
// TOWN THEME — eerie / sleepy / dreading
// ─────────────────────────────────────────────

function buildTownSustained(ctx: AudioContext, out: GainNode): void {
  // Breathing drone: D2 + a barely-detuned twin + the fifth, all sine,
  // swelling and receding on a ~14 s cycle like the town snoring.
  const droneGain = ctx.createGain();
  droneGain.gain.value = 0.05;
  lfo(ctx, droneGain.gain, 0.07, 0.022);
  droneGain.connect(out);

  for (const [freq, detune] of [[D2, 0], [D2, 9], [A2, -4]] as const) {
    const osc = ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.value = freq;
    osc.detune.value = detune;
    osc.connect(droneGain);
    osc.start();
    sustained.push(osc);
  }

  // Wind: looped noise through a wandering band-pass, very quiet.
  const wind = ctx.createBufferSource();
  wind.buffer = noiseBuffer(ctx);
  wind.loop = true;
  const windFilter = ctx.createBiquadFilter();
  windFilter.type = "bandpass";
  windFilter.frequency.value = 280;
  windFilter.Q.value = 0.6;
  lfo(ctx, windFilter.frequency, 0.05, 120);
  const windGain = ctx.createGain();
  windGain.gain.value = 0.012;
  lfo(ctx, windGain.gain, 0.043, 0.006);
  wind.connect(windFilter);
  windFilter.connect(windGain);
  windGain.connect(out);
  wind.start();
  sustained.push(wind);

  // Haunted echo network the bells feed into: a long feedback delay.
  const send = ctx.createGain();
  send.gain.value = 0.9;
  const delay = ctx.createDelay(2);
  delay.delayTime.value = 0.62;
  const feedback = ctx.createGain();
  feedback.gain.value = 0.42;
  const echoTone = ctx.createBiquadFilter();
  echoTone.type = "lowpass";
  echoTone.frequency.value = 1600;
  send.connect(delay);
  delay.connect(echoTone);
  echoTone.connect(feedback);
  feedback.connect(delay);
  echoTone.connect(out);
  delaySend = send;
}

function scheduleTownStep(
  ctx: AudioContext, out: GainNode, s: number, t: number
): void {
  const bellOut = delaySend ?? out;

  // Sparse music-box bells — often silent, which is what makes it sleepy.
  if (Math.random() < 0.26) {
    const freq = TOWN_BELLS[Math.floor(Math.random() * TOWN_BELLS.length)]!;
    note(ctx, bellOut, {
      freq, type: "sine", at: t + Math.random() * 0.3,
      peak: 0.055, attack: 0.02, decay: 2.6, detune: Math.random() * 6 - 3,
    });
    // Ghost partial an octave up, quieter — glassy, unsettling.
    if (Math.random() < 0.4) {
      note(ctx, bellOut, {
        freq: freq * 2, type: "sine", at: t + 0.02,
        peak: 0.016, attack: 0.02, decay: 1.8,
      });
    }
  }

  // The slow toll — a low bell every ~14 s, the town's heartbeat.
  if (s % 16 === 8) {
    note(ctx, bellOut, {
      freq: D3, type: "triangle", at: t,
      peak: 0.07, attack: 0.01, decay: 4.5, filterHz: 900,
    });
  }

  // Dread: an unresolved minor-second shimmer, rarely, quietly.
  if (s % 24 === 20 && Math.random() < 0.6) {
    note(ctx, bellOut, { freq: Eb4, type: "sine", at: t,       peak: 0.02, attack: 0.6, decay: 2.4 });
    note(ctx, bellOut, { freq: D4,  type: "sine", at: t + 0.1, peak: 0.02, attack: 0.6, decay: 2.4 });
  }
}

// ─────────────────────────────────────────────
// COMBAT THEME — dangerous / driving
// ─────────────────────────────────────────────

function buildCombatSustained(ctx: AudioContext, out: GainNode): void {
  // Tense high tremolo string hovering over the fight.
  const trem = ctx.createOscillator();
  trem.type = "sawtooth";
  trem.frequency.value = A4;
  const tremFilter = ctx.createBiquadFilter();
  tremFilter.type = "lowpass";
  tremFilter.frequency.value = 1400;
  const tremGain = ctx.createGain();
  tremGain.gain.value = 0.012;
  lfo(ctx, tremGain.gain, 6.2, 0.008); // fast flutter = nerves
  trem.connect(tremFilter);
  tremFilter.connect(tremGain);
  tremGain.connect(out);
  trem.start();
  sustained.push(trem);
}

function scheduleCombatStep(
  ctx: AudioContext, out: GainNode, s: number, t: number
): void {
  // Driving bass ostinato (sawtooth, choked short).
  const bassFreq = COMBAT_BASS[s % COMBAT_BASS.length]!;
  if (bassFreq > 0) {
    note(ctx, out, {
      freq: bassFreq, type: "sawtooth", at: t,
      peak: 0.075, attack: 0.008, decay: 0.16, filterHz: 620,
    });
  }

  // Kick on the quarters: a sine with a fast pitch drop.
  if (s % 4 === 0) {
    const osc = ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.setValueAtTime(130, t);
    osc.frequency.exponentialRampToValueAtTime(42, t + 0.11);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.22, t);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.14);
    osc.connect(gain);
    gain.connect(out);
    osc.start(t);
    osc.stop(t + 0.16);
  }

  // Snare on the backbeat, hats on the 8ths.
  if (s % 8 === 4) {
    noiseBurst(ctx, out, { at: t, peak: 0.11, decay: 0.13, filterType: "highpass", filterHz: 1400 });
  }
  noiseBurst(ctx, out, { at: t, peak: s % 2 === 0 ? 0.028 : 0.018, decay: 0.03, filterType: "highpass", filterHz: 6000 });

  // A dissonant brass-ish stab every four bars — the danger flare.
  if (s % 32 === 16) {
    for (const [freq, detune] of [[D4, 0], [Eb4, 4], [A4, -3]] as const) {
      note(ctx, out, {
        freq, type: "sawtooth", at: t, detune,
        peak: 0.03, attack: 0.015, decay: 0.9, filterHz: 1800,
      });
    }
  }
}
