import { playSfx, setVolume, setMuted, startAmbience, stopAmbience, SFX_NAMES } from "./sfx";

test("every sound is a silent no-op without an AudioContext", () => {
  // jsdom: typeof AudioContext === "undefined"
  for (const name of SFX_NAMES) {
    expect(() => playSfx(name)).not.toThrow();
  }
});

test("volume and mute setters never throw without audio", () => {
  expect(() => setVolume(0.7)).not.toThrow();
  expect(() => setMuted(true)).not.toThrow();
  expect(() => setMuted(false)).not.toThrow();
});

test("ambience starts and stops safely without an AudioContext", () => {
  expect(() => startAmbience()).not.toThrow();
  expect(() => startAmbience()).not.toThrow(); // double start
  expect(() => stopAmbience()).not.toThrow();
  expect(() => stopAmbience()).not.toThrow(); // double stop
});
