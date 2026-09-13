import { vi } from "vitest";

const stopAmbience = vi.fn();
const startAmbience = vi.fn();
const suspendAudio = vi.fn();
const resumeAudio = vi.fn();
const isAmbiencePlaying = vi.fn(() => false);

vi.mock("./sfx", () => ({
  stopAmbience: (...a: unknown[]) => stopAmbience(...a),
  startAmbience: (...a: unknown[]) => startAmbience(...a),
  suspendAudio: (...a: unknown[]) => suspendAudio(...a),
  resumeAudio: (...a: unknown[]) => resumeAudio(...a),
  isAmbiencePlaying: () => isAmbiencePlaying(),
}));

import { installSleepOnHide } from "./sleep";

function setHidden(hidden: boolean) {
  Object.defineProperty(document, "hidden", { value: hidden, configurable: true });
}

let uninstall: (() => void) | null = null;

afterEach(() => {
  uninstall?.();
  uninstall = null;
});

beforeEach(() => {
  stopAmbience.mockClear();
  startAmbience.mockClear();
  suspendAudio.mockClear();
  resumeAudio.mockClear();
  isAmbiencePlaying.mockClear();
  isAmbiencePlaying.mockReturnValue(false);
  document.documentElement.classList.remove("hidden");
  setHidden(false);
});

test("going hidden stops ambience, suspends audio, and flags the document", () => {
  isAmbiencePlaying.mockReturnValue(true);
  uninstall = installSleepOnHide();
  setHidden(true);
  document.dispatchEvent(new Event("visibilitychange"));
  expect(stopAmbience).toHaveBeenCalledTimes(1);
  expect(suspendAudio).toHaveBeenCalledTimes(1);
  expect(document.documentElement.classList.contains("hidden")).toBe(true);
});

test("coming back resumes audio and restarts ambience only if it had been on", () => {
  isAmbiencePlaying.mockReturnValue(true);
  uninstall = installSleepOnHide();
  setHidden(true);
  document.dispatchEvent(new Event("visibilitychange"));
  setHidden(false);
  document.dispatchEvent(new Event("visibilitychange"));
  expect(resumeAudio).toHaveBeenCalledTimes(1);
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
  expect(resumeAudio).toHaveBeenCalledTimes(1);
  expect(startAmbience).not.toHaveBeenCalled();
});

test("uninstall removes the listener", () => {
  const uninstall = installSleepOnHide();
  uninstall();
  setHidden(true);
  document.dispatchEvent(new Event("visibilitychange"));
  expect(stopAmbience).not.toHaveBeenCalled();
  expect(suspendAudio).not.toHaveBeenCalled();
});
