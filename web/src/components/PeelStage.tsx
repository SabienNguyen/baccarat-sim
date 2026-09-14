import type { ReactNode } from "react";
import { useEffect } from "react";
import type { RoundSnapshot, GlossaryEntry, CommandError, HandView } from "../engine/types";
import type { Flip } from "../cards";
import { DealerLine } from "./DealerLine";
import { Hand } from "./Hand";
import "./peelstage.css";

type DealerError = CommandError | { Message: string };

export interface PeelStageHand {
  hand: HandView;
  visibleCount: number;
  winner: boolean;
  squeezable: boolean;
  onPeek: (index: number) => void;
  onReveal: (index: number) => void;
  /** The "ask the dealer" flip request, when it's this hand's to offer. */
  actions?: ReactNode;
}

interface PeelStageProps {
  snapshot: RoundSnapshot;
  lastError?: DealerError | null;
  lastFlip?: Flip | null;
  announcement?: string | null;
  player: PeelStageHand;
  banker: PeelStageHand;
  /** Term→entry lookup, forwarded to the compact dealer line (tests). */
  lookup?: (term: string) => GlossaryEntry | undefined;
}

/** T8b — "once the bets are in only the view of the cards matters": on
 *  phones (coarse pointer or a narrow viewport) this stage takes the whole
 *  viewport for the Dealing phase, bringing the Player and Banker hands up
 *  large and centred instead of leaving them at their normal, much smaller,
 *  felt size. It sits UNDER the pinned action bar (see peelstage.css's
 *  z-index against theme.css's 45), so Reveal/Explain stay reachable. Body
 *  scroll is locked for as long as it's mounted, restored on unmount; the
 *  stage itself unmounts the moment the phase leaves Dealing — Settled shows
 *  the ordinary felt with the outcome. Squeeze/peek/flip logic is untouched:
 *  this renders the same DealerLine and Hand components the normal felt
 *  does, just in a different container. */
export function PeelStage({
  snapshot,
  lastError = null,
  lastFlip = null,
  announcement = null,
  player,
  banker,
  lookup,
}: PeelStageProps) {
  useEffect(() => {
    // `<body>` alone doesn't stop the viewport from scrolling — the root
    // scrolling element is `<html>`, and only locking both keeps a stray
    // touch-scroll (or window.scrollTo) from moving the page while the
    // stage is up.
    const prevBody = document.body.style.overflow;
    const prevHtml = document.documentElement.style.overflow;
    document.body.style.overflow = "hidden";
    document.documentElement.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prevBody;
      document.documentElement.style.overflow = prevHtml;
    };
  }, []);

  // A hand that has drawn (and shown) its third card needs the tighter card
  // step so 3-a-side still fits a 360px-wide phone — see peelstage.css.
  const cardsOf = (h: PeelStageHand) => Math.min(h.hand.cards.length, h.visibleCount);
  const maxCards = Math.max(cardsOf(player), cardsOf(banker));

  return (
    <div className="peel-stage" data-cards={maxCards >= 3 ? "3" : "2"}>
      <DealerLine
        snapshot={snapshot}
        lastError={lastError}
        lastFlip={lastFlip}
        announcement={announcement}
        lookup={lookup}
        compact
      />
      <div className="peel-stage-hands">
        <Hand
          side="Player"
          hand={player.hand}
          phase={snapshot.phase}
          visibleCount={player.visibleCount}
          winner={player.winner}
          squeezable={player.squeezable}
          onPeek={player.onPeek}
          onReveal={player.onReveal}
          actions={player.actions}
        />
        <Hand
          side="Banker"
          hand={banker.hand}
          phase={snapshot.phase}
          visibleCount={banker.visibleCount}
          winner={banker.winner}
          squeezable={banker.squeezable}
          onPeek={banker.onPeek}
          onReveal={banker.onReveal}
          actions={banker.actions}
        />
      </div>
    </div>
  );
}
