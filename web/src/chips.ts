/**
 * The chip economy. Pure functions over a rack of physical chips.
 *
 * The engine's bankroll (cents) stays the source of truth; the rack is the
 * table-side representation of it as chips. Invariant the store maintains:
 * rackTotal(rack) + change + sum(staged bets) === bankroll.
 */

/** Real casino denominations, in cents: $1, $5, $25, $100, $500, $1,000. */
export const CHIP_DENOMINATIONS = [100, 500, 2500, 10000, 50000, 100000];

/** Chips you own, keyed by denomination (cents) -> count. */
export type Rack = Record<number, number>;

/** Largest-first denominations, for greedy change-making. */
const DESC = [...CHIP_DENOMINATIONS].sort((a, b) => b - a);

export function emptyRack(): Rack {
  const rack: Rack = {};
  for (const d of CHIP_DENOMINATIONS) rack[d] = 0;
  return rack;
}

export function rackTotal(rack: Rack): number {
  return CHIP_DENOMINATIONS.reduce((sum, d) => sum + d * (rack[d] ?? 0), 0);
}

/**
 * Break an amount into chips, largest denomination first (how a dealer pays).
 * Whatever can't form a whole chip is returned as `remainder` (< $1).
 */
export function toChips(cents: number): { chips: number[]; remainder: number } {
  const chips: number[] = [];
  let left = Math.max(0, Math.floor(cents));
  for (const d of DESC) {
    while (left >= d) {
      chips.push(d);
      left -= d;
    }
  }
  return { chips, remainder: left };
}

/**
 * The cage's buy-in: turn a bankroll into a playable spread of chips.
 * Mostly big chips with enough small ones to actually bet; conserves the
 * total exactly (sub-$1 cents end up in `change`).
 */
export function buyIn(cents: number): { rack: Rack; change: number } {
  const rack = emptyRack();
  let left = Math.max(0, Math.floor(cents));

  // Target spread (fractions of the bankroll per denomination).
  const SPREAD: Array<[number, number]> = [
    [100000, 0.3],
    [50000, 0.25],
    [10000, 0.25],
    [2500, 0.12],
    [500, 0.05],
    [100, 0.03],
  ];
  for (const [denom, frac] of SPREAD) {
    const count = Math.floor((cents * frac) / denom);
    const affordable = Math.min(count, Math.floor(left / denom));
    rack[denom] += affordable;
    left -= affordable * denom;
  }
  // Whatever the spread left over goes in as chips, largest-first.
  const { chips, remainder } = toChips(left);
  for (const c of chips) rack[c] += 1;
  return { rack, change: remainder };
}

export function addChips(rack: Rack, chips: number[]): Rack {
  const next = { ...rack };
  for (const c of chips) next[c] = (next[c] ?? 0) + 1;
  return next;
}

/** Remove chips; returns null if any chip isn't actually in the rack. */
export function removeChips(rack: Rack, chips: number[]): Rack | null {
  const next = { ...rack };
  for (const c of chips) {
    if ((next[c] ?? 0) < 1) return null;
    next[c] -= 1;
  }
  return next;
}

/**
 * Ask the dealer to break one `denom` chip into smaller chips (greedy:
 * $1,000 -> 2x$500, $100 -> 4x$25, ...). Null if you don't have one or it's
 * the smallest chip.
 */
export function breakChip(rack: Rack, denom: number): Rack | null {
  if ((rack[denom] ?? 0) < 1) return null;
  const smaller = DESC.filter((d) => d < denom);
  if (smaller.length === 0) return null;
  const next = { ...rack, [denom]: rack[denom] - 1 };
  let left = denom;
  for (const d of smaller) {
    while (left >= d) {
      next[d] = (next[d] ?? 0) + 1;
      left -= d;
    }
  }
  return left === 0 ? next : null;
}

/**
 * Color up: hand the dealer smaller chips worth exactly one `denom` chip.
 * Uses your smaller chips largest-first. Null if you can't make the amount.
 */
export function colorUp(rack: Rack, denom: number): Rack | null {
  const smaller = DESC.filter((d) => d < denom);
  const next = { ...rack };
  let need = denom;
  for (const d of smaller) {
    while (need >= d && (next[d] ?? 0) > 0) {
      next[d] -= 1;
      need -= d;
    }
  }
  if (need !== 0) return null;
  next[denom] = (next[denom] ?? 0) + 1;
  return next;
}

/**
 * Fold loose change into $1 chips once it reaches a dollar.
 * Returns the minted chips and what's still loose.
 */
export function mintChange(change: number): { chips: number[]; change: number } {
  const { chips, remainder } = toChips(change);
  return { chips, change: remainder };
}
