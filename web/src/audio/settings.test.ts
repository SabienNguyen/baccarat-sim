import { loadAudioSettings, saveAudioSettings, DEFAULT_AUDIO } from "./settings";

function memoryStorage(): Storage {
  const map = new Map<string, string>();
  return {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k),
    clear: () => map.clear(),
    key: () => null,
    get length() {
      return map.size;
    },
  };
}

test("defaults when nothing is saved", () => {
  expect(loadAudioSettings(memoryStorage())).toEqual({ volume: 0.5, muted: false, music: true });
});

test("round-trips volume and mute", () => {
  const storage = memoryStorage();
  saveAudioSettings({ volume: 0.8, muted: true, music: false }, storage);
  expect(loadAudioSettings(storage)).toEqual({ volume: 0.8, muted: true, music: false });
});

test("clamps out-of-range volume and survives garbage", () => {
  const storage = memoryStorage();
  storage.setItem("baccarat.audio", JSON.stringify({ volume: 7, muted: "yes" }));
  expect(loadAudioSettings(storage)).toEqual({ volume: 1, muted: false, music: true });
  storage.setItem("baccarat.audio", "not json");
  expect(loadAudioSettings(storage)).toEqual(DEFAULT_AUDIO);
});

test("degrades to defaults with no storage at all", () => {
  expect(loadAudioSettings(undefined)).toEqual(DEFAULT_AUDIO);
  expect(() => saveAudioSettings({ volume: 0.3, muted: false, music: true }, undefined)).not.toThrow();
});
