import { useEffect, useRef, useState } from "react";
import { formatCents } from "../format";
import type { ShoeView } from "../engine/types";
import type { SeatView } from "./protocol";
import { seatColour } from "./seatColour";
import { betSpotLabel } from "../components/BetRail";
import "./multiplayer.css";

/** The server caps names here too; matching it keeps the box honest. */
const NAME_MAX = 24;

/** No open vote, nobody's cut yet — the strip's default when a caller (or a
 *  test) has nothing shoe-shaped to pass. */
const NO_SHOE: ShoeView = {
  number: 0,
  cut_card_out: false,
  cut_reason: null,
  cutter: null,
  last_cut: null,
  vote: null,
};

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
  /** The table's shoe: the host crown and an in-progress New Shoe vote read
   *  off it. Defaults to no vote/no host when a caller has nothing to pass. */
  shoe?: ShoeView;
  /** Cast this client's own vote on the open New Shoe proposal. */
  voteNewShoe?: (yes: boolean) => void;
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
  shoe = NO_SHOE,
  voteNewShoe,
}: SeatsStripProps) {
  const vote = shoe.vote;
  return (
    <div className="seats-strip" aria-label="Seats">
      {seats.map((s) => {
        const holding =
          squeezers?.player === s.id ? "Player" : squeezers?.banker === s.id ? "Banker" : null;
        const mine = me !== null && s.id === me && onRename !== undefined;
        const myVote = vote ? (vote.yes.includes(s.id) ? "yes" : vote.no.includes(s.id) ? "no" : null) : null;
        return (
          <div
            key={s.id}
            className={`seat-chip ${holding ? "seat-chip--holding" : ""} ${mine ? "seat-chip--mine" : ""}`}
            style={{ "--seat-colour": seatColour(s.id) } as React.CSSProperties}
          >
            {holding && <span className="seat-cards">🂠 {holding} cards</span>}
            {s.host && (
              <span className="seat-host" title="Has the cut" aria-label="Has the cut">
                ♛
              </span>
            )}
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
            {myVote && (
              <span className={`seat-vote seat-vote--${myVote}`} aria-label={`voted ${myVote}`}>
                {myVote === "yes" ? "✓" : "✗"}
              </span>
            )}
          </div>
        );
      })}
      {watchers !== null && watchers > 0 && (
        <div className="seat-chip seat-chip--rail" aria-label="Watching">
          <span className="seat-name">👁 {watchers}</span>
          <span className="seat-status">watching</span>
        </div>
      )}
      {vote && (
        <div className="vote-bar" aria-label="New shoe vote">
          <span className="vote-text">
            New shoe? {vote.yes.length} of {vote.needed}
          </span>
          {me !== null && (
            <span className="vote-buttons">
              <button
                type="button"
                className="vote-btn vote-btn--yes"
                aria-label="Vote yes"
                aria-pressed={vote.yes.includes(me)}
                onClick={() => voteNewShoe?.(true)}
              >
                ✓
              </button>
              <button
                type="button"
                className="vote-btn vote-btn--no"
                aria-label="Vote no"
                aria-pressed={vote.no.includes(me)}
                onClick={() => voteNewShoe?.(false)}
              >
                ✗
              </button>
            </span>
          )}
          <span className="vote-clock" key={vote.proposer} aria-hidden="true" />
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
