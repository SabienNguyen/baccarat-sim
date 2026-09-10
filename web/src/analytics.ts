// Privacy-friendly analytics via GoatCounter, ENABLED since 2026-09-10.
//
// Site code: `baccarat-sim` (https://baccarat-sim.goatcounter.com). The script
// tag lives in index.html and the Fly-served copy allows gc.zgo.at /
// baccarat-sim.goatcounter.com in the CSP (server/src/main.rs). The pageview is
// GoatCounter's own onload count; the helpers here only add named events.
// Whenever `window.goatcounter` is absent (tests, blocked script, a local dev
// build) every call is a safe no-op, so the hooks cost nothing and never throw.

type Goatcounter = {
  count: (opts: { path: string; title?: string; event?: boolean }) => void;
};

function backend(): Goatcounter | undefined {
  if (typeof window === "undefined") return undefined;
  return (window as unknown as { goatcounter?: Goatcounter }).goatcounter;
}

/** Report a named event. No-ops (and never throws) when analytics is off. */
export function track(event: string): void {
  try {
    backend()?.count({ path: `event/${event}`, event: true });
  } catch {
    /* analytics must never break the game */
  }
}

/** Call once on load: distinguishes new vs. returning visitors. */
export function trackVisit(): void {
  let returning = false;
  try {
    returning = localStorage.getItem("baccarat.seen") === "1";
    localStorage.setItem("baccarat.seen", "1");
  } catch {
    /* private mode / no storage — treat as new */
  }
  track(returning ? "returning-visit" : "first-visit");
}

let firstHandTracked = false;

/** Fires `first-hand` once per page load: the first coup dealt, solo or live. */
export function trackFirstHand(): void {
  if (firstHandTracked) return;
  firstHandTracked = true;
  track("first-hand");
}

/** Test hook: forget that a hand was dealt. */
export function resetAnalyticsForTests(): void {
  firstHandTracked = false;
}
