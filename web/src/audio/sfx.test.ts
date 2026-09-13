import { vi } from "vitest";
import {
  playSfx,
  setVolume,
  setMuted,
  startAmbience,
  stopAmbience,
  pauseAudio,
  resumeAudio,
  SFX_NAMES,
} from "./sfx";

test("an ad-break pause hands back a resume, both safe without audio", () => {
  let resume: () => void = () => {};
  expect(() => (resume = pauseAudio())).not.toThrow();
  expect(() => resume()).not.toThrow();
});

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

// ---------------------------------------------------------------------------
// "Muted means idle": suspending must not be immediately undone by a resume
// that runs while the mute is still in effect. A minimal fake AudioContext
// so these paths can be exercised for real, instead of the no-context
// short-circuit the tests above rely on.

class FakeGainNode {
  gain = {
    value: 0,
    setValueAtTime() {},
    setTargetAtTime() {},
    linearRampToValueAtTime() {},
    exponentialRampToValueAtTime() {},
  };
  connect() {
    return this;
  }
  disconnect() {}
}
class FakeOscillatorNode {
  type = "sine";
  frequency = { value: 0 };
  connect() {
    return this;
  }
  start() {}
  stop() {}
}
class FakeBufferSourceNode {
  buffer: unknown = null;
  loop = false;
  connect() {
    return this;
  }
  start() {}
  stop() {}
}
class FakeBiquadFilterNode {
  type = "lowpass";
  frequency = { value: 0 };
  Q = { value: 0 };
  connect() {
    return this;
  }
}
class FakeAudioContext {
  state: "running" | "suspended" = "running";
  currentTime = 0;
  sampleRate = 44100;
  destination = {};
  createGain() {
    return new FakeGainNode();
  }
  createOscillator() {
    return new FakeOscillatorNode();
  }
  createBufferSource() {
    return new FakeBufferSourceNode();
  }
  createBiquadFilter() {
    return new FakeBiquadFilterNode();
  }
  createBuffer(_channels: number, length: number) {
    return { getChannelData: () => new Float32Array(length) };
  }
  resume = vi.fn(async () => {
    this.state = "running";
  });
  suspend = vi.fn(async () => {
    this.state = "suspended";
  });
}

function stubFakeAudioContext(): FakeAudioContext {
  const fake = new FakeAudioContext();
  vi.stubGlobal("AudioContext", vi.fn(() => fake) as unknown as typeof AudioContext);
  return fake;
}

test("muted means idle: neither resumeAudio() nor startAmbience() resume a suspended context", () => {
  // One fake context for the whole test — ensureContext()'s lazy-create only
  // runs once per module lifetime, so a second stubbed AudioContext global
  // wouldn't replace an already-created one.
  const fake = stubFakeAudioContext();
  playSfx("error"); // lazily creates the real context, unmuted
  expect(fake.state).toBe("running");

  setMuted(true);
  expect(fake.suspend).toHaveBeenCalledTimes(1);
  expect(fake.state).toBe("suspended");

  resumeAudio(); // direct call: must stay a no-op while muted
  expect(fake.resume).not.toHaveBeenCalled();
  expect(fake.state).toBe("suspended");

  startAmbience(); // ensureContext()'s own resume must also stay gated
  expect(fake.resume).not.toHaveBeenCalled();
  expect(fake.state).toBe("suspended");

  setMuted(false); // unmuting still resumes
  expect(fake.resume).toHaveBeenCalledTimes(1);
  expect(fake.state).toBe("running");

  stopAmbience();
  vi.unstubAllGlobals();
});
