import { describe, expect, test } from "vitest";
import { solveCellSize, MAX_ROAD_CELL, MIN_ROAD_CELL } from "./roadFit";

// four six-row bands
const rows = 24;

describe("solveCellSize", () => {
  test("a roomy screen gets the full 27px cell and no scaling", () => {
    expect(solveCellSize({ available: 1400, fixed: 400, rows })).toEqual({ cell: MAX_ROAD_CELL, scale: 1 });
  });

  test("a 1080p browser (about 950px) shrinks to the largest integer cell that fits", () => {
    // 950 - 330 chrome = 620 for 24 rows -> 25.8 -> 25px
    const fit = solveCellSize({ available: 950, fixed: 330, rows });
    expect(fit).toEqual({ cell: 25, scale: 1 });
    expect(Number.isInteger(fit.cell)).toBe(true);
    expect(fit.cell * rows + 330).toBeLessThanOrEqual(950);
  });

  test("never exceeds the cap even with room to spare", () => {
    expect(solveCellSize({ available: 5000, fixed: 100, rows }).cell).toBe(MAX_ROAD_CELL);
  });

  test("bottoms out at the 14px floor and scales when that still overflows", () => {
    // 600 - 330 = 270 / 24 -> 11px wanted, floored to 14 -> needs 666 in 600
    const fit = solveCellSize({ available: 600, fixed: 330, rows });
    expect(fit.cell).toBe(MIN_ROAD_CELL);
    expect(fit.scale).toBeCloseTo(600 / 666, 5);
  });

  test("exact fit at the floor is not scaled", () => {
    expect(solveCellSize({ available: 14 * rows + 100, fixed: 100, rows })).toEqual({ cell: 14, scale: 1 });
  });

  test("uses the exact remainder: one pixel short drops a whole cell size", () => {
    expect(solveCellSize({ available: 27 * rows + 200, fixed: 200, rows }).cell).toBe(27);
    expect(solveCellSize({ available: 27 * rows + 199, fixed: 200, rows }).cell).toBe(26);
  });
});
