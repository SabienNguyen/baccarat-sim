import type { RoundSnapshot } from "../engine/types";
import { betLabel } from "../betKind";
import { formatCents, outcomeLabel } from "../format";
import { VolumeControl } from "./VolumeControl";
import "./hud.css";

interface HudProps {
  snapshot: RoundSnapshot;
  /** Beat-the-table target, if this table has one. */
  goal?: number | null;
  onResetBankroll?: () => void;
  onLeave?: () => void;
  /** Watching from the rail: no bankroll to show, a seat to offer instead. */
  spectating?: boolean;
  /** Take a seat at the table being watched. */
  onTakeSeat?: () => void;
  /** Every chair is taken — the offer stays visible but can't be taken up. */
  seatsFull?: boolean;
}

/** Format a signed net amount, e.g. 500 -> "+$5.00", -500 -> "-$5.00". */
function formatNet(net: number): string {
  return net >= 0 ? `+${formatCents(net)}` : formatCents(net);
}

// Labels come from `betKind.ts` so the ledger, the dealer's call and the settle
// notes name a bet the same way — and so the two Dragon Bonus sides don't both
// render as a bare "DragonBonus".

/** Display-only label for the phase box — the wire tag itself (`data-phase`)
 *  stays untouched since hud.css keys off it. Only "ShoeCut" gets a friendlier
 *  rendering; every other tag passes through unchanged. */
function phaseLabel(tag: RoundSnapshot["phase"]): string {
  return tag === "ShoeCut" ? "Shoe cut" : tag;
}

export function Hud({
  snapshot,
  goal,
  onResetBankroll,
  onLeave,
  spectating = false,
  onTakeSeat,
  seatsFull = false,
}: HudProps) {
  const progress = goal ? Math.min(snapshot.bankroll / goal, 1) : 0;
  return (
    <section aria-label="HUD" className="hud panel">
      <h1 className="hud-title">Baccarat Simulator</h1>

      {spectating ? (
        // No chips at the rail: the money box becomes the way to get some.
        <div className="hud-box hud-box--rail">
          <span className="hud-box-label">Watching</span>
          {onTakeSeat && (
            <button
              type="button"
              className="hud-seat"
              disabled={seatsFull}
              title={seatsFull ? "Every seat is taken" : undefined}
              onClick={onTakeSeat}
            >
              {seatsFull ? "Table full" : "Take a seat"}
            </button>
          )}
        </div>
      ) : (
        <div className="hud-box hud-box--bankroll">
          <span className="hud-box-label">Bankroll</span>
          <span className="hud-box-value">{formatCents(snapshot.bankroll)}</span>
        </div>
      )}

      {goal != null && (
        <div className="hud-box hud-box--goal">
          <span className="hud-box-label">Goal {formatCents(goal)}</span>
          <span className="hud-goal-bar" aria-label="Goal progress">
            <span
              className="hud-goal-fill"
              style={{ width: `${Math.round(progress * 100)}%` }}
            />
          </span>
          <span className="hud-goal-pct">
            {progress >= 1 ? "TABLE BEATEN" : `${Math.floor(progress * 100)}%`}
          </span>
        </div>
      )}

      <div className="hud-box" data-phase={snapshot.phase}>
        <span className="hud-box-label">Phase</span>
        <span className="hud-box-value hud-box-value--phase">{phaseLabel(snapshot.phase)}</span>
      </div>

      <div className="hud-box">
        <span className="hud-box-label">Table limits</span>
        <span className="hud-box-value hud-box-value--small">
          {formatCents(snapshot.table_min)} – {formatCents(snapshot.table_max)}
        </span>
      </div>

      {/* Always mounted (P14): on phones the HUD grid gives this box a fixed
          height regardless of `data-has-outcome`, so its arrival at Settled
          doesn't push the felt down. On wider screens a `[data-has-outcome=
          "false"]` rule hides it exactly like the old conditional mount did. */}
      <div
        className="hud-box hud-box--outcome"
        data-has-outcome={snapshot.outcome !== null}
      >
        {/* The cut card is out: one more hand, then a fresh shoe. Lives in
            this row (not its own box) so the fixed-height outcome slot on
            phones (hud.css) never has to grow to fit it. */}
        {snapshot.shoe.cut_card_out && <span className="hud-last-hand">LAST HAND</span>}
        <span className="hud-box-label">Outcome</span>
        <span className="hud-box-value hud-box-value--small">
          {snapshot.outcome !== null ? outcomeLabel(snapshot.outcome) : null}
        </span>
      </div>

      <ul
        aria-label="payouts"
        className="hud-payouts"
        data-has-payouts={snapshot.payouts !== null}
      >
        {snapshot.payouts?.map((p, i) => (
          <li key={i}>
            <span className="hud-payout-bet">{betLabel(p.bet.kind)}</span>
            <span className={`hud-payout-net ${p.net >= 0 ? "is-win" : "is-loss"}`}>
              {formatNet(p.net)}
            </span>
          </li>
        ))}
      </ul>

      <VolumeControl />

      {(onResetBankroll || onLeave) && (
        <div className="hud-actions">
          {onResetBankroll && (
            <button type="button" className="hud-action" onClick={onResetBankroll}>
              Reset bank
            </button>
          )}
          {onLeave && (
            <button type="button" className="hud-action" onClick={onLeave}>
              Lobby
            </button>
          )}
        </div>
      )}
    </section>
  );
}
