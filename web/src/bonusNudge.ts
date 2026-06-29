// The "you would've won" nudge: after a hand resolves, find the best side bet
// that WOULD have hit but the player didn't place — so we can offer to teach
// and bet it next hand. Derived purely from the final hands, covering only the
// cleanly-defined outcomes (no rule-duplication of the engine's payouts).
import type { RoundSnapshot, CardView, BetKind, SideBet } from "./engine/types";

export interface BonusHit {
  /** The side bet to offer next hand. */
  kind: BetKind;
  /** Felt-style display name, e.g. "PANDA 8". */
  label: string;
  /** Payout caption, e.g. "25:1". */
  payout: string;
}

function rankOf(card: CardView | undefined): string | null {
  return card != null && typeof card === "object" && "FaceUp" in card ? card.FaceUp.rank : null;
}

function isPair(cards: CardView[]): boolean {
  const a = rankOf(cards[0]);
  return a !== null && a === rankOf(cards[1]);
}

// Highest payout first — the nudge advertises the best bet you missed.
const CANDIDATES: Array<{ side: SideBet; label: string; payout: string; hit: (s: RoundSnapshot) => boolean }> = [
  {
    side: "Dragon7",
    label: "DRAGON 7",
    payout: "40:1",
    hit: (s) => s.outcome === "BankerWin" && s.banker.cards.length === 3 && s.banker.total === 7,
  },
  {
    side: "Panda8",
    label: "PANDA 8",
    payout: "25:1",
    hit: (s) => s.outcome === "PlayerWin" && s.player.cards.length === 3 && s.player.total === 8,
  },
  {
    side: "Tiger",
    label: "TIGER",
    payout: "up to 20:1",
    hit: (s) => s.outcome === "BankerWin" && s.banker.total === 6,
  },
  { side: "PlayerPair", label: "PLAYER PAIR", payout: "11:1", hit: (s) => isPair(s.player.cards) },
  { side: "BankerPair", label: "BANKER PAIR", payout: "11:1", hit: (s) => isPair(s.banker.cards) },
];

/** The best side bet that would have won this resolved hand and wasn't placed,
 *  or null if the hand teaches nothing. */
export function bonusWouldWin(snapshot: RoundSnapshot, placedKinds: BetKind[]): BonusHit | null {
  if (snapshot.outcome === null) return null;
  const placed = new Set(placedKinds.map((k) => JSON.stringify(k)));
  for (const c of CANDIDATES) {
    const kind: BetKind = { Side: c.side };
    if (placed.has(JSON.stringify(kind))) continue;
    if (c.hit(snapshot)) return { kind, label: c.label, payout: c.payout };
  }
  return null;
}
