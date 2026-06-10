import type { RoundSnapshot, CommandError } from "../engine/types";
import { formatCents } from "../format";
import "./hud.css";

interface HudProps {
  snapshot: RoundSnapshot;
  lastError: CommandError | null;
}

/** Format a signed net amount, e.g. 500 -> "+$5.00", -500 -> "-$5.00". */
function formatNet(net: number): string {
  return net >= 0 ? `+${formatCents(net)}` : formatCents(net);
}

/** A short human label for a BetKind. */
function describeBet(kind: RoundSnapshot["bets"][number]["kind"]): string {
  if ("Main" in kind) return kind.Main;
  if (typeof kind.Side === "string") return kind.Side;
  return Object.keys(kind.Side)[0];
}

export function Hud({ snapshot, lastError }: HudProps) {
  return (
    <section aria-label="HUD" className="hud panel">
      <h1 className="hud-title">Baccarat Simulator</h1>
      <dl className="hud-stats">
        <dt>Bankroll</dt>
        <dd>{formatCents(snapshot.bankroll)}</dd>
        <dt>Phase</dt>
        <dd>{snapshot.phase}</dd>
        <dt>Table</dt>
        <dd>
          {formatCents(snapshot.table_min)} – {formatCents(snapshot.table_max)}
        </dd>
      </dl>

      {snapshot.outcome !== null && <p className="hud-outcome">Outcome: {snapshot.outcome}</p>}

      {snapshot.payouts !== null && (
        <ul aria-label="payouts" className="hud-payouts">
          {snapshot.payouts.map((p, i) => (
            <li key={i}>
              {describeBet(p.bet.kind)}: <span>{formatNet(p.net)}</span>
            </li>
          ))}
        </ul>
      )}

      {lastError !== null && (
        <p role="alert" className="hud-error">
          {JSON.stringify(lastError)}
        </p>
      )}
    </section>
  );
}
