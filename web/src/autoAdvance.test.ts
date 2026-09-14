import { autoAdvanceMs, isRecentlyTouched } from "./autoAdvance";

describe("autoAdvanceMs", () => {
  afterEach(() => {
    // @ts-expect-error test cleanup of a global we stub per-test
    delete window.matchMedia;
  });

  test("keeps the desktop pace when matchMedia is unavailable (jsdom default)", () => {
    expect(autoAdvanceMs()).toBe(3000);
  });

  test("keeps the desktop pace on a fine pointer", () => {
    window.matchMedia = vi.fn().mockReturnValue({ matches: false }) as unknown as typeof matchMedia;
    expect(autoAdvanceMs()).toBe(3000);
  });

  test("adds 2000ms on a coarse pointer (phone/tablet)", () => {
    window.matchMedia = vi.fn().mockReturnValue({ matches: true }) as unknown as typeof matchMedia;
    expect(autoAdvanceMs()).toBe(5000);
  });

  test("honours a custom base", () => {
    window.matchMedia = vi.fn().mockReturnValue({ matches: true }) as unknown as typeof matchMedia;
    expect(autoAdvanceMs(1000)).toBe(3000);
  });
});

describe("isRecentlyTouched", () => {
  test("false when no touch has landed yet", () => {
    expect(isRecentlyTouched(null, 10_000)).toBe(false);
  });

  test("true within the grace period", () => {
    expect(isRecentlyTouched(1000, 1500)).toBe(true);
  });

  test("false once the grace period lapses", () => {
    expect(isRecentlyTouched(1000, 2001)).toBe(false);
  });

  test("respects a custom grace window", () => {
    expect(isRecentlyTouched(1000, 1400, 2000)).toBe(true);
    expect(isRecentlyTouched(1000, 3001, 2000)).toBe(false);
  });
});
