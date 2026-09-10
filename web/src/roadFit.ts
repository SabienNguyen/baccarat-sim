// Fit-to-viewport for the full roads board. Given the height the board has
// to fill and the height of everything that is NOT a road cell (headings,
// cards, footer, grid padding and gaps), find the largest integer cell size
// that lets every six-row grid fit. Integer px only, so the pixel glyphs
// stay crisp. If even the smallest cell overflows, the caller scales the
// whole board down instead.

export const MAX_ROAD_CELL = 27;
export const MIN_ROAD_CELL = 14;

export interface FitInput {
  /** Height available to the board, px. */
  available: number;
  /** Height of all non-cell chrome at the current render, px. */
  fixed: number;
  /** Total cell rows stacked vertically (four six-row bands = 24). */
  rows: number;
  max?: number;
  min?: number;
}

export interface Fit {
  /** Integer cell edge, px. */
  cell: number;
  /** 1 when the cells fit; < 1 when the board must be scaled to fit. */
  scale: number;
}

export function solveCellSize({
  available,
  fixed,
  rows,
  max = MAX_ROAD_CELL,
  min = MIN_ROAD_CELL,
}: FitInput): Fit {
  const spare = available - fixed;
  const raw = Math.floor(spare / rows);
  const cell = Math.max(min, Math.min(max, raw));
  const needed = fixed + rows * cell;
  const scale = needed > available && needed > 0 ? Math.max(0.1, available / needed) : 1;
  return { cell, scale };
}
