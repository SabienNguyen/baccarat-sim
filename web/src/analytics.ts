// Privacy-friendly analytics, wired but DISABLED until a backend exists.
//
// To turn it on later (GoatCounter is the recommended fit — see docs/GROWTH.md
// G4): add its script to index.html
//   <script data-goatcounter="https://<you>.goatcounter.com/count"
//           async src="//gc.zgo.at/count.js"></script>
// and, for the Fly-served copy, add gc.zgo.at to the CSP script-src/connect-src
// in server/src/main.rs. Until `window.goatcounter` exists, every call here is
// a safe no-op, so these hooks can live in the code with zero runtime cost or
// third-party requests.

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
