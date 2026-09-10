import { pauseAudio } from "../audio/sfx";
import { nullAdapter } from "./nullAdapter";
import type { PortalAdapter } from "./types";

/**
 * A midgame ad break: quiet the table for the ad, request it, and bring the
 * sound back whatever happened. Without a portal nothing is touched at all.
 */
export async function adBreak(
  portal: PortalAdapter,
  pause: () => () => void = pauseAudio,
): Promise<void> {
  if (portal === nullAdapter) return;
  const resume = pause();
  try {
    await portal.requestMidgameAd();
  } catch {
    /* an ad failure is the portal's problem, never the game's */
  } finally {
    resume();
  }
}
