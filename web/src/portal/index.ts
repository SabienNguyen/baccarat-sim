// Which portal (if any) the game is running on, and the adapter for it.
//
// Selection: `?portal=crazygames` in the URL wins, then the build-time
// VITE_PORTAL (set by `npm run build:portal`), else no portal at all. The
// portal-specific adapter is reached through a dynamic import, so the default
// bundle never carries (or loads) any portal SDK code.
import { nullAdapter } from "./nullAdapter";
import type { PortalAdapter } from "./types";
import { urlParam } from "../urlParams";

export type { PortalAdapter } from "./types";
export { nullAdapter } from "./nullAdapter";

export type PortalName = "none" | "crazygames";

function isPortalName(value: string | null | undefined): value is PortalName {
  return value === "none" || value === "crazygames";
}

/** Pure selection rule: the query param beats the env; anything unknown is "none". */
export function resolvePortalName(
  query: string | null,
  env: string | undefined,
): PortalName {
  if (query !== null) return isPortalName(query) ? query : "none";
  return isPortalName(env) ? env : "none";
}

/**
 * A stand-in that loads the real adapter on `init()` and forwards to it once
 * it's there. Before that (or if the chunk never arrives) it behaves like the
 * null adapter, so the game can call it at any time.
 */
function lazyAdapter(name: PortalName, load: () => Promise<PortalAdapter>): PortalAdapter {
  let inner: PortalAdapter | null = null;
  let loading: Promise<void> | null = null;
  const ready = () =>
    (loading ??= load()
      .then(async (adapter) => {
        await adapter.init();
        inner = adapter;
      })
      .catch((error: unknown) => {
        console.warn(`[portal:${name}] adapter failed to load — continuing without it.`, error);
      }));
  return {
    name,
    init: ready,
    gameplayStart: () => inner?.gameplayStart(),
    gameplayStop: () => inner?.gameplayStop(),
    happyTime: () => inner?.happyTime(),
    requestMidgameAd: () => ready().then(() => inner?.requestMidgameAd()),
    requestRewardedAd: () => ready().then(() => inner?.requestRewardedAd() ?? false),
    canShowRewardedAd: () => inner?.canShowRewardedAd() ?? false,
  };
}

export function selectPortal(name: PortalName): PortalAdapter {
  switch (name) {
    case "crazygames":
      return lazyAdapter("crazygames", () =>
        import("./crazygames").then((m) => m.createCrazyGamesAdapter()),
      );
    default:
      return nullAdapter;
  }
}

let current: PortalAdapter | null = null;

/** The portal adapter for this page load (memoised). */
export function getPortal(): PortalAdapter {
  current ??= selectPortal(
    resolvePortalName(urlParam("portal"), import.meta.env.VITE_PORTAL as string | undefined),
  );
  return current;
}

/** Tests only: forget the memoised adapter. */
export function _resetPortalForTests(): void {
  current = null;
}

/** True inside any iframe. A cross-origin parent makes `top` throw — that is an iframe too. */
export function isEmbedded(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.self !== window.top;
  } catch {
    return true;
  }
}
