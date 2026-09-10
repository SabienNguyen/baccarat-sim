import { createCrazyGamesAdapter, loadCrazyGamesSdk, type CrazyGamesSdk } from "./crazygames";

type AdCallbacks = { adStarted?: () => void; adFinished?: () => void; adError?: (e: unknown) => void };

function fakeSdk(over: Partial<{ adOutcome: "finished" | "error" }> = {}) {
  const calls: string[] = [];
  const requested: string[] = [];
  const init = vi.fn(async () => {
    calls.push("init");
  });
  const sdk: CrazyGamesSdk = {
    init,
    game: {
      gameplayStart: () => void calls.push("gameplayStart"),
      gameplayStop: () => void calls.push("gameplayStop"),
      happytime: () => void calls.push("happytime"),
    },
    ad: {
      requestAd: (type, cb: AdCallbacks) => {
        requested.push(type);
        cb.adStarted?.();
        if (over.adOutcome === "error") cb.adError?.(new Error("no fill"));
        else cb.adFinished?.();
      },
    },
  };
  return { sdk, init, calls, requested };
}

test("init loads the SDK, calls SDK.init, and then delegates every call", async () => {
  const { sdk, calls, requested } = fakeSdk();
  const warn = vi.fn();
  const adapter = createCrazyGamesAdapter({ loadSdk: async () => sdk, warn });
  expect(adapter.name).toBe("crazygames");
  expect(adapter.canShowRewardedAd()).toBe(false); // not until init resolves
  await adapter.init();
  expect(calls).toEqual(["init"]);
  adapter.gameplayStart();
  adapter.happyTime();
  adapter.gameplayStop();
  expect(calls).toEqual(["init", "gameplayStart", "happytime", "gameplayStop"]);
  expect(adapter.canShowRewardedAd()).toBe(true);
  await expect(adapter.requestMidgameAd()).resolves.toBeUndefined();
  await expect(adapter.requestRewardedAd()).resolves.toBe(true);
  expect(requested).toEqual(["midgame", "rewarded"]);
  expect(warn).not.toHaveBeenCalled();
});

test("an ad error resolves (midgame) / resolves false (rewarded) rather than rejecting", async () => {
  const { sdk } = fakeSdk({ adOutcome: "error" });
  const adapter = createCrazyGamesAdapter({ loadSdk: async () => sdk, warn: vi.fn() });
  await adapter.init();
  await expect(adapter.requestMidgameAd()).resolves.toBeUndefined();
  await expect(adapter.requestRewardedAd()).resolves.toBe(false);
});

test("a missing or failing SDK degrades to the null behaviour and warns once", async () => {
  const warn = vi.fn();
  const adapter = createCrazyGamesAdapter({
    loadSdk: async () => {
      throw new Error("blocked");
    },
    warn,
  });
  await expect(adapter.init()).resolves.toBeUndefined();
  expect(() => adapter.gameplayStart()).not.toThrow();
  adapter.gameplayStop();
  adapter.happyTime();
  expect(adapter.canShowRewardedAd()).toBe(false);
  await expect(adapter.requestMidgameAd()).resolves.toBeUndefined();
  await expect(adapter.requestRewardedAd()).resolves.toBe(false);
  expect(warn).toHaveBeenCalledOnce();
});

test("an SDK whose own init rejects is treated as missing", async () => {
  const { sdk, init, calls } = fakeSdk();
  init.mockImplementation(async () => {
    throw new Error("init failed");
  });
  const warn = vi.fn();
  const adapter = createCrazyGamesAdapter({ loadSdk: async () => sdk, warn });
  await adapter.init();
  adapter.gameplayStart();
  expect(calls).toEqual([]);
  expect(adapter.canShowRewardedAd()).toBe(false);
  expect(warn).toHaveBeenCalledOnce();
});

test("calls made before init resolves are dropped, not queued or thrown", async () => {
  const { sdk, calls } = fakeSdk();
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  const adapter = createCrazyGamesAdapter({
    loadSdk: async () => {
      await gate;
      return sdk;
    },
    warn: vi.fn(),
  });
  const pending = adapter.init();
  adapter.gameplayStart();
  await expect(adapter.requestRewardedAd()).resolves.toBe(false);
  release();
  await pending;
  expect(calls).toEqual(["init"]);
});

test("a thrown SDK method is swallowed: the game never sees portal errors", async () => {
  const { sdk } = fakeSdk();
  sdk.game.gameplayStart = () => {
    throw new Error("sdk bug");
  };
  const adapter = createCrazyGamesAdapter({ loadSdk: async () => sdk, warn: vi.fn() });
  await adapter.init();
  expect(() => adapter.gameplayStart()).not.toThrow();
});

const SDK_TAG = "script[src*='sdk.crazygames.com']";

test("the script loader injects the v3 SDK tag and resolves on load", async () => {
  const fake = { init: async () => {}, game: {}, ad: {} };
  const p = loadCrazyGamesSdk(document, 1000);
  const tag = document.querySelector<HTMLScriptElement>(SDK_TAG);
  expect(tag).not.toBeNull();
  expect(tag!.src).toBe("https://sdk.crazygames.com/crazygames-sdk-v3.js");
  (window as unknown as { CrazyGames: unknown }).CrazyGames = { SDK: fake };
  tag!.dispatchEvent(new Event("load"));
  await expect(p).resolves.toBe(fake);
  delete (window as unknown as { CrazyGames?: unknown }).CrazyGames;
  tag!.remove();
});

test("the script loader rejects on error and on timeout", async () => {
  vi.useFakeTimers();
  try {
    const p1 = loadCrazyGamesSdk(document, 1000);
    const tag = document.querySelector<HTMLScriptElement>(SDK_TAG)!;
    tag.dispatchEvent(new Event("error"));
    await expect(p1).rejects.toThrow();
    tag.remove();
    const p2 = loadCrazyGamesSdk(document, 1000);
    vi.advanceTimersByTime(1001);
    await expect(p2).rejects.toThrow(/timed out/);
    document.querySelector(SDK_TAG)?.remove();
  } finally {
    vi.useRealTimers();
  }
});
