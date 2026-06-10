import { formatCents } from "../format";
import "./victory.css";

interface VictoryModalProps {
  bankroll: number;
  goal: number;
  /** Keep grinding this table. */
  onKeepPlaying: () => void;
  /** Back to the lobby (to move up a tier). */
  onLobby: () => void;
}

/** The run is won: the buy-in beat the table's goal. */
export function VictoryModal({ bankroll, goal, onKeepPlaying, onLobby }: VictoryModalProps) {
  return (
    <div className="victory-backdrop">
      <div role="dialog" aria-label="Table beaten" className="victory-modal panel">
        <h2 className="victory-title">TABLE BEATEN!</h2>
        <p className="victory-amount">{formatCents(bankroll)}</p>
        <p className="victory-sub">
          You ran the buy-in past {formatCents(goal)}. The pit boss is watching.
        </p>
        <div className="victory-actions">
          <button type="button" className="btn" onClick={onKeepPlaying}>
            Keep playing
          </button>
          <button type="button" className="btn btn--gold" onClick={onLobby}>
            Back to lobby
          </button>
        </div>
      </div>
    </div>
  );
}
