import { nullAdapter } from "./nullAdapter";
import { resolvePortalName, selectPortal, getPortal, isEmbedded, _resetPortalForTests } from "./index";

describe("nullAdapter", () => {
  test("every method is a harmless no-op", async () => {
    expect(nullAdapter.name).toBe("none");
    await expect(nullAdapter.init()).resolves.toBeUndefined();
    expect(() => nullAdapter.gameplayStart()).not.toThrow();
    expect(() => nullAdapter.gameplayStop()).not.toThrow();
    expect(() => nullAdapter.happyTime()).not.toThrow();
    await expect(nullAdapter.requestMidgameAd()).resolves.toBeUndefined();
    await expect(nullAdapter.requestRewardedAd()).resolves.toBe(false);
    expect(nullAdapter.canShowRewardedAd()).toBe(false);
  });
});

describe("resolvePortalName", () => {
  test("defaults to none", () => {
    expect(resolvePortalName(null, undefined)).toBe("none");
    expect(resolvePortalName(null, "")).toBe("none");
  });
  test("reads the build-time env", () => {
    expect(resolvePortalName(null, "crazygames")).toBe("crazygames");
  });
  test("the query param wins over the env", () => {
    expect(resolvePortalName("crazygames", undefined)).toBe("crazygames");
    expect(resolvePortalName("none", "crazygames")).toBe("none");
  });
  test("unknown names fall back to none", () => {
    expect(resolvePortalName("kongregate", "crazygames")).toBe("none");
    expect(resolvePortalName(null, "kongregate")).toBe("none");
  });
});

describe("selectPortal / getPortal", () => {
  afterEach(() => _resetPortalForTests());

  test("none is the shared null adapter", () => {
    expect(selectPortal("none")).toBe(nullAdapter);
  });
  test("crazygames is a lazy adapter that never touches the SDK before init", () => {
    const p = selectPortal("crazygames");
    expect(p.name).toBe("crazygames");
    // safe to call before init: the SDK chunk hasn't been loaded yet
    expect(() => p.gameplayStart()).not.toThrow();
    expect(p.canShowRewardedAd()).toBe(false);
  });
  test("getPortal is memoised and defaults to the null adapter", () => {
    expect(getPortal()).toBe(nullAdapter);
    expect(getPortal()).toBe(getPortal());
  });
});

describe("isEmbedded", () => {
  test("false at top level", () => {
    expect(isEmbedded()).toBe(false);
  });
  test("true when top differs from self, and when reading top throws (cross-origin)", () => {
    const desc = Object.getOwnPropertyDescriptor(window, "top");
    Object.defineProperty(window, "top", { configurable: true, get: () => ({}) });
    expect(isEmbedded()).toBe(true);
    Object.defineProperty(window, "top", {
      configurable: true,
      get: () => {
        throw new DOMException("Blocked a frame", "SecurityError");
      },
    });
    expect(isEmbedded()).toBe(true);
    if (desc) Object.defineProperty(window, "top", desc);
  });
});
