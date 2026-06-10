/**
 * The chip economy. Pure functions over a rack of physical chips.
 *
 * The engine's bankroll (cents) stays the source of truth; the rack is the
 * table-side representation of it as chips. Invariant the store maintains:
 * rackTotal(rack) + change + sum(staged bets) === bankroll.
 *
 * Every function takes the table's denomination set, because each table
 * stocks different chips (a high-roller salon has no dollar chips).
 */

/** The classic main-floor denominations: $1, $5, $25, $100, $500, $1,000. */
export const CHIP_DENOMINATIONS = [100, 500, 2500, 10000, 50000, 100000];

/** Chips you own, keyed by denomination (cents) -> count. */
export type Rack = Record<number, number>;

function desc(denoms: number[]): number[] {
  return [...denoms].sort((a, b) => b - a);
}
function asc(denoms: number[]): number[] {
  return [...denoms].sort((a, b) => a - b);
}

export function emptyRack(denoms: number[] = CHIP_DENOMINATIONS): Rack {
  const rack: Rack = {};
  for (const d of denoms) rack[d] = 0;
  return rack;
}

export function rackTotal(rack: Rack): number {
  return Object.entries(rack).reduce((sum, [d, n]) => sum + Number(d) * n, 0);
}

/**
 * Break an amount into chips, largest denomination first (how a dealer pays).
 * Whatever can't form a whole chip is returned as `remainder`.
 */
export function toChips(
  cents: number,
  denoms: number[] = CHIP_DENOMINATIONS,
): { chips: number[]; remainder: number } {
  const chips: number[] = [];
  let left = Math.max(0, Math.floor(cents));
  for (const d of desc(denoms)) {
    while (left >= d) {
      chips.push(d);
      left -= d;
    }
  }
  return { chips, remainder: left };
}

/**
 * The cage's buy-in: turn a bankroll into a playable spread of chips the way
 * a real cage racks it — the roll lives in big chips, with a capped working
 * stack of the table's three smallest denominations for change (nobody gets
 * 300 of the smallest chip). Conserves the total exactly (whatever can't
 * form a chip ends up in `change`).
 */
export function buyIn(
  cents: number,
  denoms: number[] = CHIP_DENOMINATIONS,
): { rack: Rack; change: number } {
  const rack = emptyRack(denoms);
  let left = Math.max(0, Math.floor(cents));

  const ordered = asc(denoms);
  const smalls = ordered.slice(0, 3); // the working stack
  const bigs = ordered.slice(3); // the roll
  const CAPS = [20, 36, 40]; // a sleeve, a stack, a rack
  const FRACS = [0.002, 0.018, 0.08];

  // big chips carry ~90% of the roll, split evenly
  const bigFrac = bigs.length > 0 ? 0.9 / bigs.length : 0;
  for (const denom of desc(bigs)) {
    const target = Math.floor((cents * bigFrac) / denom);
    const affordable = Math.min(target, Math.floor(left / denom));
    rack[denom] += affordable;
    left -= affordable * denom;
  }
  // capped working stacks, biggest small first
  for (let i = smalls.length - 1; i >= 0; i--) {
    const denom = smalls[i];
    const target = Math.min(Math.floor((cents * FRACS[i]) / denom), CAPS[i]);
    const affordable = Math.min(target, Math.floor(left / denom));
    rack[denom] += affordable;
    left -= affordable * denom;
  }
  // whatever the spread left over goes in as chips, largest-first
  const { chips, remainder } = toChips(left, denoms);
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
 * Ask the dealer to break one `denom` chip into smaller chips (greedy).
 * Null if you don't have one, it's the table's smallest chip, or the smaller
 * chips can't represent it exactly.
 */
export function breakChip(
  rack: Rack,
  denom: number,
  denoms: number[] = CHIP_DENOMINATIONS,
): Rack | null {
  if ((rack[denom] ?? 0) < 1) return null;
  const smaller = desc(denoms).filter((d) => d < denom);
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
export function colorUp(
  rack: Rack,
  denom: number,
  denoms: number[] = CHIP_DENOMINATIONS,
): Rack | null {
  const smaller = desc(denoms).filter((d) => d < denom);
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
 * Fold loose change into the table's smallest chips once it covers one.
 * Returns the minted chips and what's still loose.
 */
export function mintChange(
  change: number,
  denoms: number[] = CHIP_DENOMINATIONS,
): { chips: number[]; change: number } {
  const { chips, remainder } = toChips(change, denoms);
  return { chips, change: remainder };
}

/**
 * Get one `denom` chip from the dealer, paying with whatever you hold —
 * any chip is available if you have the money. Pays smallest chips first
 * (disturbing the rack as little as possible) and takes change back in
 * chips; cents that can't form a chip are returned as `loose`.
 * Null only when the rack can't cover the chip.
 */
export function acquire(
  rack: Rack,
  denom: number,
  denoms: number[] = CHIP_DENOMINATIONS,
): { rack: Rack; loose: number } | null {
  if (rackTotal(rack) < denom) return null;
  const next = { ...rack };
  let paid = 0;
  for (const d of asc(denoms)) {
    while (paid < denom && (next[d] ?? 0) > 0) {
      next[d] -= 1;
      paid += d;
    }
    if (paid >= denom) break;
  }
  if (paid < denom) return null;
  next[denom] = (next[denom] ?? 0) + 1;
  const back = toChips(paid - denom, denoms);
  for (const c of back.chips) next[c] = (next[c] ?? 0) + 1;
  return { rack: next, loose: back.remainder };
}
