import type { Side, HandView, PhaseTag } from "../engine/types";
import { Card } from "./Card";
import { SqueezeCard } from "./SqueezeCard";

interface HandProps {
  side: Side;
  hand: HandView;
  phase: PhaseTag;
  /** How many cards to show (prefix). Defaults to all — gates the third card. */
  visibleCount?: number;
  onPeek?: (index: number) => void;
  onReveal?: (index: number) => void;
}

export function Hand({ side, hand, phase, visibleCount, onPeek, onReveal }: HandProps) {
  const dealing = phase === "Dealing";
  const shown = hand.cards.slice(0, visibleCount ?? hand.cards.length);
  return (
    <div aria-label={`${side} hand`}>
      <h3>{side}</h3>
      <ul>
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
      {hand.total !== null && <p>Total: {hand.total}</p>}
    </div>
  );
}
