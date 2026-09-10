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
import { BonusToken, type BonusKind } from "./roadTokens";
import { FoodMark, HanGlyph, Lantern, type BeadKind, type FoodGlyph } from "./roadGlyphs";
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
function useFollowLatest<T extends HTMLElement = HTMLDivElement>(columnCount: number) {
  const ref = useRef<T>(null);
  useEffect(() => {
    const el = ref.current;
    if (el) el.scrollLeft = el.scrollWidth;
  }, [columnCount]);
  return ref;
}

function beadKind(cell: BeadCell): BeadKind {
  return cell.outcome === "PlayerWin" ? "player" : cell.outcome === "BankerWin" ? "banker" : "tie";
}

/**
 * Heading for a reskinned road: the fun name is the visible title, the
 * traditional name sits under it as a subtitle and stays the road's
 * accessible name (the container's aria-label) and glossary hook.
 */
function RoadTitle({ fun, trad, term, lanterns = false }: {
  fun: string;
  trad: string;
  term?: string;
  lanterns?: boolean;
}) {
  return (
    <h4 className="road-title">
      <span className="road-title-fun">
        {lanterns && <Lantern />}
        <span>{fun}</span>
        {lanterns && <Lantern />}
      </span>
      <span className="road-title-trad">
        <span>{trad}</span> {term && <RoadInfo term={term} />}
      </span>
    </h4>
  );
}

function bigRoadLabel(cell: BigRoadCell): string {
  const base = cell.side === "Player" ? "P" : "B";
  return cell.ties > 0 ? `${base}/${cell.ties}` : base;
}

/**
 * The animal bonus stamped on this cell, if any. At most one can apply — a
 * Dragon 7 is a banker three-card 7, a Panda 8 a player three-card 8, and a
 * Tiger a banker 6 — so the order here is just a tiebreak that never fires.
 */
function bonusOf(cell: BigRoadCell): BonusKind | null {
  if (cell.dragon7) return "dragon";
  if (cell.panda8) return "panda";
  if (cell.tiger) return "tiger";
  return null;
}

/** Pair marks and the bonus token a real pit display stamps on a win cell. */
function CellMarks({ cell }: { cell: BigRoadCell }) {
  const bonus = bonusOf(cell);
  return (
    <>
      {/* the traditional pair dots: Player blue at the top-left, Banker red at
          the bottom-right, exactly where a pit display puts them */}
      {cell.player_pair && <span className="pair-dot pair-dot--player" title="Player pair" />}
      {cell.banker_pair && <span className="pair-dot pair-dot--banker" title="Banker pair" />}
      {bonus && <BonusToken kind={bonus} size={11} />}
    </>
  );
}

/** The bead plate, dressed as Chinatown: lacquer beads stamped 庄 / 闲 / 和. */
export function BeadPlateView({ plate }: { plate: BeadPlate }) {
  // six beads to a column; keep the newest column in view as the shoe runs
  const gridRef = useFollowLatest<HTMLUListElement>(Math.ceil(plate.cells.length / 6));
  return (
    <div aria-label="Bead Plate" className="road bead chinatown">
      {/* stepped pagoda eave along the top edge of the board */}
      <div className="pagoda-roof" aria-hidden="true">
        <span /><span /><span />
      </div>
      <RoadTitle fun="CHINATOWN" trad="Bead Plate" term="bead-plate" lanterns />
      <ul className="bead-grid" ref={gridRef}>
        {plate.cells.map((cell, i) => (
          <li key={i} data-outcome={cell.outcome}>
            <HanGlyph kind={beadKind(cell)} />
            {cell.player_pair && <span className="pair-dot pair-dot--player" title="Player pair" />}
            {cell.banker_pair && <span className="pair-dot pair-dot--banker" title="Banker pair" />}
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
                <CellMarks cell={cell} />
              </li>
            ))}
          </ul>
        ))}
      </div>
    </div>
  );
}

/** The visible (food) title for each derived road's pixel glyph. */
const FOOD_TITLE: Record<FoodGlyph, string> = {
  donut: "DONUTS",
  burger: "HAMBURGERS",
  fries: "FRENCH FRIES",
};

/**
 * A derived road (Big Eye Boy / Small Road / Cockroach Pig). The data is the
 * usual red/blue marks; only the stamp changes — each road gets its own food.
 */
export function DerivedRoadView({
  label,
  road,
  term,
  glyph,
}: {
  label: string;
  road: DerivedRoad;
  term?: string;
  glyph: FoodGlyph;
}) {
  const gridRef = useFollowLatest(road.columns.length);
  return (
    <div aria-label={label} className={`road derived derived--${glyph}`}>
      <RoadTitle fun={FOOD_TITLE[glyph]} trad={label} term={term} />
      <div className="road-grid" ref={gridRef}>
        {road.columns.map((col, ci) => (
          <ul key={ci}>
            {col.map((mark: Mark, ri) => (
              <li key={ri} data-mark={mark}>
                <FoodMark glyph={glyph} mark={mark} />
              </li>
            ))}
          </ul>
        ))}
      </div>
    </div>
  );
}
