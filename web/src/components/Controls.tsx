import type { RoundSnapshot } from "../engine/types";

interface ControlsProps {
  snapshot: RoundSnapshot;
  onDeal: () => void;
  onRevealAll: () => void;
  onSettle: () => void;
  onNewShoe: () => void;
}

export function Controls({
  snapshot,
  onDeal,
  onRevealAll,
  onSettle,
  onNewShoe,
}: ControlsProps) {
  const betting = snapshot.phase === "Betting";
  const dealing = snapshot.phase === "Dealing";
  const hasBets = snapshot.bets.length > 0;

  return (
    <section aria-label="Controls">
      <button type="button" disabled={!betting || !hasBets} onClick={onDeal}>
        Deal
      </button>
      <button type="button" disabled={!dealing} onClick={onRevealAll}>
        Reveal all
      </button>
      <button type="button" disabled={!dealing} onClick={onSettle}>
        Settle
      </button>
      <button type="button" onClick={onNewShoe}>
        New Shoe
      </button>
    </section>
  );
}
