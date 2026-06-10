import type { Card, CardView, Rank, RoundSnapshot, Side } from "./engine/types";

/** True only when a card is fully revealed (face-up). */
export function isFaceUp(card: CardView): card is { FaceUp: Card } {
  return card !== "FaceDown" && typeof card === "object" && "FaceUp" in card;
}

/** Indices of cards in a hand that are not yet fully face-up (face-down or peeked). */
export function hiddenIndices(cards: CardView[]): number[] {
  const out: number[] = [];
  cards.forEach((card, i) => {
    if (!isFaceUp(card)) out.push(i);
  });
  return out;
}

/** Baccarat card value: A=1, 2-9 face value, 10/J/Q/K = 0 (monkeys). */
const RANK_VALUE: Record<Rank, number> = {
  Ace: 1,
  Two: 2,
  Three: 3,
  Four: 4,
  Five: 5,
  Six: 6,
  Seven: 7,
  Eight: 8,
  Nine: 9,
  Ten: 0,
  Jack: 0,
  Queen: 0,
  King: 0,
};

/**
 * The running baccarat total of the face-up cards only (mod 10) — what anyone
 * at the table could read off the felt. Null until at least one card shows,
 * so no stray zero appears before the first flip.
 */
export function runningTotal(cards: CardView[]): number | null {
  let sum = 0;
  let seen = false;
  for (const card of cards) {
    if (isFaceUp(card)) {
      sum += RANK_VALUE[card.FaceUp.rank];
      seen = true;
    }
  }
  return seen ? sum % 10 : null;
}

/** A card that just turned face-up, and whose hand it belongs to. */
export interface Flip {
  side: Side;
  card: Card;
}

/**
 * Diff two snapshots and report the most recent reveal, in ritual order
 * (Player's two, Banker's two, thirds). Null when nothing new turned.
 */
export function lastFlipBetween(prev: RoundSnapshot, next: RoundSnapshot): Flip | null {
  const order: Array<[Side, number]> = [
    ["Player", 0],
    ["Player", 1],
    ["Banker", 0],
    ["Banker", 1],
    ["Player", 2],
    ["Banker", 2],
  ];
  let flip: Flip | null = null;
  for (const [side, i] of order) {
    const before = side === "Player" ? prev.player.cards[i] : prev.banker.cards[i];
    const after = side === "Player" ? next.player.cards[i] : next.banker.cards[i];
    if (after !== undefined && isFaceUp(after) && (before === undefined || !isFaceUp(before))) {
      flip = { side, card: after.FaceUp };
    }
  }
  return flip;
}
