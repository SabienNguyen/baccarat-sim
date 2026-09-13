import { useEffect, useState } from "react";
import { formatCents } from "../format";
import { track } from "../analytics";
import { getPortal, type PortalAdapter } from "../portal";
import "./bust.css";

interface BustModalProps {
  bankroll: number;
  tableMin: number;
  /** Buy back in at this table's starting roll. */
  onRebuy: () => void;
  /** Back to the lobby; the caller clears the dead roll on the way out. */
  onLeave: () => void;
  /** The game portal, if any (injectable for tests). */
  portal?: PortalAdapter;
}

/** The run is lost: the roll can no longer post the table minimum. */
export function BustModal({
  bankroll,
  tableMin,
  onRebuy,
  onLeave,
  portal = getPortal(),
}: BustModalProps) {
  useEffect(() => track("bust"), []);
  // On a portal with rewarded ads the fresh buy-in is earned by watching one;
  // the free re-buy stays as the fallback. Without a portal: unchanged.
  const rewarded = portal.canShowRewardedAd();
  const [adState, setAdState] = useState<"idle" | "pending" | "unavailable">("idle");
  const watchAd = async () => {
    setAdState("pending");
    let watched = false;
    try {
      watched = await portal.requestRewardedAd();
    } catch {
      watched = false;
    }
    if (watched) {
      track("rewarded-rebuy");
      onRebuy();
    } else {
      setAdState("unavailable");
    }
  };
  return (
    <div className="bust-backdrop">
      <div role="dialog" aria-label="Busted" className="bust-modal panel">
        <h2 className="bust-title">BUSTED</h2>
        <p className="bust-amount">{formatCents(bankroll)}</p>
        <p className="bust-sub">
          The minimum here is {formatCents(tableMin)}. The pit boss offers his
          condolences — and nothing else.
        </p>
        {adState === "unavailable" && (
          <p className="bust-noad" role="status">
            No ad available right now
          </p>
        )}
        <div className="bust-actions">
          <button type="button" className="btn" onClick={onLeave}>
            Leave table
          </button>
          <button
            type="button"
            className={rewarded ? "btn" : "btn btn--gold"}
            onClick={onRebuy}
          >
            Re-buy
          </button>
          {rewarded && (
            <button
              type="button"
              className="btn btn--gold"
              disabled={adState === "pending"}
              onClick={() => void watchAd()}
            >
              Watch an ad for a fresh buy-in
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
