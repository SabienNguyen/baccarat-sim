import type { ReactNode } from "react";
import { useEffect, useState } from "react";
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
  /** True once the parent has decided this overlay is on its way out (the
   *  phase already left Dealing) — drives the 150ms fade-out. The parent
   *  keeps this mounted for that long before removing it from the tree. */
  leaving?: boolean;
}

/** T8b (revised — owner direction 2026-09-13): "instead of going to a
 *  different view, make it so it's just a slightly faded and darkened
 *  background and the cards come back to the front". This renders as an
 *  OVERLAY above the normal felt, not a replacement view: a translucent,
 *  slightly blurred backdrop fades in over the still-mounted page (HUD, bet
 *  rail, roads all stay behind it, dimmed), and this component's own compact
 *  dealer line + large Player/Banker hands sit on top of the backdrop,
 *  scaling in from 0.85 to read as the cards coming forward. It sits UNDER
 *  the pinned action bar (see peelstage.css's z-index against theme.css's
 *  45), so Reveal/Explain stay reachable. Body scroll is locked for as long
 *  as it's mounted, restored on unmount. The inline felt's own Player/Banker
 *  `Hand`s stay mounted too (App.tsx never swaps them out — only visually
 *  hides them) so this is purely an additional layer, not a parallel state
 *  machine: squeeze/peek/flip logic here is the same `Hand`/`SqueezeCard`
 *  the ordinary felt uses. */
export function PeelStage({
  snapshot,
  lastError = null,
  lastFlip = null,
  announcement = null,
  player,
  banker,
  lookup,
  leaving = false,
}: PeelStageProps) {
  // Enter transition: mount at the "not shown" state, then flip to "shown"
  // one frame later so the CSS opacity/scale transition actually animates
  // instead of snapping in already-visible.
  const [entered, setEntered] = useState(false);
  useEffect(() => {
    const id = requestAnimationFrame(() => setEntered(true));
    return () => cancelAnimationFrame(id);
  }, []);

  useEffect(() => {
    // `<body>` alone doesn't stop the viewport from scrolling — the root
    // scrolling element is `<html>`, and only locking both keeps a stray
    // touch-scroll (or window.scrollTo) from moving the page while the
    // overlay is up.
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

  const stageClass = [
    "peel-stage",
    entered && !leaving ? "peel-stage--visible" : "",
    leaving ? "peel-stage--leaving" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={stageClass} data-cards={maxCards >= 3 ? "3" : "2"}>
      <div className="peel-backdrop" />
      <div className="peel-stage-content">
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
    </div>
  );
}
