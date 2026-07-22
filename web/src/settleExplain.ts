import type { BetPayout } from "./engine/types";
import { formatCents } from "./format";

/**
 * The money-math a novice trips on: a Banker win pays 0.95:1, so a $100 win is
 * paid $95, not $100 — the house keeps a 5% commission. Derived from the settled
 * payouts (shared by both clients), summed across every winning Banker main bet.
 * Returns null when there's no Banker win to explain.
 */
export function commissionNote(payouts: BetPayout[] | null): string | null {
  if (!payouts) return null;
  let stake = 0;
  let paid = 0;
  for (const p of payouts) {
    const k = p.bet.kind;
    if (typeof k === "object" && "Main" in k && k.Main === "Banker" && p.net > 0) {
      stake += p.bet.amount;
      paid += p.net;
    }
  }
  if (stake === 0) return null;
  const commission = stake - paid;
  if (commission <= 0) return null;
  return `Banker pays 0.95:1 — your ${formatCents(stake)} wins ${formatCents(
    paid,
  )}, not ${formatCents(stake)}: the house keeps a 5% commission (${formatCents(commission)}).`;
}
