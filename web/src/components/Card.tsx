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

/** The printed face of a card: corner indices plus pips or a court figure. */
function FaceContent({ rank, suit }: { rank: Rank; suit: Suit }) {
  const pips = PIP_LAYOUT[rank];
  const court = COURT_GLYPH[rank];
  return (
    <>
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
    </>
  );
}

import { HELD_FOLD, type Fold } from "../squeeze";

interface CardProps {
  card: CardView;
  /** The live fold while fingers are on the card; a peeked card at rest
   *  holds a default bottom-edge bend. */
  fold?: Fold | null;
}

/** The squeezed fold: the card stock bending back along the crease. */
function Peel({ fold, children }: { fold: Fold; children?: ReactNode }) {
  return (
    <>
      <span className="card-peel-under" style={{ clipPath: fold.clip }}>
        {children}
        {/* curvature: brightness rolling into shadow at the crease */}
        <span
          className="card-peel-shade"
          style={{
            background: `linear-gradient(${fold.angle.toFixed(1)}deg, rgba(255, 255, 255, 0.35) 8%, transparent 45%, rgba(60, 50, 30, 0.4) 96%)`,
          }}
        />
      </span>
      {/* the folded-over tongue of stock, its tip riding the finger;
          shaded into shadow where it rolls over the crease */}
      <span
        className="card-peel-flap"
        style={{
          clipPath: fold.flapClip,
          background: `linear-gradient(${fold.angle.toFixed(1)}deg, #cfc5a6 4%, #f2ecd9 45%, #fbf7ec 96%)`,
        }}
      />
    </>
  );
}

export function Card({ card, fold = null }: CardProps) {
  // The whole card tilts and lifts a little while it's being squeezed:
  // the lean follows the drag direction, the lift follows the bend.
  const squeeze = fold
    ? {
        transform: `rotate(${(-3 * Math.sin((fold.angle * Math.PI) / 180) * fold.progress).toFixed(2)}deg) translateY(${(-fold.progress * 6).toFixed(1)}px)`,
      }
    : undefined;

  if (card === "FaceDown") {
    return (
      <div key="back" className="card card-back" aria-label="face-down card" style={squeeze}>
        {/* the fold grows, but reveals nothing yet */}
        {fold && <Peel fold={fold} />}
      </div>
    );
  }

  if ("Peeked" in card) {
    const { suit, rank } = card.Peeked.sliver;
    return (
      <div key="back" className="card card-back" aria-label={`peeked card, ${suit}`} style={squeeze}>
        <Peel fold={fold ?? HELD_FOLD}>
          {/* the real printed face under the fold: pip edges, legs, the index */}
          <span className="card-peel-face" data-color={suitColor(suit)}>
            <FaceContent rank={rank} suit={suit} />
          </span>
        </Peel>
      </div>
    );
  }

  const { rank, suit } = card.FaceUp;
  return (
    // a fresh element on the flip so the turn animation always plays
    <div key="face" className="card card-face" aria-label={`${rank} of ${suit}`} data-color={suitColor(suit)}>
      <FaceContent rank={rank} suit={suit} />
    </div>
  );
}
