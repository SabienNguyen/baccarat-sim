/** P14: how long the settled table lingers before auto-advancing to the next
 *  hand. Desktop keeps the original pace (3000ms — see App.tsx's own
 *  AUTO_ADVANCE_MS comment); a coarse pointer (phone/tablet) gets two more
 *  seconds, since a thumb is often still mid-gesture — finishing a squeeze,
 *  scrolling to read a payout — when the shorter timer would otherwise sweep
 *  the felt out from under it. Reads `(pointer: coarse)` once per call rather
 *  than caching, so it stays correct across the rare case of a hybrid device
 *  switching input mode; call sites only need it once per settle anyway. */
export function autoAdvanceMs(base = 3000): number {
  const coarse =
    typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches;
  return coarse ? base + 2000 : base;
}

/** True when a touch landed within the last second — the auto-advance timer
 *  should wait for the gesture to finish (or the grace period to lapse)
 *  rather than sweep the felt out from under an active thumb. `now` is
 *  injected so this stays a pure, easily-tested function. */
export function isRecentlyTouched(
  lastPointerDownAt: number | null,
  now: number,
  graceMs = 1000,
): boolean {
  return lastPointerDownAt !== null && now - lastPointerDownAt < graceMs;
}
