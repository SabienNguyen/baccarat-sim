import { describe, expect, test } from "vitest";
import { layoutRoad } from "./roadLayout";

/** Build logical columns of the given heights, cells labelled "<col>.<k>". */
function runs(...heights: number[]): string[][] {
  return heights.map((h, c) => Array.from({ length: h }, (_, k) => `${c}.${k}`));
}
const pos = (layout: ReturnType<typeof layoutRoad<string>>) =>
  layout.cells.map(({ col, row, cell }) => [cell, col, row] as const);

describe("layoutRoad folds logical columns onto a 6-row grid", () => {
  test("a 3-run sits straight down column 0", () => {
    const l = layoutRoad(runs(3));
    expect(pos(l)).toEqual([
      ["0.0", 0, 0],
      ["0.1", 0, 1],
      ["0.2", 0, 2],
    ]);
    expect(l.width).toBe(1);
  });

  test("an 8-run fills rows 0-5 then bends right along row 5", () => {
    const l = layoutRoad(runs(8));
    expect(pos(l).slice(5)).toEqual([
      ["0.5", 0, 5],
      ["0.6", 1, 5],
      ["0.7", 2, 5],
    ]);
    expect(l.width).toBe(3);
  });

  test("the column after a bent run starts right of where that run started", () => {
    // 8-run bends under columns 1 and 2; the next run still heads column 1
    const l = layoutRoad(runs(8, 2));
    expect(pos(l).slice(8)).toEqual([
      ["1.0", 1, 0],
      ["1.1", 1, 1],
    ]);
    expect(l.width).toBe(3);
  });

  test("a later run whose tail hits an earlier bent tail bends early", () => {
    // run 0: 8 tall, tail occupies (1,5) and (2,5)
    // run 1: 7 tall from column 1 -> rows 0-4, then (1,5) is taken, so it
    //        turns right along row 4 for its last two cells
    const l = layoutRoad(runs(8, 7));
    expect(pos(l).slice(8)).toEqual([
      ["1.0", 1, 0],
      ["1.1", 1, 1],
      ["1.2", 1, 2],
      ["1.3", 1, 3],
      ["1.4", 1, 4],
      ["1.5", 2, 4],
      ["1.6", 3, 4],
    ]);
  });

  test("a new run skips right past top-row cells an earlier tail already took", () => {
    // run 0 is 1 tall; run 1 is 1 tall ... build a tail along row 0 first:
    // impossible for row 0 directly, so use a 6-row grid of height 1 instead
    const l = layoutRoad(runs(3, 2), 1);
    // with one row everything bends immediately along row 0
    expect(pos(l)).toEqual([
      ["0.0", 0, 0],
      ["0.1", 1, 0],
      ["0.2", 2, 0],
      ["1.0", 3, 0],
      ["1.1", 4, 0],
    ]);
  });

  test("an empty road has no cells and no width", () => {
    expect(layoutRoad([])).toEqual({ cells: [], width: 0 });
  });

  test("every cell lands on its own slot within the row cap", () => {
    const l = layoutRoad(runs(9, 3, 7, 1, 1, 12, 2));
    const slots = new Set(l.cells.map((c) => `${c.col},${c.row}`));
    expect(slots.size).toBe(l.cells.length);
    for (const c of l.cells) expect(c.row).toBeLessThan(6);
  });
});
