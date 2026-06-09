import type {
  ScoreboardSnapshot,
  BeadCell,
  BigRoadCell,
  DerivedRoad,
  Mark,
} from "../engine/types";

function beadLabel(cell: BeadCell): string {
  const base =
    cell.outcome === "PlayerWin" ? "P" : cell.outcome === "BankerWin" ? "B" : "T";
  const pairs = `${cell.player_pair ? "ᴾ" : ""}${cell.banker_pair ? "ᴮ" : ""}`;
  return base + pairs;
}

function bigRoadLabel(cell: BigRoadCell): string {
  const base = cell.side === "Player" ? "P" : "B";
  return cell.ties > 0 ? `${base}/${cell.ties}` : base;
}

function DerivedRoadView({ label, road }: { label: string; road: DerivedRoad }) {
  return (
    <div aria-label={label}>
      <h4>{label}</h4>
      {road.columns.map((col, ci) => (
        <ul key={ci}>
          {col.map((mark: Mark, ri) => (
            <li key={ri} data-mark={mark}>
              {mark === "Red" ? "●" : "○"}
            </li>
          ))}
        </ul>
      ))}
    </div>
  );
}

export function Scoreboard({ scoreboard }: { scoreboard: ScoreboardSnapshot }) {
  return (
    <section aria-label="Scoreboard">
      <div aria-label="Bead Plate">
        <h4>Bead Plate</h4>
        <ul>
          {scoreboard.bead_plate.cells.map((cell, i) => (
            <li key={i}>{beadLabel(cell)}</li>
          ))}
        </ul>
      </div>

      <div aria-label="Big Road">
        <h4>Big Road</h4>
        {scoreboard.big_road.columns.map((col, ci) => (
          <ul key={ci}>
            {col.map((cell, ri) => (
              <li key={ri}>{bigRoadLabel(cell)}</li>
            ))}
          </ul>
        ))}
      </div>

      <DerivedRoadView label="Big Eye Boy" road={scoreboard.big_eye_boy} />
      <DerivedRoadView label="Small Road" road={scoreboard.small_road} />
      <DerivedRoadView label="Cockroach Pig" road={scoreboard.cockroach_pig} />
    </section>
  );
}
