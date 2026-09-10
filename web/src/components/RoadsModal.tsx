import { useEffect, useRef } from "react";
import type { BigRoad, Mark, ScoreboardSnapshot, Side } from "../engine/types";
import { formatCents } from "../format";
import { nextMarks } from "../roadForecast";
import { boardTally, type BoardTally } from "../roadTally";
import { BeadPlateView, BigRoadView, DerivedRoadView } from "./roads";
import { FoodMark, HanGlyph, type FoodGlyph } from "./roadGlyphs";
import { useFitCells } from "./useFitCells";

interface RoadsModalProps {
  scoreboard: ScoreboardSnapshot;
  /** Bead-plate counts, if the caller already has them (Scoreboard memoises one). */
  tally?: BoardTally;
  /** Posted table limits in cents; the limits panel is left off without them. */
  tableMin?: number;
  tableMax?: number;
  onClose: () => void;
}

/** A labelled two-column card (mark / label / value) shared by the side panels. */
function BoardCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <table className="board-card" aria-label={title}>
      <caption className="board-card-title">{title}</caption>
      <tbody>{children}</tbody>
    </table>
  );
}

function TallyPanel({ tally: t }: { tally: BoardTally }) {
  const rows: [string, React.ReactNode, number][] = [
    ["Banker", <HanGlyph kind="banker" size={18} />, t.banker],
    ["Player", <HanGlyph kind="player" size={18} />, t.player],
    ["Tie", <HanGlyph kind="tie" size={18} />, t.tie],
    ["Banker pair", <span className="pair-dot pair-dot--banker pair-dot--inline" />, t.bankerPair],
    ["Player pair", <span className="pair-dot pair-dot--player pair-dot--inline" />, t.playerPair],
    ["Game number", null, t.games],
  ];
  return (
    <BoardCard title="Tally">
      {rows.map(([label, mark, count]) => (
        <tr key={label} aria-label={label} className={mark ? undefined : "board-row--plain"}>
          <td className="board-mark" aria-hidden="true">
            {mark}
          </td>
          <th scope="row">{label}</th>
          <td className="board-value">{count}</td>
        </tr>
      ))}
    </BoardCard>
  );
}

/** Each derived road's food, its fun name, and the traditional name. */
const KEY_ROWS: [FoodGlyph, string, string][] = [
  ["donut", "Donuts", "Big Eye Boy"],
  ["burger", "Hamburgers", "Small Road"],
  ["fries", "French fries", "Cockroach Pig"],
];

/** The colour a side's column stands for in the key, and its plain name. */
const SIDE_MARK: Record<Side, Mark> = { Banker: "Red", Player: "Blue" };
const MARK_NAME: Record<Mark, string> = { Red: "red", Blue: "blue" };

/**
 * One key cell. Once the road has started it shows what its side would stamp
 * next — the forecast colour at full strength, red or blue regardless of the
 * column it sits in. Before that it is a legend: the column's own colour (red
 * under 庄, blue under 闲), dimmed only if the other side already has a
 * forecast and this one does not.
 */
function KeyCell({
  glyph,
  road,
  side,
  forecast,
  otherForecast,
}: {
  glyph: FoodGlyph;
  road: string;
  side: Side;
  /** what this side would stamp next, if the road has started */
  forecast: Mark | null;
  /** the other side's forecast, to know whether the road has started at all */
  otherForecast: Mark | null;
}) {
  const colour = SIDE_MARK[side];
  const shown = forecast ?? colour;
  const dim = !forecast && otherForecast !== null;
  const title = forecast
    ? `${road}: ${side} next → ${MARK_NAME[forecast]} ${glyph}`
    : `${road}: ${MARK_NAME[colour]} ${glyph}`;
  return (
    <td
      className={`board-key-cell${dim ? " board-key-cell--dim" : ""}`}
      data-forecast={forecast ? MARK_NAME[forecast] : "none"}
      title={title}
    >
      <FoodMark glyph={glyph} mark={shown} size={16} />
    </td>
  );
}

