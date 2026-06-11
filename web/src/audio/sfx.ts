import { DEFAULT_AUDIO, loadAudioSettings, type AudioSettings } from "./settings";

/** Every one-shot the table can make. */
export const SFX_NAMES = [
  "chipPick",
  "chipPlace",
  "chipReturn",
  "deal",
  "flip",
  "squeeze",
  "win",
  "lose",
  "push",
  "victory",
  "bust",
  "error",
  "shuffle",
] as const;

export type SfxName = (typeof SFX_NAMES)[number];

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
/** One-shot bus: lifts the boops above the ambience without touching it. */
let shots: GainNode | null = null;
let settings: AudioSettings = { ...DEFAULT_AUDIO };
let loaded = false;

function ensureSettings(): void {
  if (!loaded) {
    settings = loadAudioSettings();
    loaded = true;
  }
}

/** Squared for a perceptual taper: half the slider sounds half as loud. */
function masterLevel(): number {
  return settings.muted ? 0 : settings.volume * settings.volume;
}

function applyLevel(): void {
  if (!ctx || !master) return;
  master.gain.setTargetAtTime(masterLevel(), ctx.currentTime, 0.01);
}

/** Lazy context: created on the first sound, which always follows a click. */
function ensureContext(): AudioContext | null {
  if (typeof AudioContext === "undefined") return null;
  if (ctx === null) {
    try {
      ctx = new AudioContext();
      master = ctx.createGain();
      master.gain.value = masterLevel();
      master.connect(ctx.destination);
      shots = ctx.createGain();
      shots.gain.value = 1.35;
      shots.connect(master);
    } catch {
      ctx = null;
      master = null;
      shots = null;
      return null;
    }
  }
  if (ctx.state === "suspended") void ctx.resume().catch(() => {});
  return ctx;
}

export function setVolume(volume: number): void {
  ensureSettings();
  settings = { ...settings, volume: Math.min(1, Math.max(0, volume)) };
  applyLevel();
}

export function setMuted(muted: boolean): void {
  ensureSettings();
  settings = { ...settings, muted };
  applyLevel();
}

/** One chiptune note: instant attack, exponential decay. */
function tone(
  at: number,
  freq: number,
  dur: number,
  type: OscillatorType = "square",
  peak = 0.3,
  out: GainNode | null = shots,
): void {
  if (!ctx || !out) return;
  const t0 = ctx.currentTime + at;
  const osc = ctx.createOscillator();
  const env = ctx.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  env.gain.setValueAtTime(0, t0);
  env.gain.linearRampToValueAtTime(peak, t0 + 0.005);
  env.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
  osc.connect(env).connect(out);
  osc.start(t0);
  osc.stop(t0 + dur + 0.02);
}

/** A decaying noise burst through a bandpass — card swishes and snaps. */
function swish(at: number, dur: number, freq: number, peak = 0.25): void {
  if (!ctx || !shots) return;
  const t0 = ctx.currentTime + at;
  const len = Math.max(1, Math.ceil(ctx.sampleRate * dur));
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const band = ctx.createBiquadFilter();
  band.type = "bandpass";
  band.frequency.value = freq;
  band.Q.value = 0.8;
  const env = ctx.createGain();
  env.gain.value = peak;
  src.connect(band).connect(env).connect(shots);
  src.start(t0);
}

const SOUNDS: Record<SfxName, () => void> = {
  chipPick: () => tone(0, 1800, 0.05, "triangle", 0.22),
  chipPlace: () => {
    tone(0, 950, 0.04, "square", 0.25);
    tone(0.045, 700, 0.05, "square", 0.2);
  },
  chipReturn: () => {
    // softer than a place: chips sliding home, pitch falling away
    tone(0, 800, 0.04, "triangle", 0.16);
    tone(0.05, 620, 0.05, "triangle", 0.13);
  },
  deal: () => {
    // four cards out of the shoe, one slide each
    for (let i = 0; i < 4; i++) swish(i * 0.13, 0.1, 1700 + (i % 2) * 300, 0.18);
  },
  flip: () => {
    swish(0, 0.06, 3000, 0.18);
    tone(0.01, 1400, 0.05, "triangle", 0.15);
  },
  squeeze: () => swish(0, 0.12, 700, 0.14), // a low paper bend
  win: () => {
    // rising C-major arpeggio
    [523, 659, 784, 1047].forEach((f, i) => tone(i * 0.09, f, 0.14, "square", 0.25));
  },
  lose: () => {
    tone(0, 392, 0.16, "square", 0.25);
    tone(0.15, 311, 0.26, "square", 0.25);
  },
  push: () => tone(0, 660, 0.1, "triangle", 0.22),
  victory: () => {
    [392, 523, 659, 784].forEach((f, i) => tone(i * 0.11, f, 0.16, "square", 0.28));
    tone(0.46, 1047, 0.5, "square", 0.3);
  },
  bust: () => {
    // the long walk away from the table
    [330, 277, 233].forEach((f, i) => tone(i * 0.19, f, 0.24, "square", 0.26));
    tone(0.57, 196, 0.6, "square", 0.28);
  },
  error: () => {
    // the dealer's flat two-note "no"
    tone(0, 110, 0.09, "square", 0.2);
    tone(0.1, 92, 0.14, "square", 0.2);
  },
  shuffle: () => {
    // a riffle: quick ticks building into one long cascade
    for (let i = 0; i < 6; i++) swish(i * 0.05, 0.04, 1500 + i * 150, 0.12);
    swish(0.34, 0.28, 1100, 0.16);
  },
};

