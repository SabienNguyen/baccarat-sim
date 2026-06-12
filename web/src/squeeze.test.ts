import { actionForProgress, foldFrom, gripFrom, HELD_FOLD, PEEK_AT, REVEAL_AT } from "./squeeze";

test("below the peek threshold does nothing", () => {
  expect(actionForProgress(0)).toBe("none");
  expect(actionForProgress(PEEK_AT - 0.01)).toBe("none");
});

test("at or above the peek threshold peeks", () => {
  expect(actionForProgress(PEEK_AT)).toBe("peek");
  expect(actionForProgress(REVEAL_AT - 0.01)).toBe("peek");
});

test("at or above the reveal threshold reveals", () => {
  expect(actionForProgress(REVEAL_AT)).toBe("reveal");
  expect(actionForProgress(1)).toBe("reveal");
});

test("thresholds are ordered sanely", () => {
  expect(PEEK_AT).toBeGreaterThan(0);
  expect(REVEAL_AT).toBeGreaterThan(PEEK_AT);
  expect(REVEAL_AT).toBeLessThanOrEqual(1);
});

// --- the fold: the crease forms between the grab point and the finger ---

const RECT = { left: 0, top: 0, width: 90, height: 126 };

test("a straight pull up from the bottom edge creases at the midpoint", () => {
  const f = foldFrom(45, 120, 45, 60, RECT);
  expect(f).not.toBeNull();
  // midpoint y = 90 of 126 → the flap is the bottom 28.6% of the card
  expect(f!.clip).toContain("71.4%");
  expect(f!.angle).toBeCloseTo(0);
  expect(f!.progress).toBeGreaterThan(0);
});

test("grabbing mid-card folds from that exact point, not a corner", () => {
  const f = foldFrom(45, 100, 45, 40, RECT);
  // crease at y = 70 → 55.6%: the fold tracks the grab, wherever it was
  expect(f!.clip).toContain("55.6%");
});

