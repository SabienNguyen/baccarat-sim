import { useState } from "react";
import "./scoreboard.css";
import type { ScoreboardSnapshot } from "../engine/types";
import { BigRoadView } from "./roads";
import { RoadsModal } from "./RoadsModal";

/** Win counters for the pit-display footer, read off the bead plate. */
function tally(scoreboard: ScoreboardSnapshot): { p: number; b: number; t: number } {
  let p = 0;
  let b = 0;
  let t = 0;
  for (const cell of scoreboard.bead_plate.cells) {
    if (cell.outcome === "PlayerWin") p += 1;
    else if (cell.outcome === "BankerWin") b += 1;
    else t += 1;
  }
  return { p, b, t };
}

interface ScoreboardProps {
  scoreboard: ScoreboardSnapshot;
  /** Posted table limits in cents, for the full board's limits panel. */
  tableMin?: number;
  tableMax?: number;
}

export function Scoreboard({ scoreboard, tableMin, tableMax }: ScoreboardProps) {
  const [showAll, setShowAll] = useState(false);
  const counts = tally(scoreboard);
  return (
    <section aria-label="Scoreboard" className="board panel">
      <BigRoadView road={scoreboard.big_road} />

      <div className="road-tally" aria-label="Win counts">
        <span className="tally tally--p">P {counts.p}</span>
        <span className="tally tally--b">B {counts.b}</span>
        <span className="tally tally--t">T {counts.t}</span>
      </div>

      <button type="button" className="full-roads-btn" onClick={() => setShowAll(true)}>
        Full roads
      </button>
      {showAll && (
        <RoadsModal
          scoreboard={scoreboard}
          tableMin={tableMin}
          tableMax={tableMax}
          onClose={() => setShowAll(false)}
        />
      )}
    </section>
  );
}
