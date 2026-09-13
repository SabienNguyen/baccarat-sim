// The card's printed artwork as data: shared by the DOM face (Card.tsx)
// and the GL texture painter (cardgl/facePainter.ts), so both render the
// exact same deck.
import type { Rank, Suit } from "./engine/types";

export const RANK_SHORT: Record<Rank, string> = {
  Ace: "A",
  Two: "2",
  Three: "3",
  Four: "4",
  Five: "5",
  Six: "6",
  Seven: "7",
  Eight: "8",
  Nine: "9",
  Ten: "10",
  Jack: "J",
  Queen: "Q",
  King: "K",
};

export const SUIT_GLYPH: Record<Suit, string> = {
  Clubs: "♣",
  Diamonds: "♦",
  Hearts: "♥",
  Spades: "♠",
};

/** Standard pip positions per rank, as [x%, y%] of the pip area. The
 *  outer columns sit at 25/75 of the area (a real deck prints them about
 *  a quarter of the way in from each side of the pip field). */
export const PIP_LAYOUT: Partial<Record<Rank, Array<[number, number]>>> = {
  Ace: [[50, 50]],
  Two: [
    [50, 15],
    [50, 85],
  ],
  Three: [
    [50, 15],
    [50, 50],
    [50, 85],
  ],
  Four: [
    [25, 15],
    [75, 15],
    [25, 85],
    [75, 85],
  ],
  Five: [
    [25, 15],
    [75, 15],
    [50, 50],
    [25, 85],
    [75, 85],
  ],
  Six: [
    [25, 15],
    [75, 15],
    [25, 50],
    [75, 50],
    [25, 85],
    [75, 85],
  ],
  Seven: [
    [25, 15],
    [75, 15],
    [50, 32],
    [25, 50],
    [75, 50],
    [25, 85],
    [75, 85],
  ],
  Eight: [
    [25, 15],
    [75, 15],
    [50, 32],
    [25, 50],
    [75, 50],
    [50, 68],
    [25, 85],
    [75, 85],
  ],
  Nine: [
    [25, 15],
    [75, 15],
    [25, 38],
    [75, 38],
    [50, 50],
    [25, 62],
    [75, 62],
    [25, 85],
    [75, 85],
  ],
  Ten: [
    [25, 13],
    [75, 13],
    [50, 25],
    [25, 37],
    [75, 37],
    [25, 63],
    [75, 63],
    [50, 75],
    [25, 87],
    [75, 87],
  ],
};

/** Court figures, drawn double-ended like a real deck. */
export const COURT_GLYPH: Partial<Record<Rank, string>> = { Jack: "♞", Queen: "♛", King: "♚" };

export function suitColor(suit: Suit): "red" | "black" {
  return suit === "Hearts" || suit === "Diamonds" ? "red" : "black";
}
