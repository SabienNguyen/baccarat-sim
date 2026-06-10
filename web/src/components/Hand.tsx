import type { Side, HandView, PhaseTag } from "../engine/types";
import { Card } from "./Card";
import { SqueezeCard } from "./SqueezeCard";
import { runningTotal } from "../cards";

interface HandProps {
  side: Side;
  hand: HandView;
  phase: PhaseTag;
  /** How many cards to show (prefix). Defaults to all — gates the third card. */
  visibleCount?: number;
  /** True when this hand won the round — the total goes gold. */
  winner?: boolean;
  onPeek?: (index: number) => void;
  onReveal?: (index: number) => void;
}

export function Hand({ side, hand, phase, visibleCount, winner, onPeek, onReveal }: HandProps) {
  const dealing = phase === "Dealing";
  const shown = hand.cards.slice(0, visibleCount ?? hand.cards.length);
  // Run the total live off the face-up cards; the engine's total takes over
  // (and goes final) once every card is up.
  const total = hand.total ?? runningTotal(shown);
  const final = hand.total !== null;
  return (
    <div aria-label={`${side} hand`} className="hand">
      <h3>{side}</h3>
      <ul className="hand-cards">
        {shown.length === 0 ? (
          // empty table: dashed slots mark where the cards will land
          <>
            <li>
              <div className="card card-slot" />
            </li>
            <li>
              <div className="card card-slot" />
            </li>
          </>
        ) : (
          shown.map((card, i) => (
            <li key={i}>
              {dealing ? (
                <SqueezeCard
                  card={card}
                  onPeek={() => onPeek?.(i)}
                  onReveal={() => onReveal?.(i)}
                />
              ) : (
                <Card card={card} />
              )}
            </li>
          ))
        )}
      </ul>
      {total !== null && (
        // keyed by the value so the slam-in replays whenever the total changes
        <p className="hand-total-badge" key={total}>
          <span className="hand-total-label">Total</span>
          <span
            className={[
              "hand-total-num",
              final ? "" : "hand-total-num--running",
              winner ? "hand-total-num--win" : "",
            ]
              .filter(Boolean)
              .join(" ")}
          >
            {total}
          </span>
        </p>
      )}
    </div>
  );
}
