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
  /** The lifted tongue of stock: a leaf grown from the crease arc (where
   *  it stays attached to the card) narrowing to a rounded tip that lands
   *  exactly under the pulling finger. */
  flapClip: string;
  /** The crease point, as a CSS transform-origin — the flap's 3D hinge. */
  origin: string;
  /** Layout offsets that place the face artwork on the flap. Rotating the
   *  180°-symmetric face about the crease equals translating it by twice
   *  the crease's offset from center — pure left/top, NO transform, so no
   *  compositor layer can ever escape the flap's clip. */
  faceShift: { left: string; top: string };
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
  // The stock only bends so far: past this the hand would be lifting the
  // whole card, and the deepest folds poke rendering edge cases. The fold
  // freezes at the cap — direction still tracks, depth stops growing.
  const reach = Math.hypot(w, h) * 0.85;
  const bend = Math.min(len, reach * 0.8);
  const apex = bend / 2; // the crease depth: half the finger travel
  // narrow enough that a medium pull keeps the corner indices covered —
  // the pips must read before the rank gives itself away
  const half = Math.max(bend * 0.7, 18);

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

  // The folded tongue. A rigid mirror of the opening reads as an hourglass
  // (the mirrored parabola pinches at the crease), so build the leaf the
  // material actually makes: based on the crease arc — where the stock is
  // still attached — tapering to a rounded tip at the fingertip (2·apex,
  // the fold's invariant: the grabbed edge lands under the finger).
  const pt = (u: number, v: number): Point => ({
    x: g.x + u * ux + v * nux,
    y: g.y + u * uy + v * nuy,
  });
  // as wide as the opening: the flap IS the material that left the hole
  const A = half;
  const leaf: Point[] = [];
  for (const t of BEND_TANGENTS) {
    const u = t * A;
    leaf.push(pt(u, apex * (1 - (u / half) ** 2))); // along the crease arc
  }
  for (const t of BEND_TANGENTS) {
    const u = -t * A; // walk back along the tip curve
    // quartic: a broad flat end with rounded shoulders — the card's own
    // straight edge folded over, not a tent peak
    leaf.push(pt(u, 2 * apex * (1 - (u / A) ** 4)));
  }

  const pct = (v: number, total: number) => `${((v / total) * 100).toFixed(1)}%`;
  const poly = (pts: Point[]) =>
    `polygon(${pts.map((p) => `${pct(p.x, w)} ${pct(p.y, h)}`).join(", ")})`;
  const cx = g.x + apex * nux;
  const cy = g.y + apex * nuy;
  return {
    clip: poly(flap),
    flapClip: poly(leaf),
    origin: `${pct(cx, w)} ${pct(cy, h)}`,
    faceShift: {
      left: `${(((2 * cx) / w - 1) * 100).toFixed(1)}%`,
      top: `${(((2 * cy) / h - 1) * 100).toFixed(1)}%`,
    },
    // CSS gradient angles: 0deg points up, clockwise from there
    angle: (Math.atan2(nx, -ny) * 180) / Math.PI,
    progress: Math.min(bend / reach, 1),
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
