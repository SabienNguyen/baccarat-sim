import type { RoundSnapshot, Side, CardView } from "../engine/types";

interface ControlsProps {
  snapshot: RoundSnapshot;
  onDeal: () => void;
  onReveal: (side: Side, index: number) => void;
  onSettle: () => void;
  onNewShoe: () => void;
}

/** Indices of cards in a hand that are not yet fully face-up (peek or face-down). */
function hiddenIndices(cards: CardView[]): number[] {
  const out: number[] = [];
  cards.forEach((card, i) => {
    const faceUp = card !== "FaceDown" && typeof card === "object" && "FaceUp" in card;
    if (!faceUp) out.push(i);
  });
  return out;
}

export function Controls({
  snapshot,
  onDeal,
  onReveal,
  onSettle,
  onNewShoe,
}: ControlsProps) {
  const betting = snapshot.phase === "Betting";
  const dealing = snapshot.phase === "Dealing";
  const hasBets = snapshot.bets.length > 0;

  const reveals: Array<{ side: Side; index: number }> = [];
  if (dealing) {
    for (const index of hiddenIndices(snapshot.player.cards)) {
      reveals.push({ side: "Player", index });
    }
    for (const index of hiddenIndices(snapshot.banker.cards)) {
      reveals.push({ side: "Banker", index });
    }
  }

  return (
    <section aria-label="Controls">
      <button type="button" disabled={!betting || !hasBets} onClick={onDeal}>
        Deal
      </button>
      {reveals.map(({ side, index }) => (
        <button
          key={`${side}-${index}`}
          type="button"
          onClick={() => onReveal(side, index)}
        >
          Reveal {side} {index}
        </button>
      ))}
      <button type="button" disabled={!dealing} onClick={onSettle}>
        Settle
      </button>
      <button type="button" onClick={onNewShoe}>
        New Shoe
      </button>
    </section>
  );
}
