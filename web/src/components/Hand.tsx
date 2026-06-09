import type { Side, HandView, CardView } from "../engine/types";

interface HandProps {
  side: Side;
  hand: HandView;
}

function describeCard(card: CardView): string {
  if (card === "FaceDown") return "🂠";
  if ("Peeked" in card) return `Peeked: ${card.Peeked.sliver.suit}`;
  return `${card.FaceUp.rank} of ${card.FaceUp.suit}`;
}

export function Hand({ side, hand }: HandProps) {
  return (
    <div aria-label={`${side} hand`}>
      <h3>{side}</h3>
      <ul>
        {hand.cards.map((card, i) => (
          <li key={i}>{describeCard(card)}</li>
        ))}
      </ul>
      {hand.total !== null && <p>Total: {hand.total}</p>}
    </div>
  );
}
