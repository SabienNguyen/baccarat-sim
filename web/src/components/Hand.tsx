import type { Side, HandView, PhaseTag } from "../engine/types";
import { Card } from "./Card";
import { SqueezeCard } from "./SqueezeCard";

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
  return (
    <div aria-label={`${side} hand`} className="hand">
      <h3>{side}</h3>
      <ul className="hand-cards">
        {shown.map((card, i) => (
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
        ))}
      </ul>
      {hand.total !== null && (
        // keyed by the value so the slam-in replays whenever the total lands
        <p className="hand-total-badge" key={hand.total}>
          <span className="hand-total-label">Total</span>
          <span className={`hand-total-num ${winner ? "hand-total-num--win" : ""}`}>
            {hand.total}
          </span>
        </p>
      )}
    </div>
  );
}
