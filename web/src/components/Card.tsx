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

import type { PeelGrip } from "../squeeze";

export type { PeelGrip };

interface CardProps {
  card: CardView;
  /** 0..1 bend progress while squeezing; drives the visible peel. */
  bend?: number;
  /** Where the player grabbed; the peel folds from there. */
  grip?: PeelGrip;
}

/** Clip-path for a fold of `size`: corner grips fold a triangle, edge grips
 *  peel a straight strip back — the long-edge squeeze. */
function foldClip(grip: PeelGrip, size: string): string {
  switch (grip) {
    case "tl":
      return `polygon(0 0, ${size} 0, 0 ${size})`;
    case "tr":
      return `polygon(calc(100% - ${size}) 0, 100% 0, 100% ${size})`;
    case "bl":
      return `polygon(0 calc(100% - ${size}), 0 100%, ${size} 100%)`;
    case "br":
      return `polygon(100% calc(100% - ${size}), 100% 100%, calc(100% - ${size}) 100%)`;
    case "top":
      return `polygon(0 0, 100% 0, 100% ${size}, 0 ${size})`;
    case "bottom":
      return `polygon(0 calc(100% - ${size}), 100% calc(100% - ${size}), 100% 100%, 0 100%)`;
    case "left":
      return `polygon(0 0, ${size} 0, ${size} 100%, 0 100%)`;
    case "right":
      return `polygon(calc(100% - ${size}) 0, 100% 0, 100% 100%, calc(100% - ${size}) 100%)`;
  }
}

/** Tilt direction so the grabbed spot visibly lifts. */
const TILT: Record<PeelGrip, number> = {
  tl: -4,
  tr: 4,
  bl: 3,
  br: -3,
  top: 0,
  bottom: 0,
  left: -2,
  right: 2,
};

/** The squeezed fold: the card stock curling back as you bend it. */
function Peel({
  bend,
  grip,
  children,
}: {
  bend: number;
  grip: PeelGrip;
  children?: ReactNode;
}) {
  if (bend <= 0) return null;
  // edge strips read sooner than corner triangles, so they grow a bit slower
  const corner = grip.length === 2;
  const size = corner
    ? `${Math.round(16 + bend * 70)}%`
    : `${Math.round(12 + bend * 58)}%`;
  return (
    <span
      className={`card-peel-under card-peel-under--${grip}`}
      style={{ clipPath: foldClip(grip, size) }}
    >
      {children}
      {/* curvature shading toward the crease */}
      <span className={`card-peel-shade card-peel-shade--${grip}`} />
    </span>
  );
}

export function Card({ card, bend = 0, grip = "tl" }: CardProps) {
  // The whole card tilts and lifts a little while it's being squeezed.
  const squeeze =
    bend > 0
      ? {
          transform: `rotate(${(TILT[grip] * bend).toFixed(2)}deg) translateY(${(-bend * 6).toFixed(1)}px)`,
        }
      : undefined;

  if (card === "FaceDown") {
    return (
      <div key="back" className="card card-back" aria-label="face-down card" style={squeeze}>
        {/* the fold grows, but reveals nothing yet */}
        <Peel bend={bend} grip={grip} />
      </div>
    );
  }

  if ("Peeked" in card) {
    const { suit, rank } = card.Peeked.sliver;
    const held = Math.max(bend, 0.35);
    return (
      <div key="back" className="card card-back" aria-label={`peeked card, ${suit}`} style={squeeze}>
        <Peel bend={held} grip={grip}>
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
