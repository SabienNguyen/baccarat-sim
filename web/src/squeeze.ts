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
  /** CSS clip-path polygon for the revealed region, in % of the card. */
  clip: string;
  /** The folded-over flap itself: the revealed region mirrored across the
   *  crease, so its tip sits exactly under the pulling finger. */
  flapClip: string;
  /** The crease point, as a CSS transform-origin — the flap's 3D hinge. */
  origin: string;
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

interface Point {
  x: number;
  y: number;
}

/** Sutherland–Hodgman: clip a polygon to the half-plane ax·x + ay·y ≤ c. */
function clipHalf(poly: Point[], ax: number, ay: number, c: number): Point[] {
  const out: Point[] = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const da = ax * a.x + ay * a.y - c;
    const db = ax * b.x + ay * b.y - c;
    if (da <= 0) out.push(a);
    if (da < 0 !== db < 0) {
      const t = da / (da - db);
      out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
    }
  }
  return out;
}

/** Tangent sample points along the bend's parabola, as fractions of its
 *  half-width. The half-planes they define approximate the curved opening. */
const BEND_TANGENTS = [-0.9, -0.6, -0.3, 0, 0.3, 0.6, 0.9];

/**
 * The fold for a pinch at (gx, gy) dragged to (fx, fy), like real card
 * stock: the crease sits at the midpoint of grab→finger, and the opening
 * is a bend — widest at the fingers, curving closed toward the card's
 * corners. Edge pips read first; the corner index stays covered until the
 * pull goes deep. The curve is a parabola (apex on the crease), built by
 * clipping the card to its tangent half-planes.
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
  const ccx = w / 2 - g.x;
  const ccy = h / 2 - g.y;
  if (nx * ccx + ny * ccy <= 0 && Math.hypot(ccx, ccy) > 1) return null;

  // local frame at the grab: v runs along the drag, u along the crease
  const nux = nx / len;
  const nuy = ny / len;
  const ux = -nuy;
  const uy = nux;
  const apex = len / 2; // the crease depth: half the finger travel
  const half = Math.max(len * 0.9, 20); // the opening's half-width

  let flap: Point[] = [
    { x: 0, y: 0 },
    { x: w, y: 0 },
    { x: w, y: h },
    { x: 0, y: h },
  ];
  for (const t of BEND_TANGENTS) {
    // parabola v(u) = apex·(1 − (u/half)²), tangent at u₀ = t·half
    const u0 = t * half;
    const v0 = apex * (1 - t * t);
    const slope = (-2 * apex * t) / half;
    // v − v₀ ≤ slope·(u − u₀), rewritten over screen points
    const ax = nux - slope * ux;
    const ay = nuy - slope * uy;
    const c = ax * g.x + ay * g.y + (v0 - slope * u0);
    flap = clipHalf(flap, ax, ay, c);
    if (flap.length < 3) return null;
  }

  // the folded-over flap: reflect the opening across the crease, a rigid
  // motion that puts the grabbed edge exactly under the fingertip
  const mirrored = flap.map((p) => {
    const v = (p.x - g.x) * nux + (p.y - g.y) * nuy;
    const d = 2 * (apex - v);
    return { x: p.x + d * nux, y: p.y + d * nuy };
  });

  const pct = (v: number, total: number) => `${((v / total) * 100).toFixed(1)}%`;
  const poly = (pts: Point[]) =>
    `polygon(${pts.map((p) => `${pct(p.x, w)} ${pct(p.y, h)}`).join(", ")})`;
  return {
    clip: poly(flap),
    flapClip: poly(mirrored),
    origin: `${pct(g.x + apex * nux, w)} ${pct(g.y + apex * nuy, h)}`,
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
