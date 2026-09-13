import { adBreak } from "./adBreak";
import { nullAdapter } from "./nullAdapter";
import type { PortalAdapter } from "./types";

function fakePortal(over: Partial<PortalAdapter> = {}): PortalAdapter {
  return { ...nullAdapter, name: "fake", ...over };
}

test("pauses audio around a midgame ad and always restores it", async () => {
  const resume = vi.fn();
  const pause = vi.fn(() => resume);
  const requestMidgameAd = vi.fn(async () => {
    expect(pause).toHaveBeenCalledOnce();
    expect(resume).not.toHaveBeenCalled();
  });
  await adBreak(fakePortal({ requestMidgameAd }), pause);
  expect(requestMidgameAd).toHaveBeenCalledOnce();
  expect(resume).toHaveBeenCalledOnce();
});

test("a failing ad still restores the audio and does not reject", async () => {
  const resume = vi.fn();
  const pause = vi.fn(() => resume);
  const requestMidgameAd = vi.fn(async () => {
    throw new Error("no fill");
  });
  await expect(adBreak(fakePortal({ requestMidgameAd }), pause)).resolves.toBeUndefined();
  expect(resume).toHaveBeenCalledOnce();
});

test("the null portal is skipped entirely: audio is never touched", async () => {
  const pause = vi.fn(() => vi.fn());
  await adBreak(nullAdapter, pause);
  expect(pause).not.toHaveBeenCalled();
});
