// The GL squeeze's physics layer: the geometry is analytic (curlMath),
// the *feel* comes from springs in parameter space — the rendered fold
// chases the finger with weight, and released stock flutters flat.

export interface SpringState {
  x: number;
  v: number;
}

/** One exact step of a critically damped spring toward `target`.
 *  Closed-form (not Euler), so it is stable at any dt. omega: 1/s. */
export function springStep(s: SpringState, target: number, omega: number, dtMs: number): SpringState {
  const dt = dtMs / 1000;
  const dx = s.x - target;
  const tmp = (s.v + omega * dx) * dt;
  const decay = Math.exp(-omega * dt);
  return { x: target + (dx + tmp) * decay, v: (s.v - omega * tmp) * decay };
}

/** Released card stock springs flat with one soft re-bend: a damped
 *  oscillation envelope on the curl depth. 1 = fold fully held, 0 = flat.
 *  Same constants the CSS spring-back used, so the feel carries over. */
export const FLUTTER_TAU = 140; // ms
export const FLUTTER_OMEGA = 0.013; // rad/ms
export function flutterScale(tMs: number): number {
  const s = Math.exp(-tMs / FLUTTER_TAU) * Math.abs(Math.cos(FLUTTER_OMEGA * tMs));
  return s < 0.02 ? 0 : s;
}
