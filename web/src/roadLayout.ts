// The 6-row "dragon tail" bend every pit display applies to the Big Road and
// its derived roads. The engine keeps columns logical and unbounded
// (engine/src/scoreboard.rs); this is the pure layout transform that folds
// them onto a fixed-height physical grid.
//
// Textbook rule:
//  - a logical column starts at row 0 of the next free physical column;
//  - its k-th cell sits at (col, k) while k < rows and that slot is free;
//  - once the run reaches the bottom row, or the next slot down is taken, the
//    remaining cells continue along that same row moving right;
//  - the next logical column starts one physical column right of where the
//    previous run STARTED (not where its tail ended), skipping further right
//    while (col, 0) is already occupied by an earlier tail.

export interface PlacedCell<T> {
  col: number;
  row: number;
  cell: T;
}

export interface RoadLayout<T> {
  cells: PlacedCell<T>[];
  /** Physical columns used (max col + 1); 0 for an empty road. */
  width: number;
}

export function layoutRoad<T>(columns: T[][], rows = 6): RoadLayout<T> {
  const taken = new Set<string>();
  const key = (c: number, r: number) => `${c},${r}`;
  const cells: PlacedCell<T>[] = [];
  let width = 0;
  let startCol = 0;

  for (const column of columns) {
    // find this run's head: next free top-row slot
    while (taken.has(key(startCol, 0))) startCol += 1;
    let col = startCol;
    let row = 0;
    column.forEach((cell, k) => {
      if (k > 0) {
        // step down while there is room and the slot below is free; else bend right
        if (row + 1 < rows && !taken.has(key(col, row + 1))) row += 1;
        else col += 1;
      }
      taken.add(key(col, row));
      cells.push({ col, row, cell });
      width = Math.max(width, col + 1);
    });
    startCol += 1;
  }

  return { cells, width };
}
