import { actionForProgress, gripAt, PEEK_AT, REVEAL_AT } from "./squeeze";

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

// --- grip geometry: where you grab decides how the card peels ---

const RECT = { left: 0, top: 0, width: 90, height: 126 };

test("corner cells fold on the diagonal toward the opposite corner", () => {
  const tl = gripAt(10, 10, RECT);
  expect(tl.grip).toBe("tl");
  expect(tl.dirX).toBeGreaterThan(0);
  expect(tl.dirY).toBeGreaterThan(0);

  const br = gripAt(85, 120, RECT);
  expect(br.grip).toBe("br");
  expect(br.dirX).toBeLessThan(0);
  expect(br.dirY).toBeLessThan(0);
});

test("the bottom edge peels straight up — the classic squeeze", () => {
  const g = gripAt(45, 120, RECT); // middle of the bottom edge
  expect(g.grip).toBe("bottom");
  expect(g.dirX).toBe(0);
  expect(g.dirY).toBe(-1);
  // a straight-up drag is full-speed progress: nothing lost to projection
  expect(g.reach).toBeCloseTo(126 * 0.8);
});

test("the sides peel straight across", () => {
  const left = gripAt(5, 63, RECT); // middle of the left edge
  expect(left.grip).toBe("left");
  expect(left.dirX).toBe(1);
  expect(left.dirY).toBe(0);

  const right = gripAt(85, 63, RECT);
  expect(right.grip).toBe("right");
  expect(right.dirX).toBe(-1);
  expect(right.dirY).toBe(0);
});

test("the dead middle bends from the nearest horizontal edge", () => {
  expect(gripAt(45, 70, RECT).grip).toBe("bottom"); // lower half
  expect(gripAt(45, 55, RECT).grip).toBe("top"); // upper half
});

test("the top edge peels straight down", () => {
  const g = gripAt(45, 5, RECT);
  expect(g.grip).toBe("top");
  expect(g.dirX).toBe(0);
  expect(g.dirY).toBe(1);
});
