import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { VolumeControl } from "./VolumeControl";
import { loadAudioSettings } from "../audio/settings";

/** The environment's global localStorage is unreliable; stub a real one. */
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

beforeEach(() => vi.stubGlobal("localStorage", memoryStorage()));
afterEach(() => vi.unstubAllGlobals());

test("slider reflects and persists the volume", () => {
  render(<VolumeControl />);
  const slider = screen.getByRole("slider", { name: "Volume" });
  expect(slider).toHaveValue("50"); // the 0.5 default
  fireEvent.change(slider, { target: { value: "80" } });
  expect(loadAudioSettings().volume).toBe(0.8);
});

test("the speaker button toggles and persists mute", async () => {
  const user = userEvent.setup();
  render(<VolumeControl />);
  await user.click(screen.getByRole("button", { name: "Mute sounds" }));
  expect(loadAudioSettings().muted).toBe(true);
  await user.click(screen.getByRole("button", { name: "Unmute sounds" }));
  expect(loadAudioSettings().muted).toBe(false);
});

test("dragging the slider while muted unmutes", () => {
  render(<VolumeControl />);
  fireEvent.click(screen.getByRole("button", { name: "Mute sounds" }));
  fireEvent.change(screen.getByRole("slider", { name: "Volume" }), {
    target: { value: "30" },
  });
  expect(loadAudioSettings()).toEqual({ volume: 0.3, muted: false, music: true });
});

test("the music note toggles and persists the lounge loop", async () => {
  const user = userEvent.setup();
  render(<VolumeControl />);
  await user.click(screen.getByRole("button", { name: "Turn music off" }));
  expect(loadAudioSettings().music).toBe(false);
  await user.click(screen.getByRole("button", { name: "Turn music on" }));
  expect(loadAudioSettings().music).toBe(true);
});
