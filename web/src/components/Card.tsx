import type { ReactNode } from "react";
import type { CardView, Rank, Suit } from "../engine/types";
import { RANK_SHORT, SUIT_GLYPH, PIP_LAYOUT, COURT_GLYPH, suitColor } from "../cardArt";
import "./cards.css";

/** The printed face of a card: corner indices plus pips or a court figure.
 *  `coverIndices` is the squeezer's thumbs: during a peel the corner
 *  numbers stay hidden — you read the pips, the rank waits for the flip. */
function FaceContent({
  rank,
  suit,
  coverIndices = false,
}: {
  rank: Rank;
  suit: Suit;
  coverIndices?: boolean;
}) {
  const pips = PIP_LAYOUT[rank];
  const court = COURT_GLYPH[rank];
  return (
    <>
      {!coverIndices && (
        <>
          <span className="card-index card-index--tl">
            <span className="card-rank">{RANK_SHORT[rank]}</span>
            <span className="card-index-suit">{SUIT_GLYPH[suit]}</span>
          </span>
          <span className="card-index card-index--br">
            <span className="card-rank">{RANK_SHORT[rank]}</span>
            <span className="card-index-suit">{SUIT_GLYPH[suit]}</span>
          </span>
        </>
      )}
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
  /** Your own card at rest lies flat after a peek (set back down like a
   *  real squeeze); without this, a peeked card shows the held bend —
   *  how the rest of the table sees a card someone has looked at. */
  restFlat?: boolean;
}

/** The squeeze: the flap IS the card coming off the table. The window it
 *  leaves shows the felt; the bent-up part shows the card's underside —
 *  blank stock while face-down, the printed face once peeked, placed by
 *  the fold's layout shift so the near edge reads at the tip.
 *
 *  NO transforms inside the clipped spans: GPU compositing promotes
 *  transformed children to their own layers and drops the ancestor
 *  clip-path — the face then paints outside the flap. Layout offsets and
 *  gradients only. */
function Peel({ fold, children }: { fold: Fold; children?: ReactNode }) {
  return (
    <>
      {/* the table showing through where the card has lifted away */}
      <span className="card-peel-under" style={{ clipPath: fold.clip }} />
      {/* the lifted card itself: a leaf attached at the crease, its tip
          chasing the finger */}
      <span className="card-peel-flap" style={{ clipPath: fold.flapClip }}>
        {children && (
          <span className="card-peel-flap-face" style={fold.faceShift}>
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
        {/* the squeezer's thumb pressing where the rank index would read —
            one per index corner; whichever lands on the flap shows, the
            other is clipped away (positions ride the same layout shift) */}
        {fold.grip === "edge" && (
          <>
            <span
              className="card-peel-thumb"
              style={{ left: `calc(${fold.faceShift.left} + 13%)`, top: `calc(${fold.faceShift.top} + 12%)` }}
            />
            <span
              className="card-peel-thumb"
              style={{ left: `calc(${fold.faceShift.left} + 87%)`, top: `calc(${fold.faceShift.top} + 88%)` }}
            />
          </>
        )}
      </span>
    </>
  );
}

export function Card({ card, fold = null, restFlat = false }: CardProps) {
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
      transform: `perspective(640px) rotate3d(${ax}, ${ay}, 0, ${(16 * p).toFixed(1)}deg) scale(${(1 + 0.02 * p).toFixed(3)})`,
      transformOrigin: `${(50 + 50 * Math.sin(phi)).toFixed(1)}% ${(50 - 50 * Math.cos(phi)).toFixed(1)}%`,
      filter: `drop-shadow(0 ${(3 + 9 * p).toFixed(1)}px ${(2 + 6 * p).toFixed(1)}px rgba(0, 0, 0, ${(0.4 - 0.18 * p).toFixed(2)}))`,
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
    const active = fold ?? (restFlat ? null : HELD_FOLD);
    return (
      <div key="back" className="card card-back" aria-label={`peeked card, ${suit}`} style={squeeze}>
        {active && (
          <Peel fold={active}>
            {/* the real printed face on the flap: pip edges and legs only —
                the thumbs cover the indices until the card turns */}
            <span className="card-peel-face" data-color={suitColor(suit)}>
              <FaceContent rank={rank} suit={suit} coverIndices />
            </span>
          </Peel>
        )}
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
