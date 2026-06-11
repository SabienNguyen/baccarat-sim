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

/** The squeeze: the flap IS the card coming off the table. The window it
 *  leaves shows the felt; the bent-up part shows the card's underside —
 *  blank stock while face-down, the printed face (rotated 180° by the
 *  fold, so the near edge reads at the tip) once peeked. */
function Peel({ fold, children }: { fold: Fold; children?: ReactNode }) {
  const phi = (fold.angle * Math.PI) / 180;
  return (
    <>
      {/* the table showing through where the card has lifted away */}
      <span className="card-peel-under" style={{ clipPath: fold.clip }} />
      {/* the lifted card itself, hinged in 3D at the crease: steep on a
          light pull, laying flatter as it deepens, tip chasing the finger.
          It projects its own perspective — the card's drop-shadow filter
          forces transform-style flat, so no shared 3D context exists. */}
      <span
        className="card-peel-flap"
        style={{
          clipPath: fold.flapClip,
          transformOrigin: fold.origin,
          transform: `perspective(520px) rotate3d(${Math.cos(phi).toFixed(3)}, ${Math.sin(phi).toFixed(3)}, 0, ${(-78 * Math.pow(1 - fold.progress, 1.3)).toFixed(1)}deg)`,
        }}
      >
        {children && (
          <span
            className="card-peel-flap-face"
            style={{ transformOrigin: fold.origin, transform: "rotate(180deg)" }}
          >
            {children}
          </span>
        )}
        {/* curvature: shadow rolling over the crease, sheen at the tip */}
        <span
          className="card-peel-shade"
          style={{
            background: `linear-gradient(${fold.angle.toFixed(1)}deg, rgba(40, 30, 15, 0.5) 3%, transparent 45%, rgba(255, 252, 240, 0.3) 97%)`,
          }}
        />
      </span>
    </>
  );
}

export function Card({ card, fold = null }: CardProps) {
  // While squeezed, the card comes off the table: it tips up around the
  // edge opposite the pull (which stays resting on the felt), grows
  // slightly toward the camera, and its shadow separates beneath it.
  let squeeze;
  if (fold) {
    const phi = (fold.angle * Math.PI) / 180;
    const p = fold.progress;
    // the hinge axis runs along the crease; the grabbed side rises
    const ax = Math.cos(phi).toFixed(3);
    const ay = Math.sin(phi).toFixed(3);
    squeeze = {
      transform: `perspective(640px) rotate3d(${ax}, ${ay}, 0, ${(16 * p).toFixed(1)}deg) scale(${(1 + 0.05 * p).toFixed(3)})`,
      transformOrigin: `${(50 + 50 * Math.sin(phi)).toFixed(1)}% ${(50 - 50 * Math.cos(phi)).toFixed(1)}%`,
      filter: `drop-shadow(0 ${(3 + 16 * p).toFixed(1)}px ${(2 + 9 * p).toFixed(1)}px rgba(0, 0, 0, ${(0.45 - 0.15 * p).toFixed(2)}))`,
      zIndex: 3,
    };
  }

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
