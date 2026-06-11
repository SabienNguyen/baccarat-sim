export type SqueezeAction = "none" | "peek" | "reveal";

/** Drag progress (0..1) at which only the suit sliver shows. */
export const PEEK_AT = 0.25;
/** Drag progress (0..1) at which the card flips fully face-up. */
export const REVEAL_AT = 0.7;

/** Map a drag progress (0..1) to the action that should fire at that progress. */
export function actionForProgress(progress: number): SqueezeAction {
  if (progress >= REVEAL_AT) return "reveal";
  if (progress >= PEEK_AT) return "peek";
  return "none";
}

/** Where the card was gripped: a corner fold or a straight edge peel. */
export type PeelGrip = "tl" | "tr" | "bl" | "br" | "top" | "bottom" | "left" | "right";

/** Drag geometry: where the card was grabbed and the direction that peels. */
export interface Grip {
  grip: PeelGrip;
  /** Unit vector the drag must follow for the fold to grow. */
  dirX: number;
  dirY: number;
  /** Pointer travel (px) along that vector for a full peel. */
  reach: number;
}

/**
 * Map a grab point to its peel. The face splits into a 3×3 grid: corner
 * cells fold on the diagonal, edge cells peel straight across — the classic
 * long-edge squeeze — and the dead middle bends from the nearest horizontal
 * edge, so every grip follows the finger instead of snapping to a corner.
 */
export function gripAt(
  px: number,
  py: number,
  rect: { left: number; top: number; width: number; height: number },
): Grip {
  const fx = (px - rect.left) / rect.width;
  const fy = (py - rect.top) / rect.height;
  const col = fx < 1 / 3 ? 0 : fx < 2 / 3 ? 1 : 2;
  const row = fy < 1 / 3 ? 0 : fy < 2 / 3 ? 1 : 2;

  const top: Grip = { grip: "top", dirX: 0, dirY: 1, reach: rect.height * 0.8 };
  const bottom: Grip = { grip: "bottom", dirX: 0, dirY: -1, reach: rect.height * 0.8 };
  if (col === 1) return row === 0 || (row === 1 && fy < 0.5) ? top : bottom;
  if (row === 1) {
    return col === 0
      ? { grip: "left", dirX: 1, dirY: 0, reach: rect.width * 0.85 }
      : { grip: "right", dirX: -1, dirY: 0, reach: rect.width * 0.85 };
  }

  const right = col === 2;
  const low = row === 2;
  const diag = Math.hypot(rect.width, rect.height);
  return {
    grip: right && low ? "br" : right ? "tr" : low ? "bl" : "tl",
    // toward the opposite corner: the fold chases the finger across the card
    dirX: (right ? -rect.width : rect.width) / diag,
    dirY: (low ? -rect.height : rect.height) / diag,
    reach: diag * 0.8,
  };
}
