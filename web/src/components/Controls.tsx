import type { RoundSnapshot } from "../engine/types";
import "./controls.css";

interface ControlsProps {
  snapshot: RoundSnapshot;
  onDeal: () => void;
  onRevealAll: () => void;
  onSettle: () => void;
  onNewShoe: () => void;
  explainOn?: boolean;
  onToggleExplain?: () => void;
}

export function Controls({
  snapshot,
  onDeal,
  onRevealAll,
  onSettle,
  onNewShoe,
  explainOn,
  onToggleExplain,
}: ControlsProps) {
  const betting = snapshot.phase === "Betting";
  const dealing = snapshot.phase === "Dealing";
  const hasBets = snapshot.bets.length > 0;

  return (
    <section aria-label="Controls" className="controls">
      <button type="button" className="btn" disabled={!betting || !hasBets} onClick={onDeal}>
        Deal
      </button>
      <button type="button" className="btn" disabled={!dealing} onClick={onRevealAll}>
        Reveal all
      </button>
      <button type="button" className="btn" disabled={!dealing} onClick={onSettle}>
        Settle
      </button>
      <button type="button" className="btn" onClick={onNewShoe}>
        New Shoe
      </button>
      <button
        type="button"
        className="btn"
        aria-pressed={!!explainOn}
        onClick={onToggleExplain}
      >
        Explain
      </button>
    </section>
  );
}
