import type { CardView, Rank, Suit } from "../engine/types";
import "./cards.css";

const RANK_SHORT: Record<Rank, string> = {
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

const SUIT_GLYPH: Record<Suit, string> = {
  Clubs: "♣",
  Diamonds: "♦",
  Hearts: "♥",
  Spades: "♠",
};

function suitColor(suit: Suit): "red" | "black" {
  return suit === "Hearts" || suit === "Diamonds" ? "red" : "black";
}

interface CardProps {
  card: CardView;
  /** 0..1 corner-bend progress, used only in the peeked state. */
  bend?: number;
}

export function Card({ card, bend = 0 }: CardProps) {
  if (card === "FaceDown") {
    return <div className="card card-back" aria-label="face-down card" />;
  }

  if ("Peeked" in card) {
    const suit = card.Peeked.sliver.suit;
    const corner = `${Math.round(20 + bend * 60)}%`;
    return (
      <div className="card card-back" aria-label={`peeked card, ${suit}`}>
        <span
          className="card-sliver"
          data-color={suitColor(suit)}
          style={{ clipPath: `polygon(0 0, ${corner} 0, 0 ${corner})` }}
        >
          {SUIT_GLYPH[suit]}
        </span>
      </div>
    );
  }

  const { rank, suit } = card.FaceUp;
  return (
    <div className="card card-face" aria-label={`${rank} of ${suit}`} data-color={suitColor(suit)}>
      <span className="card-rank">{RANK_SHORT[rank]}</span>
      <span className="card-suit">{SUIT_GLYPH[suit]}</span>
    </div>
  );
}
