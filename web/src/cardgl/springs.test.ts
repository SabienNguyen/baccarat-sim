import { springStep, flutterScale, type SpringState } from "./springs";

test("a critically damped spring converges without overshoot", () => {
  let s: SpringState = { x: 0, v: 0 };
  for (let i = 0; i < 60; i++) {
    s = springStep(s, 100, 30, 16);
    expect(s.x).toBeLessThanOrEqual(100 + 1e-9); // never crosses the target
  }
  expect(Math.abs(s.x - 100)).toBeLessThan(0.5);
});

test("the spring is stable at huge time steps", () => {
  let s: SpringState = { x: 0, v: 500 };
  s = springStep(s, 100, 30, 500);
  expect(Number.isFinite(s.x)).toBe(true);
  expect(Math.abs(s.x - 100)).toBeLessThan(5);
});

test("flutter starts at full hold and dies out", () => {
  expect(flutterScale(0)).toBeCloseTo(1);
  expect(flutterScale(1000)).toBe(0);
});

test("flutter re-bends once before settling", () => {
  // |cos| zero near 121ms, local max near 242ms: the one soft re-bend
  expect(flutterScale(242)).toBeGreaterThan(flutterScale(121) + 0.1);
});
