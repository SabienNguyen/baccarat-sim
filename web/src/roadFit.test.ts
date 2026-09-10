import { describe, expect, test } from "vitest";
import { countBands, solveCellSize, MAX_ROAD_CELL, MIN_FIT_SCALE, MIN_ROAD_CELL } from "./roadFit";

// four six-row bands
const rows = 24;

describe("solveCellSize", () => {
  test("a roomy screen gets the full 27px cell and no scaling", () => {
    expect(solveCellSize({ available: 1400, fixed: 400, rows })).toEqual({
      cell: MAX_ROAD_CELL,
      scale: 1,
      scroll: false,
    });
  });

  test("a 1080p browser (about 950px) shrinks to the largest integer cell that fits", () => {
    // 950 - 330 chrome = 620 for 24 rows -> 25.8 -> 25px
    const fit = solveCellSize({ available: 950, fixed: 330, rows });
    expect(fit).toEqual({ cell: 25, scale: 1, scroll: false });
    expect(Number.isInteger(fit.cell)).toBe(true);
    expect(fit.cell * rows + 330).toBeLessThanOrEqual(950);
  });

  test("never exceeds the cap even with room to spare", () => {
    expect(solveCellSize({ available: 5000, fixed: 100, rows }).cell).toBe(MAX_ROAD_CELL);
  });

  test("bottoms out at the 14px floor and scales when that still overflows a little", () => {
    // 600 - 330 = 270 / 24 -> 11px wanted, floored to 14 -> needs 666 in 600
    const fit = solveCellSize({ available: 600, fixed: 330, rows });
    expect(fit.cell).toBe(MIN_ROAD_CELL);
    expect(fit.scale).toBeCloseTo(600 / 666, 5);
    expect(fit.scroll).toBe(false);
  });

  test("exact fit at the floor is not scaled", () => {
    expect(solveCellSize({ available: 14 * rows + 100, fixed: 100, rows })).toEqual({
      cell: 14,
      scale: 1,
      scroll: false,
    });
  });

  test("uses the exact remainder: one pixel short drops a whole cell size", () => {
    expect(solveCellSize({ available: 27 * rows + 200, fixed: 200, rows }).cell).toBe(27);
    expect(solveCellSize({ available: 27 * rows + 199, fixed: 200, rows }).cell).toBe(26);
  });

  describe("legibility floor", () => {
    // 14px cells with 330px of chrome need 666px
    const needed = MIN_ROAD_CELL * rows + 330;

    test("a scale just above the floor is still applied", () => {
      const available = Math.ceil(needed * MIN_FIT_SCALE) + 1;
      const fit = solveCellSize({ available, fixed: 330, rows });
      expect(fit.scroll).toBe(false);
      expect(fit.scale).toBeGreaterThanOrEqual(MIN_FIT_SCALE);
      expect(fit.scale).toBeLessThan(1);
    });

    test("below the floor the board is not scaled: it keeps 14px cells and scrolls", () => {
      const available = Math.floor(needed * MIN_FIT_SCALE) - 1;
      expect(solveCellSize({ available, fixed: 330, rows })).toEqual({
        cell: MIN_ROAD_CELL,
        scale: 1,
        scroll: true,
      });
    });

    test("a 740x360 landscape phone (about 280px for the board) scrolls", () => {
      // would otherwise be scale 280/666 = 0.42 with 4px type
      expect(solveCellSize({ available: 280, fixed: 330, rows })).toEqual({
        cell: MIN_ROAD_CELL,
        scale: 1,
        scroll: true,
      });
    });
  });
});

describe("countBands", () => {
  test("grids side by side share a band", () => {
    // bead plate, Big Road, Big Eye Boy, then Small Road + Cockroach Pig together
    expect(countBands([40, 300, 520, 740, 740])).toBe(4);
  });

  test("stacked grids each count", () => {
    expect(countBands([40, 300, 520, 740, 960])).toBe(5);
  });

  test("sub-pixel jitter between a pair does not split the band", () => {
    expect(countBands([40, 300, 520, 740.2, 739.8])).toBe(4);
  });

  test("no grids, no bands", () => {
    expect(countBands([])).toBe(0);
  });
});
