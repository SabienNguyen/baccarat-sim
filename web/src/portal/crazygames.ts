// CrazyGames SDK v3 adapter. This module is only ever reached through a
// dynamic import from ./index.ts, so the default (non-portal) bundle never
// contains the SDK URL and never loads it.
//
// Docs: https://docs.crazygames.com/sdk/html5-v3/ — the surface used here:
//   window.CrazyGames.SDK.init()
//   window.CrazyGames.SDK.game.gameplayStart() / gameplayStop() / happytime()
//   window.CrazyGames.SDK.ad.requestAd("midgame" | "rewarded", callbacks)
import type { PortalAdapter } from "./types";

export const SDK_URL = "https://sdk.crazygames.com/crazygames-sdk-v3.js";
const LOAD_TIMEOUT_MS = 10_000;

export type CrazyGamesAdType = "midgame" | "rewarded";
export interface CrazyGamesAdCallbacks {
  adStarted?: () => void;
  adFinished?: () => void;
  adError?: (error: unknown) => void;
}

/** The slice of the v3 SDK this adapter touches, typed by hand (no dependency). */
export interface CrazyGamesSdk {
  init: () => Promise<void>;
  game: {
    gameplayStart?: () => void;
    gameplayStop?: () => void;
    happytime?: () => void;
  };
  ad: {
    requestAd?: (type: CrazyGamesAdType, callbacks: CrazyGamesAdCallbacks) => void;
  };
}

type SdkWindow = Window & { CrazyGames?: { SDK?: CrazyGamesSdk } };

/**
 * Inject the SDK script tag and resolve with `window.CrazyGames.SDK` once it
 * has loaded; reject on a load error or after `timeoutMs`.
 */
export function loadCrazyGamesSdk(
  doc: Document = document,
  timeoutMs = LOAD_TIMEOUT_MS,
): Promise<CrazyGamesSdk> {
  return new Promise((resolve, reject) => {
    const existing = (doc.defaultView as SdkWindow | null)?.CrazyGames?.SDK;
    if (existing) {
      resolve(existing);
      return;
    }
    const tag = doc.createElement("script");
    tag.src = SDK_URL;
    tag.async = true;
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`CrazyGames SDK timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    const cleanup = () => {
      clearTimeout(timer);
      tag.removeEventListener("load", onLoad);
      tag.removeEventListener("error", onError);
    };
    const onLoad = () => {
      cleanup();
      const sdk = (doc.defaultView as SdkWindow | null)?.CrazyGames?.SDK;
      if (sdk) resolve(sdk);
      else reject(new Error("CrazyGames SDK script loaded but window.CrazyGames.SDK is missing"));
    };
    const onError = () => {
      cleanup();
      reject(new Error("CrazyGames SDK script failed to load"));
    };
    tag.addEventListener("load", onLoad);
    tag.addEventListener("error", onError);
    (doc.head ?? doc.documentElement).appendChild(tag);
  });
}

interface Deps {
  loadSdk?: () => Promise<CrazyGamesSdk>;
  warn?: (message: string, error?: unknown) => void;
}

/**
 * Build the adapter. Until `init()` has resolved with a working SDK every
 * method behaves like the null adapter; if the SDK is missing or errors, that
 * stays the case for good and a single console.warn says so.
 */
export function createCrazyGamesAdapter({
  loadSdk = () => loadCrazyGamesSdk(),
  warn = (message, error) => console.warn(message, error),
}: Deps = {}): PortalAdapter {
  let sdk: CrazyGamesSdk | null = null;
  let warned = false;
  let initPromise: Promise<void> | null = null;

  const degrade = (message: string, error?: unknown) => {
    sdk = null;
    if (!warned) {
      warned = true;
      warn(`[portal:crazygames] ${message} — continuing without the portal SDK.`, error);
    }
  };

  /** Call one SDK method, swallowing anything it throws. */
  const call = (fn: (s: CrazyGamesSdk) => void) => {
    if (!sdk) return;
    try {
      fn(sdk);
    } catch (error) {
      degrade("the SDK threw", error);
    }
  };

  const requestAd = (type: CrazyGamesAdType): Promise<boolean> =>
    new Promise((resolve) => {
      const request = sdk?.ad.requestAd;
      if (!sdk || !request) {
        resolve(false);
        return;
      }
      try {
        request.call(sdk.ad, type, {
          adFinished: () => resolve(true),
          adError: () => resolve(false),
        });
      } catch (error) {
        degrade("requestAd threw", error);
        resolve(false);
      }
    });

  return {
    name: "crazygames",
    init: () => {
      initPromise ??= (async () => {
        try {
          const loaded = await loadSdk();
          await loaded.init();
          sdk = loaded;
        } catch (error) {
          degrade("the SDK failed to load or initialise", error);
        }
      })();
      return initPromise;
    },
    gameplayStart: () => call((s) => s.game.gameplayStart?.()),
    gameplayStop: () => call((s) => s.game.gameplayStop?.()),
    happyTime: () => call((s) => s.game.happytime?.()),
    requestMidgameAd: () => requestAd("midgame").then(() => undefined),
    requestRewardedAd: () => requestAd("rewarded"),
    canShowRewardedAd: () => sdk !== null && typeof sdk.ad.requestAd === "function",
  };
}
