export type SqueezeAction = "none" | "peek" | "reveal";

/** Drag progress (0..1) at which only the suit sliver shows. */
export const PEEK_AT = 0.25;
/** Drag progress (0..1) at which the card flips fully face-up. */
export const REVEAL_AT = 0.7;

/** Map a drag progress (0..1) to the action that should fire at that progress. */
export function actionForProgress(progress: number): SqueezeAction {
  if (progress >= REVEAL_AT) return "reveal";
  if (progress >= PEEK_AT) return "peek";
  return "none";
}

/** A live fold: where the card stock has bent back, and how far. */
export interface Fold {
  /** CSS clip-path polygon for the folded-back region, in % of the card. */
  clip: string;
  /** CSS gradient angle (deg) running from the flap edge toward the crease. */
  angle: number;
  /** 0..1 — drives the peek/reveal thresholds. */
  progress: number;
}

interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * The fold for a pinch at (gx, gy) dragged to (fx, fy), like real card
 * stock: the crease is the perpendicular bisector of grab→finger, and the
 * flap is whatever part of the card got left on the grab's side of it. No
 * zones, no corners — the bend happens exactly where the fingers are.
 *
 * Null when there is nothing to fold: no travel, a degenerate rect, or a
 * pull away from the card (that lifts the card, it doesn't bend it).
 */
export function foldFrom(gx: number, gy: number, fx: number, fy: number, rect: Rect): Fold | null {
  const { width: w, height: h } = rect;
  if (w === 0 || h === 0) return null;
  const g = { x: gx - rect.left, y: gy - rect.top };
  const nx = fx - rect.left - g.x;
  const ny = fy - rect.top - g.y;
  const len = Math.hypot(nx, ny);
  if (len < 1) return null;
  // folding means pulling toward the card, not off it
  const cx = w / 2 - g.x;
  const cy = h / 2 - g.y;
  if (nx * cx + ny * cy <= 0 && Math.hypot(cx, cy) > 1) return null;

  // the crease: every card point still closer to the grab than the finger
  // is flap. Clip the card rectangle to that half-plane.
  const c = nx * ((g.x + g.x + nx) / 2) + ny * ((g.y + g.y + ny) / 2);
  const side = (x: number, y: number) => nx * x + ny * y - c;
  const corners = [
    { x: 0, y: 0 },
    { x: w, y: 0 },
    { x: w, y: h },
    { x: 0, y: h },
  ];
  const flap: Array<{ x: number; y: number }> = [];
  for (let i = 0; i < corners.length; i++) {
    const a = corners[i];
    const b = corners[(i + 1) % corners.length];
    const da = side(a.x, a.y);
    const db = side(b.x, b.y);
    if (da <= 0) flap.push(a);
    if (da < 0 !== db < 0) {
      const t = da / (da - db);
      flap.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
    }
  }
  if (flap.length < 3) return null;

  const pct = (v: number, total: number) => `${((v / total) * 100).toFixed(1)}%`;
  return {
    clip: `polygon(${flap.map((p) => `${pct(p.x, w)} ${pct(p.y, h)}`).join(", ")})`,
    // CSS gradient angles: 0deg points up, clockwise from there
    angle: (Math.atan2(nx, -ny) * 180) / Math.PI,
    progress: Math.min(len / (Math.hypot(w, h) * 0.85), 1),
  };
}

/** The bend a peeked card holds at rest: a thumb's pull up from the bottom.
 *  Computed from a vertical drag, so the % clip fits any card size. */
export const HELD_FOLD: Fold = foldFrom(45, 123, 45, 56, {
  left: 0,
  top: 0,
  width: 90,
  height: 126,
})!;
