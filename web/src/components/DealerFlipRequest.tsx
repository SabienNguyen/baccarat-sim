import type { FlipRequest } from "../engine/types";
import type { DealerFlipOffer } from "../dealerFlip";
import "./dealerflip.css";

interface DealerFlipRequestProps {
  /** What may still be asked for; null hides the controls entirely. */
  offer: DealerFlipOffer | null;
  onRequest: (count: FlipRequest) => void;
}

/**
 * The high-limit ask: "flip one" / "flip both" of the dealer's cards before
 * you finish your own squeeze. Sits under the house hand. After one flip the
 * single ask reads "flip the other"; once both are up, nothing renders.
 */
export function DealerFlipRequest({ offer, onRequest }: DealerFlipRequestProps) {
  if (offer === null) return null;
  const oneLabel = offer.remaining === 2 ? "Flip one" : "Flip the other";
  return (
    <div aria-label="Ask the dealer" className="dealer-flip" role="group">
      <span className="dealer-flip-tag">Ask the dealer</span>
      <div className="dealer-flip-buttons">
        <button type="button" className="dealer-flip-btn" onClick={() => onRequest("One")}>
          {oneLabel}
        </button>
        {offer.remaining === 2 && (
          <button type="button" className="dealer-flip-btn" onClick={() => onRequest("Both")}>
            Flip both
          </button>
        )}
      </div>
    </div>
  );
}
