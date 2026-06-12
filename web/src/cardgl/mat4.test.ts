import { identity, multiply, perspective, translation, rotationAboutAxis, scaleAboutPoint, transformPoint } from "./mat4";
import { CardGLEngine } from "./engine";

test("identity leaves points alone", () => {
  expect(transformPoint(identity(), [3, 4, 5])).toEqual([3, 4, 5]);
});

test("translation moves, multiply composes", () => {
  const m = multiply(translation(1, 0, 0), translation(0, 2, 0));
  expect(transformPoint(m, [0, 0, 0])).toEqual([1, 2, 0]);
});

test("rotation about an axis through a point keeps the point fixed", () => {
  const m = rotationAboutAxis([5, 5, 0], [0, 0, 1], Math.PI / 2);
  const fixed = transformPoint(m, [5, 5, 0]);
  expect(fixed[0]).toBeCloseTo(5);
  expect(fixed[1]).toBeCloseTo(5);
  const p = transformPoint(m, [6, 5, 0]); // 90° about z through (5,5)
  expect(p[0]).toBeCloseTo(5);
  expect(p[1]).toBeCloseTo(6);
});

test("scaleAboutPoint grows away from its anchor", () => {
  const m = scaleAboutPoint(2, [10, 10, 0]);
  expect(transformPoint(m, [11, 10, 0])[0]).toBeCloseTo(12);
});

test("perspective shrinks with distance", () => {
  const proj = perspective(Math.PI / 3, 1, 10, 1000);
  const near = transformPoint(proj, [10, 0, -100]);
  const far = transformPoint(proj, [10, 0, -200]);
  expect(Math.abs(near[0])).toBeGreaterThan(Math.abs(far[0]));
});

test("WebGL2 is not available in jsdom — the GL path stays off in tests", () => {
  expect(CardGLEngine.isSupported()).toBe(false);
});
