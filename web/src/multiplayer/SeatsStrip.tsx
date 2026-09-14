import { useEffect, useRef, useState } from "react";
import { formatCents } from "../format";
import type { SeatView } from "./protocol";
import { seatColour } from "./seatColour";
import { betSpotLabel } from "../components/BetRail";
import "./multiplayer.css";

/** The server caps names here too; matching it keeps the box honest. */
const NAME_MAX = 24;

interface SeatsStripProps {
  seats: SeatView[];
  /** This client's own seat id — that chip becomes a rename control. */
  me?: number | null;
  squeezers: { player: number | null; banker: number | null } | null;
  /** Betting phase: undecided seats show as waiting. */
  betting: boolean;
  /** Settled phase: the payouts show in place of the staged-bet tokens. */
  settled?: boolean;
  /** Commit a new name for our own seat. */
  onRename?: (name: string) => void;
  /** Spectators at the rail; shown as one more chip when there are any. */
  watchers?: number | null;
}

/** Everyone at the table: name, roll, stake, who holds the cards — and how
 *  many are standing behind them watching. */
export function SeatsStrip({
  seats,
  me = null,
  squeezers,
  betting,
  settled = false,
  onRename,
  watchers = null,
}: SeatsStripProps) {
  return (
    <div className="seats-strip" aria-label="Seats">
      {seats.map((s) => {
        const holding =
          squeezers?.player === s.id ? "Player" : squeezers?.banker === s.id ? "Banker" : null;
        const mine = me !== null && s.id === me && onRename !== undefined;
        return (
          <div
            key={s.id}
            className={`seat-chip ${holding ? "seat-chip--holding" : ""} ${mine ? "seat-chip--mine" : ""}`}
            style={{ "--seat-colour": seatColour(s.id) } as React.CSSProperties}
          >
            {holding && <span className="seat-cards">🂠 {holding} cards</span>}
            {mine ? (
              <SeatName name={s.name} onRename={onRename} />
            ) : (
              <span className="seat-name">{s.name}</span>
            )}
            <span className="seat-money">{formatCents(s.bankroll)}</span>
            {s.staked > 0 && <span className="seat-staked">{formatCents(s.staked)} riding</span>}
            {!settled && s.bets.length > 0 && (
              <span className="seat-bets">
                {s.bets.map((b, i) => (
                  <span className="seat-bet" key={i}>
                    {betSpotLabel(b.kind)} {formatCents(b.amount)}
                  </span>
                ))}
              </span>
            )}
            {betting && s.ready && (
              <span className="seat-ready" aria-label="ready">
                ✓
              </span>
            )}
            {betting && s.sitting_out && <span className="seat-status">sitting out</span>}
            {betting && !s.decided && <span className="seat-status seat-status--wait">waiting…</span>}
          </div>
        );
      })}
      {watchers !== null && watchers > 0 && (
        <div className="seat-chip seat-chip--rail" aria-label="Watching">
          <span className="seat-name">👁 {watchers}</span>
          <span className="seat-status">watching</span>
        </div>
      )}
    </div>
  );
}

/**
 * Our own name, as a button that turns into a text box. Enter or leaving the
 * box commits; Escape puts the old name back. The server answers with a fresh
 * view, so the label updates from the table's truth, not from local state.
 */
function SeatName({ name, onRename }: { name: string; onRename: (name: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(name);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) input.current?.select();
  }, [editing]);

  const commit = () => {
    setEditing(false);
    const next = draft.trim();
    if (next.length > 0 && next !== name) onRename(next);
  };

  if (editing) {
    return (
      <input
        ref={input}
        className="seat-name seat-name--edit"
        aria-label="Your name"
        value={draft}
        maxLength={NAME_MAX}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit();
          if (e.key === "Escape") {
            setDraft(name);
            setEditing(false);
          }
        }}
      />
    );
  }
  return (
    <button
      type="button"
      className="seat-name seat-name--mine"
      title="Change your name"
      aria-label={`${name} — change your name`}
      onClick={() => {
        setDraft(name);
        setEditing(true);
      }}
    >
      {name}
    </button>
  );
}
