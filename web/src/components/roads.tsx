import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { MouseEvent as ReactMouseEvent, FocusEvent as ReactFocusEvent } from "react";
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

/**
 * A "?" beside a road heading that explains what the road tracks. The popover
 * portals to <body> as a fixed layer, so it floats over the full-roads window
 * instead of being clipped by its scroll container.
 */
function RoadInfo({ term }: { term: string }) {
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const entry = glossaryEntry(term);
  if (!entry) return null;

  const show = (e: ReactMouseEvent | ReactFocusEvent) => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    // clamp so a tip near the screen edge stays fully on screen
    const x = Math.min(Math.max(r.left + r.width / 2, 170), window.innerWidth - 170);
    setPos({ x, y: r.bottom + 8 });
  };
  const hide = () => setPos(null);

  return (
    <span className="road-info">
      <button
        type="button"
        className="road-info-btn"
        aria-label={`What is the ${entry.label}?`}
        onMouseEnter={show}
        onMouseLeave={hide}
        onFocus={show}
        onBlur={hide}
      >
        ?
      </button>
      {pos &&
        createPortal(
          <span
            role="tooltip"
            className="term-popover term-popover--wide term-popover--portal"
            style={{ left: pos.x, top: pos.y }}
          >
            <strong>{entry.label}</strong> {entry.long}
          </span>,
          document.body,
        )}
    </span>
  );
}

/** Keep a scrolling road pinned to its newest column, like the pit display:
 *  when the grid outgrows its window, the latest play stays in view. */
function useFollowLatest(columnCount: number) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (el) el.scrollLeft = el.scrollWidth;
  }, [columnCount]);
  return ref;
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
  const gridRef = useFollowLatest(road.columns.length);
  return (
    <div aria-label="Big Road" className="road big">
      <h4>Big Road <RoadInfo term="big-road" /></h4>
      <div className="road-grid" ref={gridRef}>
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
  const gridRef = useFollowLatest(road.columns.length);
  return (
    <div aria-label={label} className="road derived">
      <h4>
        {label} {term && <RoadInfo term={term} />}
      </h4>
      <div className="road-grid" ref={gridRef}>
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
