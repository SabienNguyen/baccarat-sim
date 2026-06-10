import { formatCents } from "../format";
import type { SeatView } from "./protocol";
import "./multiplayer.css";

interface SeatsStripProps {
  seats: SeatView[];
  squeezers: { player: number | null; banker: number | null } | null;
  /** Betting phase: undecided seats show as waiting. */
  betting: boolean;
}

/** Everyone at the table: name, roll, stake, and who holds the cards. */
export function SeatsStrip({ seats, squeezers, betting }: SeatsStripProps) {
  return (
    <div className="seats-strip" aria-label="Seats">
      {seats.map((s) => {
        const holding =
          squeezers?.player === s.id ? "Player" : squeezers?.banker === s.id ? "Banker" : null;
        return (
          <div key={s.id} className={`seat-chip ${holding ? "seat-chip--holding" : ""}`}>
            {holding && <span className="seat-cards">🂠 {holding} cards</span>}
            <span className="seat-name">{s.name}</span>
            <span className="seat-money">{formatCents(s.bankroll)}</span>
            {s.staked > 0 && <span className="seat-staked">{formatCents(s.staked)} riding</span>}
            {betting && s.sitting_out && <span className="seat-status">sitting out</span>}
            {betting && !s.decided && <span className="seat-status seat-status--wait">waiting…</span>}
          </div>
        );
      })}
    </div>
  );
}
