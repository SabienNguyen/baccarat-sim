import { useEffect } from "react";
import type { ScoreboardSnapshot } from "../engine/types";
import { BeadPlateView, BigRoadView, DerivedRoadView } from "./roads";

interface RoadsModalProps {
  scoreboard: ScoreboardSnapshot;
  onClose: () => void;
}

/** A full-screen overlay showing every road, like the pit's scoreboard display. */
export function RoadsModal({ scoreboard, onClose }: RoadsModalProps) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="roads-backdrop" onClick={onClose}>
      <div
        role="dialog"
        aria-label="All roads"
        className="roads-modal panel"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="roads-modal-head">
          <h3>Roads</h3>
          <button type="button" className="btn" onClick={onClose} aria-label="Close roads">
            ✕
          </button>
        </div>
        <div className="roads-grid">
          <BeadPlateView plate={scoreboard.bead_plate} />
          <BigRoadView road={scoreboard.big_road} />
          {/* the three derived roads, each stamped with its own food */}
          <DerivedRoadView label="Big Eye Boy" glyph="donut" road={scoreboard.big_eye_boy} term="big-eye-boy" />
          <DerivedRoadView label="Small Road" glyph="burger" road={scoreboard.small_road} term="small-road" />
          <DerivedRoadView label="Cockroach Pig" glyph="fries" road={scoreboard.cockroach_pig} term="cockroach-pig" />
        </div>
      </div>
    </div>
  );
}