test("a slanted pull creases on the slant", () => {
  const f = foldFrom(85, 120, 30, 60, RECT); // near the br corner, pulled up-left
  expect(f!.clip).toMatch(/^polygon\(/);
  expect(f!.angle).toBeLessThan(0); // the crease leans with the drag
});

test("progress grows with the pull", () => {
  const short = foldFrom(45, 120, 45, 100, RECT)!;
  const long = foldFrom(45, 120, 45, 30, RECT)!;
  expect(long.progress).toBeGreaterThan(short.progress);
});

test("pulling away from the card folds nothing", () => {
  expect(foldFrom(45, 120, 45, 170, RECT)).toBeNull(); // straight down, off the felt
});

test("degenerate gestures fold nothing", () => {
  expect(foldFrom(45, 120, 45, 120, RECT)).toBeNull(); // no travel
  expect(foldFrom(0, 0, 10, 10, { left: 0, top: 0, width: 0, height: 0 })).toBeNull();
});

test("a peeked card at rest holds a bottom-edge bend", () => {
  expect(HELD_FOLD.clip).toMatch(/^polygon\(/);
  expect(HELD_FOLD.angle).toBeCloseTo(0);
});

test("a modest pinch reads the edge pips but keeps the corner index covered", () => {
  // a diagonal pinch: the bend is widest at the fingers and closes toward
  // the corners — where the rank index lives
  const f = foldFrom(45, 123, 70, 83, RECT);
  expect(f).not.toBeNull();
  // the index corner on the pull side stays covered
  expect(f!.clip).not.toContain("100.0% 100.0%");
});

test("a deep pull opens the whole edge, corners and all", () => {
  const f = foldFrom(45, 123, 45, 10, RECT)!;
  expect(f.clip).toContain("0.0% 100.0%");
  expect(f.clip).toContain("100.0% 100.0%");
});

test("the folded-back flap's tip lands exactly at the finger", () => {
  // pinch the bottom edge itself (45,126), pull to (45,60): folding the
  // edge over the crease puts the grabbed point right under the fingertip
  const f = foldFrom(45, 126, 45, 60, RECT)!;
  // y=126 mirrored across the crease at y=93 → y=60, the finger (47.6%)
  expect(f.flapClip).toContain("47.6%");
  expect(f.flapClip).toMatch(/^polygon\(/);
});

test("the flap mirrors the opening across the crease", () => {
  const f = foldFrom(45, 100, 45, 40, RECT)!;
  // opening apex at the crease y=70 stays the hinge: both clips share it
  expect(f.clip).toContain("55.6%");
  expect(f.flapClip).toContain("55.6%");
});

test("the fold knows its hinge: the crease point between grab and finger", () => {
  const f = foldFrom(45, 120, 45, 60, RECT)!;
  // crease at (45, 90) → the flap rotates up around this point
  expect(f.origin).toBe("50.0% 71.4%");
});

test("the flap face is a pure layout shift — symmetric artwork, no transform", () => {
  // rotating 180° about the crease equals translating the (symmetric)
  // face artwork by twice the crease offset from center
  const f = foldFrom(45, 120, 45, 60, RECT)!;
  // crease at (50%, 71.4%): shift = (0%, 42.9%)
  expect(f.faceShift).toEqual({ left: "0.0%", top: "42.9%" });
});

test("the bend has a limit — pulling past it doesn't stretch the fold", () => {
  const atCap = foldFrom(45, 123, 45, 5, RECT)!;
  const past = foldFrom(45, 123, 45, -40, RECT)!; // way past the card
  // same direction, both beyond the cap: identical frozen geometry
  expect(past.clip).toBe(atCap.clip);
  expect(past.flapClip).toBe(atCap.flapClip);
  expect(past.progress).toBe(atCap.progress);
  // the cap still clears the reveal threshold
  expect(atCap.progress).toBeGreaterThan(REVEAL_AT);
  expect(atCap.progress).toBeLessThan(1);
});

// --- grip kinds: a clean side pull folds straight, everything else pinches ---

test("a straight pull from the bottom edge is a rectangular fold", () => {
  const f = foldFrom(45, 120, 45, 60, RECT)!;
  expect(f.grip).toBe("edge");
  // full-width strip: both bottom corners are in the opening
  expect(f.clip).toContain("0.0% 100.0%");
  expect(f.clip).toContain("100.0% 100.0%");
  // the flap is the matching strip, tip at the finger line
  expect(f.flapClip).toContain("47.6%"); // 2·apex above the grab: y=60, the finger
});

test("corner pulls and semi-corners keep the pinch parabola", () => {
  expect(foldFrom(85, 120, 30, 60, RECT)!.grip).toBe("pinch"); // corner pull
  expect(foldFrom(75, 123, 75, 80, RECT)!.grip).toBe("pinch"); // near the corner
  expect(foldFrom(45, 123, 80, 83, RECT)!.grip).toBe("pinch"); // diagonal pull
});

test("a side pull from the left edge folds a vertical strip", () => {
  const f = foldFrom(4, 63, 50, 63, RECT)!;
  expect(f.grip).toBe("edge");
  expect(f.clip).toContain("0.0% 0.0%");
  expect(f.clip).toContain("0.0% 100.0%");
});

// --- gripFrom: the gesture's geometric core, shared with the GL engine ---

test("gripFrom exposes the fold's geometric core", () => {
  const g = gripFrom(45, 120, 45, 60, RECT)!;
  expect(g.edge).toBe(true);
  expect(g.gx).toBe(45);
  expect(g.gy).toBe(120);
  expect(g.nx).toBeCloseTo(0);
  expect(g.ny).toBeCloseTo(-1);
  expect(g.bend).toBeCloseTo(60);
  expect(g.apex).toBeCloseTo(30);
  expect(g.angle).toBeCloseTo(0);
  expect(g.progress).toBeGreaterThan(0);
});

test("gripFrom matches foldFrom's grip taxonomy and null cases", () => {
  expect(gripFrom(85, 120, 30, 60, RECT)!.edge).toBe(false); // corner pinch
  expect(gripFrom(45, 120, 45, 170, RECT)).toBeNull(); // pull off the card
  expect(gripFrom(45, 120, 45, 120, RECT)).toBeNull(); // no travel
});
