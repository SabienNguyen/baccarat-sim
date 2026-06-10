import { useEffect } from "react";
import type { Rack } from "../chips";
import { CHIP_DENOMINATIONS, breakChip, colorUp } from "../chips";
import { formatCents } from "../format";
import { MiniChip, chipFace } from "./Chip";
import "./exchange.css";

interface ExchangeModalProps {
  rack: Rack;
  change: number;
  onBreak: (denom: number) => void;
  onColorUp: (denom: number) => void;
  onClose: () => void;
}

/** The dealer makes change: break big chips down, color small chips up. */
export function ExchangeModal({ rack, change, onBreak, onColorUp, onClose }: ExchangeModalProps) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="exchange-backdrop" onClick={onClose}>
      <div
        role="dialog"
        aria-label="Exchange chips"
        className="exchange-modal panel"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="exchange-head">
          <h3>Dealer — change, please</h3>
          <button type="button" className="btn" onClick={onClose} aria-label="Close exchange">
            ✕
          </button>
        </div>

        <ul className="exchange-rows">
          {[...CHIP_DENOMINATIONS].reverse().map((denom) => (
            <li key={denom} className="exchange-row">
              <span className="exchange-chip">
                <MiniChip cents={denom} />
                <span className="exchange-face">{chipFace(denom)}</span>
              </span>
              <span className="exchange-count">× {rack[denom] ?? 0}</span>
              <button
                type="button"
                className="btn"
                disabled={breakChip(rack, denom) === null}
                onClick={() => onBreak(denom)}
              >
                Break
              </button>
              <button
                type="button"
                className="btn"
                disabled={colorUp(rack, denom) === null}
                onClick={() => onColorUp(denom)}
              >
                Color up
              </button>
            </li>
          ))}
        </ul>

        <p className="exchange-change">
          Loose change: {formatCents(change)}
          <span className="exchange-note"> (folds into $1 chips at the dollar)</span>
        </p>
      </div>
    </div>
  );
}
