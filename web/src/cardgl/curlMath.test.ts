import { gripFrom } from "../squeeze";
import { curlFromGrip, deform, poseFrom, flipFrame, EDGE_HALF, FLIP_MS, type CurlParams } from "./curlMath";

const RECT = { left: 0, top: 0, width: 90, height: 126 };
// bottom-edge pull: grab (45,124) → finger (45,60); bend 64, apex 32
const grip = gripFrom(45, 124, 45, 60, RECT)!;
const base = curlFromGrip(grip, 90, 126);
const flatTipped: CurlParams = { ...base, theta: 0 };

test("curl params inherit the grip frame; edge grips flatten the falloff", () => {
  expect(base.apex).toBeCloseTo(32);
  expect(base.half).toBe(EDGE_HALF); // straight bottom-edge pull = cylinder
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

test("a pinch dies out past the parabola's rim", () => {
  const pinch = curlFromGrip(gripFrom(85, 120, 30, 60, RECT)!, 90, 126);
  expect(pinch.half).toBeLessThan(EDGE_HALF);
  // walk along the crease direction well past half: undeformed
  const far = deform(pinch, 85 + pinch.ux * (pinch.half + 30), 120 + pinch.uy * (pinch.half + 30));
  expect(far.z).toBe(0);
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
  expect(pose.flipRad).toBe(0);
  expect(pose.lift).toBe(0);
  // straight up pull (angle 0): hinge pivot is the top edge midpoint
  expect(pose.tipPivot[0]).toBeCloseTo(45);
  expect(pose.tipPivot[1]).toBeCloseTo(0);
});

test("the flip turns the card exactly over and settles flat", () => {
  expect(flipFrame(0).rotU).toBeCloseTo(0);
  expect(flipFrame(0).curlScale).toBeCloseTo(1);
  expect(flipFrame(FLIP_MS).rotU).toBeCloseTo(Math.PI);
  expect(flipFrame(FLIP_MS).curlScale).toBe(0);
  expect(flipFrame(FLIP_MS).lift).toBeCloseTo(0, 5);
  expect(flipFrame(FLIP_MS / 2).lift).toBeCloseTo(1, 5); // peak mid-air
  // rotation is monotonic
  let prev = -1;
  for (let t = 0; t <= FLIP_MS; t += 20) {
    const r = flipFrame(t).rotU;
    expect(r).toBeGreaterThanOrEqual(prev);
    prev = r;
  }
});
