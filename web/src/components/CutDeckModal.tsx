import { useState } from "react";
import "./cutdeck.css";

interface CutDeckModalProps {
  /** Confirm the cut and shuffle a fresh shoe. */
  onCut: () => void;
  onCancel: () => void;
}

const SLOTS = 24;

/**
 * The cut-the-deck ritual: drag the red cut card into the shoe (or click a
 * slot), then confirm to shuffle. The cut position is cosmetic — it sets the
 * mood, the engine reshuffles regardless.
 */
export function CutDeckModal({ onCut, onCancel }: CutDeckModalProps) {
  const [cutAt, setCutAt] = useState<number | null>(null);

  return (
    <div className="cut-backdrop" onClick={onCancel}>
      <div
        role="dialog"
        aria-label="Cut the deck"
        className="cut-modal panel"
        onClick={(e) => e.stopPropagation()}
      >
        <h3>Cut the deck</h3>
        <p>Drag the cut card into the shoe — or tap where to cut.</p>

        <div className="deck" aria-label="Shoe">
          {Array.from({ length: SLOTS }).map((_, i) => (
            <div
              key={i}
              className={`deck-card ${cutAt === i ? "is-cut" : ""}`}
              onClick={() => setCutAt(i)}
              onDragOver={(e) => e.preventDefault()}
              onDrop={() => setCutAt(i)}
            />
          ))}
        </div>

        <div
          className="cut-card-source"
          aria-label="cut card"
          draggable
          onDragStart={(e) => e.dataTransfer.setData("text/plain", "cut")}
        >
          CUT
        </div>

        <div className="cut-actions">
          <button
            type="button"
            className="btn"
            disabled={cutAt === null}
            onClick={onCut}
          >
            Cut &amp; shuffle
          </button>
          <button type="button" className="btn cut-cancel" onClick={onCancel}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
