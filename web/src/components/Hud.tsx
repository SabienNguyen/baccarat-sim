import type { RoundSnapshot } from "../engine/types";
import { betLabel } from "../betKind";
import { formatCents } from "../format";
import { VolumeControl } from "./VolumeControl";
import "./hud.css";

interface HudProps {
  snapshot: RoundSnapshot;
  /** Beat-the-table target, if this table has one. */
  goal?: number | null;
  onResetBankroll?: () => void;
  onLeave?: () => void;
}

/** Format a signed net amount, e.g. 500 -> "+$5.00", -500 -> "-$5.00". */
function formatNet(net: number): string {
  return net >= 0 ? `+${formatCents(net)}` : formatCents(net);
}

// Labels come from `betKind.ts` so the ledger, the dealer's call and the settle
// notes name a bet the same way — and so the two Dragon Bonus sides don't both
// render as a bare "DragonBonus".

export function Hud({ snapshot, goal, onResetBankroll, onLeave }: HudProps) {
  const progress = goal ? Math.min(snapshot.bankroll / goal, 1) : 0;
  return (
    <section aria-label="HUD" className="hud panel">
      <h1 className="hud-title">Baccarat Simulator</h1>

      <div className="hud-box hud-box--bankroll">
        <span className="hud-box-label">Bankroll</span>
        <span className="hud-box-value">{formatCents(snapshot.bankroll)}</span>
      </div>

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
        <span className="hud-box-value hud-box-value--phase">{snapshot.phase}</span>
      </div>

      <div className="hud-box">
        <span className="hud-box-label">Table limits</span>
        <span className="hud-box-value hud-box-value--small">
          {formatCents(snapshot.table_min)} – {formatCents(snapshot.table_max)}
        </span>
      </div>

      {snapshot.outcome !== null && (
        <div className="hud-box hud-box--outcome">
          <span className="hud-box-label">Outcome</span>
          <span className="hud-box-value hud-box-value--small">{snapshot.outcome}</span>
        </div>
      )}

      {snapshot.payouts !== null && (
        <ul aria-label="payouts" className="hud-payouts">
          {snapshot.payouts.map((p, i) => (
            <li key={i}>
              <span className="hud-payout-bet">{betLabel(p.bet.kind)}</span>
              <span className={`hud-payout-net ${p.net >= 0 ? "is-win" : "is-loss"}`}>
                {formatNet(p.net)}
              </span>
            </li>
          ))}
        </ul>
      )}

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
