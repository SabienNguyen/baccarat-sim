import { formatCents } from "../format";
import type { SeatView } from "./protocol";
import "./multiplayer.css";

/** Everyone at the table: name, roll, and what they've got riding. */
export function SeatsStrip({ seats }: { seats: SeatView[] }) {
  return (
    <div className="seats-strip" aria-label="Seats">
      {seats.map((s) => (
        <div key={s.id} className="seat-chip">
          <span className="seat-name">{s.name}</span>
          <span className="seat-money">{formatCents(s.bankroll)}</span>
          {s.staked > 0 && <span className="seat-staked">{formatCents(s.staked)} riding</span>}
        </div>
      ))}
    </div>
  );
}
