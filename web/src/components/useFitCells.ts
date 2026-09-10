import { useLayoutEffect, useRef, useState, type RefObject } from "react";
import { MAX_ROAD_CELL, MIN_ROAD_CELL, countBands, solveCellSize, type Fit } from "../roadFit";

const DEFAULT_FIT: Fit = { cell: MAX_ROAD_CELL, scale: 1, scroll: false };
/** Too short to fit even scaled: keep the floor cell and let the board scroll. */
const SCROLL_FIT: Fit = { cell: MIN_ROAD_CELL, scale: 1, scroll: true };
/** Below this width the board stacks and scrolls instead of fitting. */
const STACKED = "(max-width: 700px)";
/** Below this height nothing legible fits: the board scrolls at the floor cell. */
const SHORT = "(max-height: 480px)";
/** Fixed-point iterations allowed per resize before we settle. */
const MAX_PASSES = 40;

function matches(query: string): boolean {
  return typeof window.matchMedia === "function" && window.matchMedia(query).matches;
}

/**
 * Size the roads board to its viewport. `boardRef` is the flex slot the board
 * has to fill; `fitRef` is the wrapper inside it holding every band. On each
 * resize we measure how much of the wrapper is chrome (everything but the
 * six-row grids), solve for the largest integer cell that fits, apply it via
 * `--road-cell`, and re-measure until it settles — the chrome shifts a little
 * as headings and cards scale with the cell. If the 14px floor still
 * overflows, the wrapper is scaled down a little; past the legibility floor
 * it stays at 14px and the board scrolls instead.
 */
export function useFitCells(boardRef: RefObject<HTMLElement>, fitRef: RefObject<HTMLElement>): Fit {
  const [fit, setFit] = useState<Fit>(DEFAULT_FIT);
  const [pass, setPass] = useState(0);
  // the slot's last seen size, so re-layouts that leave it alone (our own
  // --road-cell updates, a scrollbar toggling) do not restart the search
  const seen = useRef<{ w: number; h: number } | null>(null);

  // Each real resize restarts the search from the top; the ceiling stops the
  // fixed-point loop from oscillating between "fits" and "one px over".
  useLayoutEffect(() => {
    if (typeof ResizeObserver === "undefined") return;
    const board = boardRef.current;
    if (!board) return;
    const ro = new ResizeObserver(() => {
      const w = board.clientWidth;
      const h = board.clientHeight;
      if (seen.current && seen.current.w === w && seen.current.h === h) return;
      seen.current = { w, h };
      ceiling = MAX_ROAD_CELL;
      passes = 0;
      setPass((p) => p + 1);
    });
    ro.observe(board);
    return () => ro.disconnect();
  }, [boardRef]);

  useLayoutEffect(() => {
    const board = boardRef.current;
    const wrap = fitRef.current;
    if (!board || !wrap) return;
    const available = board.clientHeight;
    if (available <= 0) return; // no layout (jsdom) — keep the defaults
    if (matches(STACKED)) {
      if (fit !== DEFAULT_FIT) setFit(DEFAULT_FIT);
      return;
    }
    if (matches(SHORT)) {
      if (fit !== SCROLL_FIT) setFit(SCROLL_FIT);
      return;
    }
    if (passes >= MAX_PASSES) return;

    const grids = wrap.querySelectorAll<HTMLElement>(".road-grid, .bead-grid");
    // the Small Road / Cockroach Pig pair sit side by side in one band, so
    // count bands by distinct top edge rather than by grid
    const tops: number[] = [];
    grids.forEach((g) => tops.push(g.getBoundingClientRect().top));
    const rows = countBands(tops) * 6;
    const needed = wrap.offsetHeight; // layout height, unaffected by the scale transform
    // everything that is not a cell: headings, cards, gaps, grid padding
    const fixed = needed - rows * fit.cell;
    const solved = solveCellSize({ available, fixed, rows, max: ceiling });

    let next: Fit;
    if (needed > available) {
      // overflowing: never come back up past this size on this resize
      const cell = Math.max(MIN_ROAD_CELL, Math.min(fit.cell - 1, solved.cell));
      ceiling = cell;
      next = cell === fit.cell ? { cell, scale: solved.scale, scroll: solved.scroll } : { cell, scale: 1, scroll: false };
    } else {
      next = { cell: Math.min(ceiling, solved.cell), scale: 1, scroll: false };
    }
    passes += 1;
    if (next.cell !== fit.cell || next.scale !== fit.scale || next.scroll !== fit.scroll) setFit(next);
  }, [boardRef, fitRef, fit, pass]);

  return fit;
}

// module-level search state; one board is ever open at a time
let ceiling = MAX_ROAD_CELL;
let passes = 0;
