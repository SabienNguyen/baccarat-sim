import type { PortalAdapter } from "./types";

/** No portal: every call is a no-op and no ad is ever on offer. */
export const nullAdapter: PortalAdapter = {
  name: "none",
  init: () => Promise.resolve(),
  gameplayStart: () => {},
  gameplayStop: () => {},
  happyTime: () => {},
  requestMidgameAd: () => Promise.resolve(),
  requestRewardedAd: () => Promise.resolve(false),
  canShowRewardedAd: () => false,
};
