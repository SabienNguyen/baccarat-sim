import type { BetKind, BetPayout } from "./engine/types";
import { formatCents } from "./format";

/**
 * The side-bet key a payout carries: "PlayerPair", … or, for the two-sided
 * Dragon Bonus, "DragonBonusPlayer" / "DragonBonusBanker" — both sides are on
 * the felt, so the note has to name which one paid.
 */
function sideKey(kind: BetKind): string | null {
  if (typeof kind === "object" && "Side" in kind) {
    return typeof kind.Side === "string" ? kind.Side : `DragonBonus${kind.Side.DragonBonus}`;
  }
  return null;
}

/**
 * A tie leaves Player and Banker bets pushing — stake returned, nothing won or
 * lost. That's non-obvious to a novice ("I bet Player, the Player didn't lose,
 * but I wasn't paid?"). Fires only when the player actually has a main bet that
 * pushed: a Player/Banker payout nets exactly zero only on a tie.
 */
export function pushNote(payouts: BetPayout[] | null): string | null {
  if (!payouts) return null;
  const pushed = payouts.some((p) => {
    const k = p.bet.kind;
    return (
      typeof k === "object" &&
      "Main" in k &&
      (k.Main === "Player" || k.Main === "Banker") &&
      p.net === 0
    );
  });
  if (!pushed) return null;
  return "Tie — the hands finished level, so Player and Banker bets push: your stake comes back, nothing won or lost. (Tie and pair bets settle on their own.)";
}

/** What each currently-offered side bet means when it hits, `m` = the multiplier. */
const SIDE_DESC: Record<string, (m: number) => string> = {
  PlayerPair: (m) => `Player Pair — the Player's first two cards matched, paid ${m}:1.`,
  BankerPair: (m) => `Banker Pair — the Banker's first two cards matched, paid ${m}:1.`,
  Dragon7: (m) => `Dragon 7 — the Banker won with a three-card 7, paid ${m}:1.`,
  Panda8: (m) => `Panda 8 — the Player won with a three-card 8, paid ${m}:1.`,
  DragonBonusPlayer: (m) => `Player Dragon Bonus — paid ${m}:1 on the Player's winning margin.`,
  DragonBonusBanker: (m) => `Banker Dragon Bonus — paid ${m}:1 on the Banker's winning margin.`,
  Tiger: (m) => `Tiger — the Banker won on a 6, paid ${m}:1.`,
};

/**
 * One note per winning side bet, connecting the payout to what happened on the
 * felt. The multiplier comes straight from the payout (net = multiplier × stake),
 * so it stays correct even for the variable-payout bets (Dragon Bonus, Tiger).
 */
export function sideBetNotes(payouts: BetPayout[] | null): string[] {
  if (!payouts) return [];
  const notes: string[] = [];
  for (const p of payouts) {
    if (p.net <= 0) continue;
    const key = sideKey(p.bet.kind);
    if (key === null) continue;
    const mult = Math.round(p.net / p.bet.amount);
    const desc = SIDE_DESC[key];
    notes.push(desc ? desc(mult) : `${key} — paid ${mult}:1.`);
  }
  return notes;
}

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
