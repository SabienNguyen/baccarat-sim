import { useEffect } from "react";
import type { GlossaryEntry } from "../engine/types";
import { glossaryEntry } from "../glossaryData";
import "./bonusinfo.css";

/** The bonus bets explained, in felt order, with the Tiger family expanded. */
const BONUS_TERMS: Array<{ term: string; title?: string; payout: string }> = [
  { term: "pair", title: "Player / Banker Pair", payout: "11:1" },
  { term: "dragon-7", payout: "40:1" },
  { term: "panda-8", payout: "25:1" },
  { term: "dragon-bonus", payout: "up to 30:1" },
  { term: "tiger", payout: "12:1 / 20:1" },
  { term: "big-tiger", payout: "50:1" },
  { term: "small-tiger", payout: "22:1" },
  { term: "tiger-tie", payout: "35:1" },
  { term: "tiger-pair", payout: "varies" },
];

interface BonusInfoModalProps {
  onClose: () => void;
  /** Term lookup; defaults to the real glossary. Injectable for tests. */
  lookup?: (term: string) => GlossaryEntry | undefined;
}

/** One window that teaches every side bet on the felt. */
export function BonusInfoModal({ onClose, lookup = glossaryEntry }: BonusInfoModalProps) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="bonus-backdrop" onClick={onClose}>
      <div
        role="dialog"
        aria-label="Bonus bets"
        className="bonus-modal panel"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="bonus-head">
          <h3>The bonus bets</h3>
          <button type="button" className="btn" onClick={onClose} aria-label="Close bonus info">
            ✕
          </button>
        </div>

        <ul className="bonus-rows">
          {BONUS_TERMS.map(({ term, title, payout }) => {
            const entry = lookup(term);
            if (!entry) return null;
            return (
              <li key={term} className="bonus-row">
                <div className="bonus-row-head">
                  <span className="bonus-name">{title ?? entry.label}</span>
                  <span className="bonus-payout">{payout}</span>
                </div>
                <p className="bonus-text">{entry.long}</p>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
