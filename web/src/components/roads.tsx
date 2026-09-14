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
import { layoutRoad, type PlacedCell } from "../roadLayout";
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

/** Parse a computed CSS value as a whole number of pixels, e.g. "27px" -> 27.
 *  Anything else (unresolved custom property, calc(), %) yields null. */
function parsePx(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed.endsWith("px")) return null;
  const n = Number.parseFloat(trimmed.slice(0, -2));
  return Number.isFinite(n) ? n : null;
}

/** Keep a scrolling road pinned to its newest column, like the pit display:
 *  when the grid outgrows its window, the latest play stays in view. On top
 *  of that, the grid is sized to a whole number of column-pitches (so the
 *  left edge never cuts a column mid-cell) and desktop users get a wheel and
 *  drag-to-scroll affordance plus edge shadows hinting there is more to see. */
function useFollowLatest<T extends HTMLElement = HTMLDivElement>(columnCount: number) {
  const ref = useRef<T>(null);

  // Whole-column sizing: sample --road-cell / --road-gap off the grid itself
  // and the parent's available width, then set the grid's own width to the
  // largest whole number of column-pitches that fits it.
  useEffect(() => {
    const el = ref.current;
    const parent = el?.parentElement;
    if (!el || !parent) return;

    const fit = () => {
      const style = getComputedStyle(el);
      const cell = parsePx(style.getPropertyValue("--road-cell"));
      const gap = parsePx(style.getPropertyValue("--road-gap"));
      if (cell == null || gap == null) return; // unresolved: leave the CSS default (100%)
      const available = parent.clientWidth;
      if (available <= 0) return; // no layout (jsdom) — leave the CSS default
      // The grid's own padding/border eat into its box under the global
      // `* { box-sizing: border-box }` reset — a column count picked from
      // the raw available width would still land a half column shy of the
      // content edge. Budget for that so the whole-pitch math lands on the
      // content box the columns actually render in, then size the element
      // back up to the border box so it still fills that column budget.
      const overhead =
        (parsePx(style.paddingLeft) ?? 0) +
        (parsePx(style.paddingRight) ?? 0) +
        (parsePx(style.borderLeftWidth) ?? 0) +
        (parsePx(style.borderRightWidth) ?? 0);
      const borderBox = style.boxSizing === "border-box";
      const contentAvailable = borderBox ? available - overhead : available;
      const pitch = cell + gap;
      const n = Math.max(0, Math.floor((contentAvailable + gap) / pitch));
      const contentWidth = n > 0 ? n * cell + (n - 1) * gap : 0;
      const width = borderBox ? contentWidth + overhead : contentWidth;
      el.style.width = `${width}px`;
    };

    fit();
    window.addEventListener("resize", fit);
    if (typeof ResizeObserver === "undefined") {
      return () => window.removeEventListener("resize", fit);
    }
    const ro = new ResizeObserver(fit);
    ro.observe(parent);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", fit);
    };
  }, []);

  // Follow the newest column, once the width above is settled.
  useEffect(() => {
    const el = ref.current;
    if (el) el.scrollLeft = el.scrollWidth;
  }, [columnCount]);

  // Wheel panning, mouse drag-to-scroll, and overflow-edge affordances.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const overflowing = () => el.scrollWidth > el.clientWidth + 0.5;

    const setFlag = (name: string, on: boolean) => {
      if (on) el.setAttribute(name, "true");
      else el.removeAttribute(name);
    };
    const updateOverflow = () => {
      const over = overflowing();
      setFlag("data-overflow-left", over && el.scrollLeft > 0.5);
      setFlag("data-overflow-right", over && el.scrollLeft < el.scrollWidth - el.clientWidth - 0.5);
      el.classList.toggle("road-scroll--draggable", over);
    };

    // A plain vertical mouse-wheel pans the road; leave horizontal trackpad
    // deltas (already >= vertical) to the browser's native scrolling.
    const onWheel = (e: WheelEvent) => {
      if (!overflowing()) return;
      if (Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return;
      el.scrollLeft += e.deltaY;
      e.preventDefault();
    };

    let drag: { x: number; scrollLeft: number } | null = null;
    const onPointerDown = (e: PointerEvent) => {
      if (e.pointerType !== "mouse" || !overflowing()) return;
      drag = { x: e.clientX, scrollLeft: el.scrollLeft };
      el.setPointerCapture(e.pointerId);
      el.classList.add("road-scroll--dragging");
    };
    const onPointerMove = (e: PointerEvent) => {
      if (!drag) return;
      el.scrollLeft = drag.scrollLeft - (e.clientX - drag.x);
    };
    const stopDrag = () => {
      drag = null;
      el.classList.remove("road-scroll--dragging");
    };

    updateOverflow();
    el.addEventListener("wheel", onWheel, { passive: false });
    el.addEventListener("scroll", updateOverflow);
    el.addEventListener("pointerdown", onPointerDown);
    el.addEventListener("pointermove", onPointerMove);
    el.addEventListener("pointerup", stopDrag);
    el.addEventListener("pointercancel", stopDrag);
    window.addEventListener("resize", updateOverflow);
    return () => {
      el.removeEventListener("wheel", onWheel);
      el.removeEventListener("scroll", updateOverflow);
      el.removeEventListener("pointerdown", onPointerDown);
      el.removeEventListener("pointermove", onPointerMove);
      el.removeEventListener("pointerup", stopDrag);
      el.removeEventListener("pointercancel", stopDrag);
      window.removeEventListener("resize", updateOverflow);
    };
  }, []);

  return ref;
}

/**
 * Fold a road's logical columns onto the 6-row display grid (dragon-tail
 * bend), grouped back per logical column so each still renders as one list.
 */
function foldRoad<T>(columns: T[][]): { runs: PlacedCell<T>[][]; width: number } {
  const { cells, width } = layoutRoad(columns);
  const runs: PlacedCell<T>[][] = [];
  let at = 0;
  for (const col of columns) {
    runs.push(cells.slice(at, at + col.length));
    at += col.length;
  }
  return { runs, width };
}

/** Inline placement of one cell on the CSS grid (1-based lines). */
function slot({ col, row }: PlacedCell<unknown>) {
  return { gridColumn: col + 1, gridRow: row + 1 };
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
      {/* pair dots take top-left/bottom-right and the bonus token hangs off
          the bottom-left — top-right is the one corner still free */}
      {cell.natural && <span className="natural-dot" title="Natural" />}
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
  const { runs, width } = foldRoad(road.columns);
  const gridRef = useFollowLatest(width);
  return (
    <div aria-label="Big Road" className="road big">
      <h4>Big Road <RoadInfo term="big-road" /></h4>
      <div className="road-grid" ref={gridRef}>
        {runs.map((run, ci) => (
          <ul key={ci}>
            {run.map((placed, ri) => (
              <li key={ri} data-side={placed.cell.side} style={slot(placed)}>
                {bigRoadLabel(placed.cell)}
                <CellMarks cell={placed.cell} />
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
  const { runs, width } = foldRoad<Mark>(road.columns);
  const gridRef = useFollowLatest(width);
  return (
    <div aria-label={label} className={`road derived derived--${glyph}`}>
      <RoadTitle fun={FOOD_TITLE[glyph]} trad={label} term={term} />
      <div className="road-grid" ref={gridRef}>
        {runs.map((run, ci) => (
          <ul key={ci}>
            {run.map((placed, ri) => (
              <li key={ri} data-mark={placed.cell} style={slot(placed)}>
                <FoodMark glyph={glyph} mark={placed.cell} />
              </li>
            ))}
          </ul>
        ))}
      </div>
    </div>
  );
}
