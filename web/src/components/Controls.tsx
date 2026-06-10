import type { RoundSnapshot } from "../engine/types";
import "./controls.css";

interface ControlsProps {
  snapshot: RoundSnapshot;
  onDeal: () => void;
  onRevealAll: () => void;
  onSettle: () => void;
  onNewHand?: () => void;
  onNewShoe: () => void;
  explainOn?: boolean;
  onToggleExplain?: () => void;
  onResetBankroll?: () => void;
}

export function Controls({
  snapshot,
  onDeal,
  onRevealAll,
  onSettle,
  onNewHand,
  onNewShoe,
  explainOn,
  onToggleExplain,
  onResetBankroll,
}: ControlsProps) {
  const betting = snapshot.phase === "Betting";
  const dealing = snapshot.phase === "Dealing";
  const settled = snapshot.phase === "Settled";
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
      <button type="button" className="btn" disabled={!settled} onClick={onNewHand}>
        Next hand
      </button>
      <button type="button" className="btn" disabled={dealing} onClick={onNewShoe}>
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
      {onResetBankroll && (
        <button type="button" className="btn" onClick={onResetBankroll}>
          Reset bank
        </button>
      )}
    </section>
  );
}
