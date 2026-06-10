import { DEFAULT_AUDIO, loadAudioSettings, type AudioSettings } from "./settings";

/** Every one-shot the table can make. */
export const SFX_NAMES = [
  "chipPick",
  "chipPlace",
  "deal",
  "flip",
  "win",
  "lose",
  "push",
  "victory",
  "bust",
] as const;

export type SfxName = (typeof SFX_NAMES)[number];

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
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
    } catch {
      ctx = null;
      master = null;
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
): void {
  if (!ctx || !master) return;
  const t0 = ctx.currentTime + at;
  const osc = ctx.createOscillator();
  const env = ctx.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  env.gain.setValueAtTime(0, t0);
  env.gain.linearRampToValueAtTime(peak, t0 + 0.005);
  env.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
  osc.connect(env).connect(master);
  osc.start(t0);
  osc.stop(t0 + dur + 0.02);
}

/** A decaying noise burst through a bandpass — card swishes and snaps. */
function swish(at: number, dur: number, freq: number, peak = 0.25): void {
  if (!ctx || !master) return;
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
  src.connect(band).connect(env).connect(master);
  src.start(t0);
}

const SOUNDS: Record<SfxName, () => void> = {
  chipPick: () => tone(0, 1800, 0.05, "triangle", 0.22),
  chipPlace: () => {
    tone(0, 950, 0.04, "square", 0.25);
    tone(0.045, 700, 0.05, "square", 0.2);
  },
  deal: () => swish(0, 0.18, 1800),
  flip: () => {
    swish(0, 0.06, 3000, 0.18);
    tone(0.01, 1400, 0.05, "triangle", 0.15);
  },
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
