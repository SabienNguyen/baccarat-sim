import type { BonusHit } from "../bonusNudge";
import "./bonusnudge.css";

interface BonusNudgeProps {
  hit: BonusHit;
  onDismiss: () => void;
}

/**
 * The "you would've won" notice: names a side bet that just hit but wasn't
 * placed, and what it pays, so a learner discovers the bonus menu exists.
 *
 * Deliberately informational only — it does NOT offer to place that bet. A bonus
 * hitting says nothing about the next coup (each one is independent), and the
 * side bets carry the worst edges on the table (pairs 10.36%, Panda 8 10.19%),
 * so prompting a chase right after a hit would teach exactly the wrong lesson.
 */
export function BonusNudge({ hit, onDismiss }: BonusNudgeProps) {
  return (
    <div className="bonus-nudge" role="status" aria-label={`${hit.label} would have won`}>
      <button type="button" className="bonus-nudge-x" aria-label="Dismiss" onClick={onDismiss}>
        ✕
      </button>
      <span className="bonus-nudge-title">{hit.label} JUST HIT!</span>
      <span className="bonus-nudge-note">that bonus pays {hit.payout}</span>
    </div>
  );
}
