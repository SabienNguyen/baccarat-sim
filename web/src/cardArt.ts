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

/** Standard pip positions per rank, as [x%, y%] of the pip area. */
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
    [27, 15],
    [73, 15],
    [27, 85],
    [73, 85],
  ],
  Five: [
    [27, 15],
    [73, 15],
    [50, 50],
    [27, 85],
    [73, 85],
  ],
  Six: [
    [27, 15],
    [73, 15],
    [27, 50],
    [73, 50],
    [27, 85],
    [73, 85],
  ],
  Seven: [
    [27, 15],
    [73, 15],
    [50, 32],
    [27, 50],
    [73, 50],
    [27, 85],
    [73, 85],
  ],
  Eight: [
    [27, 15],
    [73, 15],
    [50, 32],
    [27, 50],
    [73, 50],
    [50, 68],
    [27, 85],
    [73, 85],
  ],
  Nine: [
    [27, 15],
    [73, 15],
    [27, 38],
    [73, 38],
    [50, 50],
    [27, 62],
    [73, 62],
    [27, 85],
    [73, 85],
  ],
  Ten: [
    [27, 13],
    [73, 13],
    [50, 25],
    [27, 37],
    [73, 37],
    [27, 63],
    [73, 63],
    [50, 75],
    [27, 87],
    [73, 87],
  ],
};

/** Court figures, drawn double-ended like a real deck. */
export const COURT_GLYPH: Partial<Record<Rank, string>> = { Jack: "♞", Queen: "♛", King: "♚" };

export function suitColor(suit: Suit): "red" | "black" {
  return suit === "Hearts" || suit === "Diamonds" ? "red" : "black";
}
