import { isPhoneLike } from "./phoneLike";

describe("isPhoneLike", () => {
  const realWidth = window.innerWidth;

  afterEach(() => {
    // @ts-expect-error test cleanup of a global we stub per-test
    delete window.matchMedia;
    Object.defineProperty(window, "innerWidth", { value: realWidth, configurable: true });
  });

  function setWidth(w: number) {
    Object.defineProperty(window, "innerWidth", { value: w, configurable: true });
  }

  function setCoarse(matches: boolean) {
    window.matchMedia = vi.fn().mockReturnValue({ matches }) as unknown as typeof matchMedia;
  }

  test("false on a wide, fine-pointer desktop", () => {
    setCoarse(false);
    setWidth(1280);
    expect(isPhoneLike()).toBe(false);
  });

  test("true on a coarse pointer even at a wide viewport (tablet landscape)", () => {
    setCoarse(true);
    setWidth(1024);
    expect(isPhoneLike()).toBe(true);
  });

  test("true on a narrow viewport even with a fine pointer (pinched devtools)", () => {
    setCoarse(false);
    setWidth(390);
    expect(isPhoneLike()).toBe(true);
  });

  test("true on a phone (coarse and narrow)", () => {
    setCoarse(true);
    setWidth(390);
    expect(isPhoneLike()).toBe(true);
  });

  test("without matchMedia, falls back to the width signal alone", () => {
    // @ts-expect-error simulating an environment without matchMedia
    delete window.matchMedia;
    setWidth(390);
    expect(isPhoneLike()).toBe(true);
    setWidth(1280);
    expect(isPhoneLike()).toBe(false);
  });
});