/** Legend for the three food roads, with the next-hand forecast laid over it. */
function NextHandPanel({ big }: { big: BigRoad }) {
  const ifBanker = nextMarks(big, "Banker");
  const ifPlayer = nextMarks(big, "Player");
  return (
    <table className="board-card board-card--key" aria-label="Key · Next hand">
      <caption className="board-card-title">Key · Next hand</caption>
      <thead>
        <tr>
          <td />
          <th scope="col" aria-label="If Banker">
            <HanGlyph kind="banker" size={18} />
          </th>
          <th scope="col" aria-label="If Player">
            <HanGlyph kind="player" size={18} />
          </th>
        </tr>
      </thead>
      <tbody>
        {KEY_ROWS.map(([glyph, label, road], i) => (
          <tr key={glyph} aria-label={label}>
            <th scope="row" className="board-key-label">
              <span className="board-key-fun">{label}</span>
              <span className="board-key-trad">{road}</span>
            </th>
            <KeyCell glyph={glyph} road={road} side="Banker" forecast={ifBanker[i]} otherForecast={ifPlayer[i]} />
            <KeyCell glyph={glyph} road={road} side="Player" forecast={ifPlayer[i]} otherForecast={ifBanker[i]} />
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** Posted limits. The engine holds every spot to the one table min/max, so
 *  tie and pairs quote the same numbers a real board would list separately. */
function LimitsPanel({ min, max }: { min: number; max: number }) {
  const rows: [string, number][] = [
    ["Min", min],
    ["Max", max],
    ["Tie min", min],
    ["Tie max", max],
    ["Pairs min", min],
    ["Pairs max", max],
  ];
  return (
    <BoardCard title="Table limits">
      {rows.map(([label, cents]) => (
        <tr key={label} aria-label={label} className="board-row--plain">
          <th scope="row">{label}</th>
          <td className="board-value">{formatCents(cents)}</td>
        </tr>
      ))}
    </BoardCard>
  );
}

/**
 * A full-screen overlay laid out like a Macau electronic scoreboard: bead
 * plate, tallies, next-hand key and limits across the top, then the Big Road,
 * Big Eye Boy, and the Small Road / Cockroach Pig pair, with a welcome strip.
 */
export function RoadsModal({ scoreboard, tally, tableMin, tableMax, onClose }: RoadsModalProps) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // the board fits the viewport, so the page behind it has no reason to scroll
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  const boardRef = useRef<HTMLDivElement>(null);
  const fitRef = useRef<HTMLDivElement>(null);
  const { cell, scale, scroll } = useFitCells(boardRef, fitRef);

  const hasLimits = tableMin !== undefined && tableMax !== undefined;
  const counts = tally ?? boardTally(scoreboard);

  return (
    <div className="roads-backdrop" onClick={onClose}>
      <div
        role="dialog"
        aria-label="All roads"
        className={`roads-modal panel${scroll ? " roads-modal--scroll" : ""}`}
        style={{ "--road-cell": `${cell}px` } as React.CSSProperties}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="roads-modal-head">
          <h3>Roads</h3>
          <button type="button" className="btn" onClick={onClose} aria-label="Close roads">
            ✕
          </button>
        </div>
        <div className="roads-board" ref={boardRef}>
          <div
            className="roads-fit"
            ref={fitRef}
            style={scale < 1 ? { transform: `scale(${scale})` } : undefined}
          >
            <div className="roads-top">
              <BeadPlateView plate={scoreboard.bead_plate} />
              <TallyPanel tally={counts} />
              <NextHandPanel big={scoreboard.big_road} />
              {hasLimits && <LimitsPanel min={tableMin} max={tableMax} />}
            </div>
            <BigRoadView road={scoreboard.big_road} />
            {/* the three derived roads, each stamped with its own food */}
            <DerivedRoadView label="Big Eye Boy" glyph="donut" road={scoreboard.big_eye_boy} term="big-eye-boy" />
            <div className="roads-bottom">
              <DerivedRoadView label="Small Road" glyph="burger" road={scoreboard.small_road} term="small-road" />
              <DerivedRoadView label="Cockroach Pig" glyph="fries" road={scoreboard.cockroach_pig} term="cockroach-pig" />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
