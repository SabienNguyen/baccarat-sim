import { gripFrom } from "../squeeze";
import { curlFromGrip, deform, poseFrom, flipSpecFrom, flipAt, FLIP_MS, type CurlParams } from "./curlMath";

const RECT = { left: 0, top: 0, width: 90, height: 126 };
// bottom-edge pull: grab (45,124) → finger (45,60); bend 64, apex 32
const grip = gripFrom(45, 124, 45, 60, RECT)!;
const base = curlFromGrip(grip, 90, 126);
const flatTipped: CurlParams = { ...base, theta: 0 };

test("curl params inherit the grip frame", () => {
  expect(base.apex).toBeCloseTo(32);
  expect(base.radius).toBeGreaterThan(4);
  expect(base.theta).toBeGreaterThan(0);
});

test("material deeper than the contact line stays flat on the felt", () => {
  const p = deform(base, 45, 20); // v = 104, far past the fold
  expect(p.x).toBeCloseTo(45);
  expect(p.y).toBeCloseTo(20);
  expect(p.z).toBe(0);
});

test("the grabbed edge lands exactly under the finger (theta=0)", () => {
  const tip = deform(flatTipped, 45, 124); // the grab point itself
  // mirrored over the roll: travels bend=64 along the drag (up)
  expect(tip.y).toBeCloseTo(124 - 64, 5);
  expect(tip.x).toBeCloseTo(45, 5);
  expect(tip.z).toBeCloseTo(2 * base.radius, 5); // resting on top of the roll
});

test("the two roll regions meet continuously", () => {
  // find the v where s = πr and sample both sides
  const r = base.radius;
  const vt = base.apex + Math.PI * r * 0.5;
  const vAtBoundary = vt - Math.PI * r;
  const eps = 0.01;
  const a = deform(flatTipped, 45, 124 - (vAtBoundary - eps));
  const b = deform(flatTipped, 45, 124 - (vAtBoundary + eps));
  expect(Math.abs(a.y - b.y)).toBeLessThan(0.1);
  expect(Math.abs(a.z - b.z)).toBeLessThan(0.1);
});

test("the card never sinks through the table", () => {
  for (let x = 0; x <= 90; x += 9) {
    for (let y = 0; y <= 126; y += 9) {
      expect(deform(base, x, y).z).toBeGreaterThanOrEqual(-1e-9);
    }
  }
});

test("a pinch folds rigidly — no shear along the crease", () => {
  // card stock is inextensible: two points the same depth into the fold
  // must displace identically, wherever they sit along the crease.
  // Anything else stretches the artwork and bends the card's edges.
  const pinch = curlFromGrip(gripFrom(45, 123, 70, 83, RECT)!, 90, 126);
  const v0 = 5; // both points sit in the lifted flap
  const at = (u: number) => {
    const x = 45 + u * pinch.ux + v0 * pinch.nx;
    const y = 123 + u * pinch.uy + v0 * pinch.ny;
    const d = deform(pinch, x, y);
    return { dx: d.x - x, dy: d.y - y, z: d.z };
  };
  const a = at(0);
  const b = at(-20);
  expect(b.dx).toBeCloseTo(a.dx, 5);
  expect(b.dy).toBeCloseTo(a.dy, 5);
  expect(b.z).toBeCloseTo(a.z, 5);
});

test("an edge grip deforms uniformly across the card", () => {
  const a = deform(base, 10, 124);
  const b = deform(base, 80, 124);
  expect(a.z).toBeCloseTo(b.z, 5);
  expect(a.y).toBeCloseTo(b.y, 5);
});

test("poseFrom ports the CSS body tip", () => {
  const pose = poseFrom(grip, 90, 126);
  expect(pose.tipRad).toBeCloseTo((16 * grip.progress * Math.PI) / 180);
  expect(pose.scale).toBeCloseTo(1 + 0.02 * grip.progress);
  expect(pose.slide).toEqual([0, 0]);
  // straight up pull (angle 0): hinge pivot is the top edge midpoint
  expect(pose.tipPivot[0]).toBeCloseTo(45);
  expect(pose.tipPivot[1]).toBeCloseTo(0);
});

// --- the flip: the peel completing — fold sweeps the card, then it slides home ---

const spec = flipSpecFrom(base, 90, 126);

test("the flip starts exactly where the release curl left off", () => {
  const f = flipAt(0, spec);
  expect(f.apex).toBeCloseTo(base.apex);
  expect(f.radius).toBeCloseTo(base.radius);
  expect(f.theta).toBeCloseTo(base.theta);
  expect(f.slideX).toBeCloseTo(0);
  expect(f.slideY).toBeCloseTo(0);
  expect(f.done).toBe(false);
});

test("the sweep consumes the whole card before the slide begins", () => {
  // by the end of the sweep every card point must be past the roll
  const f = flipAt(FLIP_MS * 0.62, spec);
  const end = { ...base, apex: f.apex, radius: f.radius, theta: 0 };
  for (let y = 0; y <= 126; y += 14) {
    const d = deform(end, 45, y);
    expect(d.z).toBeGreaterThan(0); // nothing left flat on the felt
    expect(d.z).toBeLessThanOrEqual(2 * f.radius + 1e-6); // all folded over, none mid-roll
  }
});

test("the flip lands the card face-up exactly in its slot", () => {
  const f = flipAt(FLIP_MS, spec);
  expect(f.done).toBe(true);
  expect(f.theta).toBe(0);
  const end = { ...base, apex: f.apex, radius: f.radius, theta: 0 };
  // the mirrored card plus the slide returns every point to its column:
  // the center must land back on the center (the slide cancels the mirror)
  const c = deform(end, 45, 63);
  expect(c.x + f.slideX).toBeCloseTo(45, 0);
  expect(c.y + f.slideY).toBeCloseTo(63, 0);
  expect(c.z).toBeLessThan(4); // flat on the felt, bar the residual roll
});

test("the fold sweep is monotonic", () => {
  let prev = -1;
  for (let t = 0; t <= FLIP_MS; t += 20) {
    const a = flipAt(t, spec).apex;
    expect(a).toBeGreaterThanOrEqual(prev);
    prev = a;
  }
});
