import { useMemo, useState } from "react";
import "./scoreboard.css";
import type { ScoreboardSnapshot } from "../engine/types";
import { boardTally } from "../roadTally";
import { BigRoadView } from "./roads";
import { RoadsModal } from "./RoadsModal";

interface ScoreboardProps {
  scoreboard: ScoreboardSnapshot;
  /** Posted table limits in cents, for the full board's limits panel. */
  tableMin?: number;
  tableMax?: number;
  // TODO(App.tsx): pass `snapshot.shoe.number` here — App owns the only
  // call site (`<Scoreboard scoreboard={...} .../>`) and is outside this
  // task's fence. Defaults to 0 (pre-first-cut) so it compiles without it.
  shoeNumber?: number;
}

export function Scoreboard({ scoreboard, tableMin, tableMax, shoeNumber = 0 }: ScoreboardProps) {
  const [showAll, setShowAll] = useState(false);
  // one pass over the bead plate feeds both the footer and the full board
  const counts = useMemo(() => boardTally(scoreboard, shoeNumber), [scoreboard, shoeNumber]);
  return (
    <section aria-label="Scoreboard" className="board panel">
      <BigRoadView road={scoreboard.big_road} />

      <div className="road-tally" aria-label="Win counts">
        <span className="tally tally--p">P {counts.player}</span>
        <span className="tally tally--b">B {counts.banker}</span>
        <span className="tally tally--t">T {counts.tie}</span>
        <span className="tally tally--shoe">Shoe {counts.shoe}</span>
      </div>

      <button type="button" className="full-roads-btn" onClick={() => setShowAll(true)}>
        Full roads
      </button>
      {showAll && (
        <RoadsModal
          scoreboard={scoreboard}
          tally={counts}
          tableMin={tableMin}
          tableMax={tableMax}
          onClose={() => setShowAll(false)}
        />
      )}
    </section>
  );
}
