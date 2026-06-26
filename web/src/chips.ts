/**
 * Chip display helpers. Money is a single balance (the engine bankroll);
 * chips are only a way to *show* a bet amount on the felt.
 */

/** The classic main-floor denominations: $1, $5, $25, $100, $500, $1,000. */
export const CHIP_DENOMINATIONS = [100, 500, 2500, 10000, 50000, 100000];

function desc(denoms: number[]): number[] {
  return [...denoms].sort((a, b) => b - a);
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
