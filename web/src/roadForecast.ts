// The "next hand" key a Macau scoreboard shows: if the coming result is
// Banker (or Player), what mark would each derived road add? A pure port of
// engine/src/scoreboard.rs::derived_road, run against the live Big Road with
// one hypothetical cell appended. Display-only; the engine still owns the
// real roads.

import type { BigRoad, Mark, Side } from "./engine/types";

/** Derived road offset: 1 = Big Eye Boy, 2 = Small Road, 3 = Cockroach Pig. */
export type RoadOffset = 1 | 2 | 3;

/** The mark for the Big Road cell at (col, row), given the column heights. */
function markAt(heights: number[], col: number, row: number, offset: number): Mark | null {
  // the road only starts once the Big Road is deep/wide enough
  const started = col > offset || (col === offset && row >= 1);
  if (!started) return null;
  if (row === 0) {
    // turn: compare the previous column's depth with the one `offset` further left
    return heights[col - 1] === heights[col - 1 - offset] ? "Red" : "Blue";
  }
  // continuation: is there a cell `offset` columns left at this row?
  return heights[col - offset] > row ? "Red" : "Blue";
}

/** Group a flat mark sequence into run-based columns (new column on colour change). */
function columnize(marks: Mark[]): Mark[][] {
  const columns: Mark[][] = [];
  for (const m of marks) {
    const last = columns[columns.length - 1];
    if (last && last[0] === m) last.push(m);
    else columns.push([m]);
  }
  return columns;
}

/** Full derived road for `offset`, exactly as the engine computes it. */
export function derivedRoad(big: BigRoad, offset: number): Mark[][] {
  const heights = big.columns.map((c) => c.length);
  const marks: Mark[] = [];
  heights.forEach((height, col) => {
    for (let row = 0; row < height; row++) {
      const m = markAt(heights, col, row, offset);
      if (m) marks.push(m);
    }
  });
  return columnize(marks);
}

/**
 * What [Big Eye Boy, Small Road, Cockroach Pig] would each stamp if the next
 * decided hand went to `side`. null where that road has not started yet.
 */
export function nextMarks(big: BigRoad, side: Side): [Mark | null, Mark | null, Mark | null] {
  const heights = big.columns.map((c) => c.length);
  const last = big.columns[big.columns.length - 1];
  // same side extends the last column; a change starts a new one
  const col = last && last[0].side === side ? heights.length - 1 : heights.length;
  const row = last && last[0].side === side ? heights[col] : 0;
  return [markAt(heights, col, row, 1), markAt(heights, col, row, 2), markAt(heights, col, row, 3)];
}