export function playSfx(name: SfxName): void {
  ensureSettings();
  if (masterLevel() === 0) return;
  if (ensureContext() === null) return;
  try {
    SOUNDS[name]();
  } catch {
    /* a sound must never break the game */
  }
}

// ---------------------------------------------------------------------------
// The table soundscape: a continuous casino-floor bed (murmur, distant chips,
// far-off payouts) plus an optional lounge loop. Started when a table mounts,
// stopped in the lobby. Everything rides the master gain, so the volume
// slider and mute govern it all.

let ambience: { stop: () => void } | null = null;
let lounge: { stop: () => void } | null = null;

/** A slow ii–V–I–vi in C: bass root + chord tones, in Hz. */
const PROGRESSION = [
  { bass: 73.42, tones: [146.83, 174.61, 220.0, 261.63] }, // Dm7
  { bass: 98.0, tones: [196.0, 246.94, 293.66, 349.23] }, // G7
  { bass: 65.41, tones: [130.81, 164.81, 196.0, 246.94] }, // Cmaj7
  { bass: 110.0, tones: [220.0, 261.63, 329.62, 392.0] }, // Am7
] as const;

const BAR_MS = 2800;

function startLounge(): void {
  if (lounge || !ctx || !master) return;
  const out = ctx.createGain();
  out.gain.value = 0.55; // under the table, never over it
  out.connect(master);
  let bar = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const playBar = () => {
    timer = setTimeout(playBar, BAR_MS);
    const chord = PROGRESSION[bar % PROGRESSION.length];
    bar += 1;
    try {
      // walking-ish bass: root on the one, the fifth on the three
      tone(0, chord.bass, 0.5, "triangle", 0.16, out);
      tone(1.4, chord.bass * 1.5, 0.45, "triangle", 0.12, out);
      // soft chord stabs on the off-beats
      for (const at of [0.7, 2.1]) {
        for (const f of chord.tones.slice(0, 3)) tone(at, f, 0.2, "triangle", 0.045, out);
      }
      // a sparse melody note, one octave up, when the mood strikes
      if (Math.random() < 0.6) {
        const f = chord.tones[Math.floor(Math.random() * chord.tones.length)] * 2;
        tone(0.35 + Math.random() * 1.6, f, 0.5, "triangle", 0.055, out);
      }
    } catch {
      /* a dropped bar is fine */
    }
  };
  playBar();
  lounge = {
    stop: () => {
      if (timer !== undefined) clearTimeout(timer);
      out.disconnect();
    },
  };
}

function stopLounge(): void {
  lounge?.stop();
  lounge = null;
}

/** Turn the lounge loop on/off live (and remember it for the next table). */
export function setMusicEnabled(music: boolean): void {
  ensureSettings();
  settings = { ...settings, music };
  if (!music) stopLounge();
  else if (ambience) startLounge(); // only audible at a table
}

export function startAmbience(): void {
  ensureSettings();
  if (ambience) return;
  const c = ensureContext();
  if (!c || !master) return;
  try {
    const room = c.createGain();
    room.gain.value = 0.032;
    room.connect(master);
    // room tone: looped brownish noise, lowpassed — the floor's hush
    const len = c.sampleRate * 3;
    const buf = c.createBuffer(1, len, c.sampleRate);
    const data = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) {
      last = (last + (Math.random() * 2 - 1) * 0.02) * 0.99;
      data[i] = last * 3;
    }
    const src = c.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    const lp = c.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 420;
    src.connect(lp).connect(room);
    src.start();
    // a slow swell so the murmur breathes
    const lfo = c.createOscillator();
    lfo.frequency.value = 0.07;
    const depth = c.createGain();
    depth.gain.value = 0.012;
    lfo.connect(depth).connect(room.gain);
    lfo.start();
    // distant life: sparse clinks and somebody else's payout
    let timer: ReturnType<typeof setTimeout> | undefined;
    const sparkle = () => {
      timer = setTimeout(sparkle, 2500 + Math.random() * 6500);
      const roll = Math.random();
      if (roll < 0.5) {
        // straight to master: distant life shouldn't ride the one-shot boost
        tone(0, 1400 + Math.random() * 900, 0.04, "triangle", 0.05, master);
      } else if (roll < 0.8) {
        const base = 700 + Math.random() * 300;
        [1, 1.25, 1.5].forEach((m, i) =>
          tone(i * 0.07, base * m, 0.08, "triangle", 0.04, master),
        );
      }
      // else: just the murmur
    };
    sparkle();
    ambience = {
      stop: () => {
        if (timer !== undefined) clearTimeout(timer);
        try {
          src.stop();
          lfo.stop();
        } catch {
          /* already stopped */
        }
        room.disconnect();
      },
    };
    if (settings.music) startLounge();
  } catch {
    ambience = null;
  }
}

export function stopAmbience(): void {
  stopLounge();
  ambience?.stop();
  ambience = null;
}
