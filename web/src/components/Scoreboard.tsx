import { useState } from "react";
import "./scoreboard.css";
import type { ScoreboardSnapshot } from "../engine/types";
import { BigRoadView } from "./roads";
import { RoadsModal } from "./RoadsModal";

export function Scoreboard({ scoreboard }: { scoreboard: ScoreboardSnapshot }) {
  const [showAll, setShowAll] = useState(false);
  return (
    <section aria-label="Scoreboard" className="board panel">
      <BigRoadView road={scoreboard.big_road} />
      <button type="button" className="full-roads-btn" onClick={() => setShowAll(true)}>
        Full roads
      </button>
      {showAll && <RoadsModal scoreboard={scoreboard} onClose={() => setShowAll(false)} />}
    </section>
  );
}
