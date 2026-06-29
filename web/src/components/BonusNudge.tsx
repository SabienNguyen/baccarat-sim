import type { BonusHit } from "../bonusNudge";
import "./bonusnudge.css";

interface BonusNudgeProps {
  hit: BonusHit;
  /** e.g. "bet $25 next hand" — uses the armed chip. */
  betLabel: string;
  onBet: () => void;
  onDismiss: () => void;
}

/** The "you would've won" toast: teaches an unbet bonus that just hit and
 *  offers to place it on the next hand with one tap. */
export function BonusNudge({ hit, betLabel, onBet, onDismiss }: BonusNudgeProps) {
  return (
    <div className="bonus-nudge" role="status" aria-label={`${hit.label} would have won`}>
      <button type="button" className="bonus-nudge-x" aria-label="Dismiss" onClick={onDismiss}>
        ✕
      </button>
      <span className="bonus-nudge-title">{hit.label} JUST HIT!</span>
      <button type="button" className="bonus-nudge-cta" onClick={onBet}>
        pays {hit.payout} — {betLabel} →
      </button>
    </div>
  );
}
