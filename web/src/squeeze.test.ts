import { actionForProgress, PEEK_AT, REVEAL_AT } from "./squeeze";

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
