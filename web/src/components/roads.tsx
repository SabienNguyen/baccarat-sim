import type {
  BeadPlate,
  BeadCell,
  BigRoad,
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

export function BeadPlateView({ plate }: { plate: BeadPlate }) {
  return (
    <div aria-label="Bead Plate" className="road bead">
      <h4>Bead Plate</h4>
      <ul className="bead-grid">
        {plate.cells.map((cell, i) => (
          <li key={i} data-outcome={cell.outcome}>
            {beadLabel(cell)}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function BigRoadView({ road }: { road: BigRoad }) {
  return (
    <div aria-label="Big Road" className="road big">
      <h4>Big Road</h4>
      <div className="road-grid">
        {road.columns.map((col, ci) => (
          <ul key={ci}>
            {col.map((cell, ri) => (
              <li key={ri} data-side={cell.side}>
                {bigRoadLabel(cell)}
              </li>
            ))}
          </ul>
        ))}
      </div>
    </div>
  );
}

export function DerivedRoadView({ label, road }: { label: string; road: DerivedRoad }) {
  return (
    <div aria-label={label} className="road derived">
      <h4>{label}</h4>
      <div className="road-grid">
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
    </div>
  );
}
