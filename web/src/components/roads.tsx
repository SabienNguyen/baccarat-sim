import { useState } from "react";
import type {
  BeadPlate,
  BeadCell,
  BigRoad,
  BigRoadCell,
  DerivedRoad,
  Mark,
} from "../engine/types";
import { glossaryEntry } from "../glossaryData";
import "./glossary.css";

/** A "?" beside a road heading that explains what the road tracks. */
function RoadInfo({ term }: { term: string }) {
  const [open, setOpen] = useState(false);
  const entry = glossaryEntry(term);
  if (!entry) return null;
  return (
    <span className="glossary-term road-info">
      <button
        type="button"
        className="road-info-btn"
        aria-label={`What is the ${entry.label}?`}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
      >
        ?
      </button>
      {open && (
        <span role="tooltip" className="term-popover term-popover--wide">
          <strong>{entry.label}</strong> {entry.long}
        </span>
      )}
    </span>
  );
}

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
      <h4>Bead Plate <RoadInfo term="bead-plate" /></h4>
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
      <h4>Big Road <RoadInfo term="big-road" /></h4>
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

export function DerivedRoadView({
  label,
  road,
  term,
}: {
  label: string;
  road: DerivedRoad;
  term?: string;
}) {
  return (
    <div aria-label={label} className="road derived">
      <h4>
        {label} {term && <RoadInfo term={term} />}
      </h4>
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
