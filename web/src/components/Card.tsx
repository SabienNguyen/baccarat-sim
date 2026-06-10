import type { ReactNode } from "react";
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

/** Standard pip positions per rank, as [x%, y%] of the pip area. */
const PIP_LAYOUT: Partial<Record<Rank, Array<[number, number]>>> = {
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
const COURT_GLYPH: Partial<Record<Rank, string>> = { Jack: "♞", Queen: "♛", King: "♚" };

function suitColor(suit: Suit): "red" | "black" {
  return suit === "Hearts" || suit === "Diamonds" ? "red" : "black";
}

interface CardProps {
  card: CardView;
  /** 0..1 corner-bend progress while squeezing; drives the visible peel. */
  bend?: number;
}

/** The squeezed corner: the card stock folding back as you bend it. */
function Peel({ bend, children }: { bend: number; children?: ReactNode }) {
  if (bend <= 0) return null;
  const size = `${Math.round(18 + bend * 58)}%`;
  return (
    <>
      <span
        className="card-peel-under"
        style={{ clipPath: `polygon(0 0, ${size} 0, 0 ${size})` }}
      >
        {children}
      </span>
    </>
  );
}

export function Card({ card, bend = 0 }: CardProps) {
  // The whole card tilts and lifts a little while it's being squeezed.
  const squeeze =
    bend > 0
      ? {
          transform: `rotate(${(-bend * 4).toFixed(2)}deg) translateY(${(-bend * 6).toFixed(1)}px)`,
        }
      : undefined;

  if (card === "FaceDown") {
    return (
      <div className="card card-back" aria-label="face-down card" style={squeeze}>
        {/* the corner folds, but reveals nothing yet */}
        <Peel bend={bend} />
      </div>
    );
  }

  if ("Peeked" in card) {
    const suit = card.Peeked.sliver.suit;
    return (
      <div className="card card-back" aria-label={`peeked card, ${suit}`} style={squeeze}>
        <Peel bend={Math.max(bend, 0.35)}>
          <span className="card-sliver" data-color={suitColor(suit)}>
            {SUIT_GLYPH[suit]}
          </span>
        </Peel>
      </div>
    );
  }

  const { rank, suit } = card.FaceUp;
  const color = suitColor(suit);
  const pips = PIP_LAYOUT[rank];
  const court = COURT_GLYPH[rank];
  return (
    <div className="card card-face" aria-label={`${rank} of ${suit}`} data-color={color}>
      <span className="card-index card-index--tl">
        <span className="card-rank">{RANK_SHORT[rank]}</span>
        <span className="card-index-suit">{SUIT_GLYPH[suit]}</span>
      </span>
      <span className="card-index card-index--br">
        <span className="card-rank">{RANK_SHORT[rank]}</span>
        <span className="card-index-suit">{SUIT_GLYPH[suit]}</span>
      </span>
      {pips && (
        <span className="card-pips">
          {pips.map(([x, y], i) => (
            <span
              key={i}
              className={[
                "card-pip",
                rank === "Ace" ? "card-pip--ace" : "",
                y > 50 ? "card-pip--flip" : "",
              ]
                .filter(Boolean)
                .join(" ")}
              style={{ left: `${x}%`, top: `${y}%` }}
            >
              {SUIT_GLYPH[suit]}
            </span>
          ))}
        </span>
      )}
      {court && (
        <span className="card-court">
          <span className="card-court-half">{court}</span>
          <span className="card-court-half card-court-half--flip">{court}</span>
        </span>
      )}
    </div>
  );
}
