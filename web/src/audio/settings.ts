const KEY = "baccarat.audio";

export interface AudioSettings {
  /** Master volume, 0..1. */
  volume: number;
  muted: boolean;
  /** The lounge loop — separate toggle, background music divides opinion. */
  music: boolean;
}

export const DEFAULT_AUDIO: AudioSettings = { volume: 0.5, muted: false, music: true };

/**
 * Persist the player's sound preferences across reloads. Guarded like
 * bankrollStorage: a disabled Storage degrades to defaults, never throws.
 */
export function loadAudioSettings(
  storage: Storage | undefined = safeStorage(),
): AudioSettings {
  if (!storage) return DEFAULT_AUDIO;
  try {
    const raw = storage.getItem(KEY);
    if (raw === null) return DEFAULT_AUDIO;
    const parsed = JSON.parse(raw) as Partial<AudioSettings>;
    const volume =
      typeof parsed.volume === "number" && Number.isFinite(parsed.volume)
        ? Math.min(1, Math.max(0, parsed.volume))
        : DEFAULT_AUDIO.volume;
    return { volume, muted: parsed.muted === true, music: parsed.music !== false };
  } catch {
    return DEFAULT_AUDIO;
  }
}

export function saveAudioSettings(
  settings: AudioSettings,
  storage: Storage | undefined = safeStorage(),
): void {
  if (!storage) return;
  try {
    storage.setItem(KEY, JSON.stringify(settings));
  } catch {
    /* best-effort */
  }
}

function safeStorage(): Storage | undefined {
  try {
    return typeof localStorage !== "undefined" ? localStorage : undefined;
  } catch {
    return undefined;
  }
}
