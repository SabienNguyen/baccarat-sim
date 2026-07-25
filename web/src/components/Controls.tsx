import type { RoundSnapshot } from "../engine/types";
import "./controls.css";

interface ControlsProps {
  snapshot: RoundSnapshot;
  onDeal: () => void;
  /** Flip everything (single player; live tables follow squeeze rights). */
  onRevealAll?: () => void;
  onSettle?: () => void;
  onNewHand?: () => void;
  onNewShoe: () => void;
  explainOn?: boolean;
  onToggleExplain?: () => void;
  /** Skip this coup (multiplayer tables). */
  onSitOut?: () => void;
  /** Deal a coup with nothing staked, to watch the shoe (single player). */
  onWatch?: () => void;
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
  onSitOut,
  onWatch,
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
      {onSitOut && (
        <button type="button" className="btn btn--sitout" disabled={!betting} onClick={onSitOut}>
          Sit out
        </button>
      )}
      {/* Stand and watch a coup with nothing down, like you can at a real table.
          Only offered while the felt is empty — once you've bet, Deal is the move. */}
      {onWatch && !hasBets && (
        <button type="button" className="btn btn--sitout" disabled={!betting} onClick={onWatch}>
          Watch hand
        </button>
      )}
      {onRevealAll && (
        <button type="button" className="btn" disabled={!dealing} onClick={onRevealAll}>
          Reveal all
        </button>
      )}
      {onSettle && (
        <button type="button" className="btn" disabled={!dealing} onClick={onSettle}>
          Settle
        </button>
      )}
      {onNewHand && (
        <button type="button" className="btn" disabled={!settled} onClick={onNewHand}>
          Next hand
        </button>
      )}
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
    </section>
  );
}
