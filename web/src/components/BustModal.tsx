import { formatCents } from "../format";
import "./bust.css";

interface BustModalProps {
  bankroll: number;
  tableMin: number;
  /** Buy back in at this table's starting roll. */
  onRebuy: () => void;
  /** Back to the lobby; the caller clears the dead roll on the way out. */
  onLeave: () => void;
}

/** The run is lost: the roll can no longer post the table minimum. */
export function BustModal({ bankroll, tableMin, onRebuy, onLeave }: BustModalProps) {
  return (
    <div className="bust-backdrop">
      <div role="dialog" aria-label="Busted" className="bust-modal panel">
        <h2 className="bust-title">BUSTED</h2>
        <p className="bust-amount">{formatCents(bankroll)}</p>
        <p className="bust-sub">
          The minimum here is {formatCents(tableMin)}. The pit boss offers his
          condolences — and nothing else.
        </p>
        <div className="bust-actions">
          <button type="button" className="btn" onClick={onLeave}>
            Leave table
          </button>
          <button type="button" className="btn btn--gold" onClick={onRebuy}>
            Re-buy
          </button>
        </div>
      </div>
    </div>
  );
}
