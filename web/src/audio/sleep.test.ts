import { vi } from "vitest";

const stopAmbience = vi.fn();
const startAmbience = vi.fn();
const isAmbiencePlaying = vi.fn(() => false);

// Ambience start/stop and the "was it on" flag are stubbed so the tests can
// dictate the scenario directly; resumeAudio/suspendAudio (and everything
// else) are the REAL sfx.ts functions, spread from the actual module — the
// muted-must-stay-idle gate lives there, and a test must exercise it for
// real rather than through a mock that can only prove itself consistent.
vi.mock("./sfx", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./sfx")>();
  return {
    ...actual,
    stopAmbience: (...a: unknown[]) => stopAmbience(...a),
    startAmbience: (...a: unknown[]) => startAmbience(...a),
    isAmbiencePlaying: () => isAmbiencePlaying(),
  };
});

import * as sfx from "./sfx";
import { installSleepOnHide } from "./sleep";

function setHidden(hidden: boolean) {
  Object.defineProperty(document, "hidden", { value: hidden, configurable: true });
}

let uninstall: (() => void) | null = null;
let resumeSpy: ReturnType<typeof vi.spyOn>;
let suspendSpy: ReturnType<typeof vi.spyOn>;

afterEach(() => {
  uninstall?.();
  uninstall = null;
  resumeSpy?.mockRestore();
  suspendSpy?.mockRestore();
});

beforeEach(() => {
  stopAmbience.mockClear();
  startAmbience.mockClear();
  isAmbiencePlaying.mockClear();
  isAmbiencePlaying.mockReturnValue(false);
  // Real functions — just spied on so the existing call-count assertions
  // still work — running against jsdom's no-AudioContext world, where they
  // no-op harmlessly (see sfx.test.ts for the real-context muted-gate tests).
  resumeSpy = vi.spyOn(sfx, "resumeAudio");
  suspendSpy = vi.spyOn(sfx, "suspendAudio");
  document.documentElement.classList.remove("hidden");
  setHidden(false);
});

test("going hidden stops ambience, suspends audio, and flags the document", () => {
  isAmbiencePlaying.mockReturnValue(true);
  uninstall = installSleepOnHide();
  setHidden(true);
  document.dispatchEvent(new Event("visibilitychange"));
  expect(stopAmbience).toHaveBeenCalledTimes(1);
  expect(suspendSpy).toHaveBeenCalledTimes(1);
  expect(document.documentElement.classList.contains("hidden")).toBe(true);
});

test("coming back resumes audio and restarts ambience only if it had been on", () => {
  isAmbiencePlaying.mockReturnValue(true);
  uninstall = installSleepOnHide();
  setHidden(true);
  document.dispatchEvent(new Event("visibilitychange"));
  setHidden(false);
  document.dispatchEvent(new Event("visibilitychange"));
  expect(resumeSpy).toHaveBeenCalledTimes(1);
  expect(startAmbience).toHaveBeenCalledTimes(1);
  expect(document.documentElement.classList.contains("hidden")).toBe(false);
});

test("does not restart ambience on return if it was already off before hiding", () => {
  isAmbiencePlaying.mockReturnValue(false);
  uninstall = installSleepOnHide();
  setHidden(true);
  document.dispatchEvent(new Event("visibilitychange"));
  setHidden(false);
  document.dispatchEvent(new Event("visibilitychange"));
  expect(resumeSpy).toHaveBeenCalledTimes(1);
  expect(startAmbience).not.toHaveBeenCalled();
});

test("uninstall removes the listener", () => {
  const uninstallNow = installSleepOnHide();
  uninstallNow();
  setHidden(true);
  document.dispatchEvent(new Event("visibilitychange"));
  expect(stopAmbience).not.toHaveBeenCalled();
  expect(suspendSpy).not.toHaveBeenCalled();
});

// ---------------------------------------------------------------------------
// The actual defect this file is here to close: sleep.ts calls resumeAudio()
// unconditionally on visible, and until the fix that resumed a context that
// had been muted-and-suspended (gain zero, still rendering). The gate lives
// in sfx.ts's resumeAudio()/ensureContext(); this drives it end to end with
// a real (faked) AudioContext so a regression there fails here too, not
// just in sfx.test.ts's more targeted unit tests.

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
    return { buffer: null, loop: false, connect: () => this, start() {}, stop() {} };
  }
  createBiquadFilter() {
    return { type: "lowpass", frequency: { value: 0 }, Q: { value: 0 }, connect: () => this };
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

test("a hidden -> visible cycle while muted never resumes the AudioContext", () => {
  const fakeCtx = new FakeAudioContext();
  vi.stubGlobal("AudioContext", vi.fn(() => fakeCtx) as unknown as typeof AudioContext);

  sfx.playSfx("error"); // real sfx.ts: lazily creates the context, unmuted
  expect(fakeCtx.state).toBe("running");
  sfx.setMuted(true); // real sfx.ts: mutes AND suspends
  expect(fakeCtx.state).toBe("suspended");

  uninstall = installSleepOnHide();
  setHidden(true);
  document.dispatchEvent(new Event("visibilitychange"));
  setHidden(false);
  document.dispatchEvent(new Event("visibilitychange"));

  expect(fakeCtx.resume).not.toHaveBeenCalled();
  expect(fakeCtx.state).toBe("suspended");

  sfx.setMuted(false); // leave the real module's shared state clean
  vi.unstubAllGlobals();
});
