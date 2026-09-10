import { useEffect, useRef } from "react";
import type { BigRoad, ScoreboardSnapshot } from "../engine/types";
import { formatCents } from "../format";
import { nextMarks } from "../roadForecast";
import { BeadPlateView, BigRoadView, DerivedRoadView } from "./roads";
import { FoodMark, HanGlyph, type FoodGlyph } from "./roadGlyphs";
import { useFitCells } from "./useFitCells";

interface RoadsModalProps {
  scoreboard: ScoreboardSnapshot;
  /** Posted table limits in cents; the limits panel is left off without them. */
  tableMin?: number;
  tableMax?: number;
  onClose: () => void;
}

/** Running counts for the board's tally panel, read off the bead plate. */
export function boardTally(scoreboard: ScoreboardSnapshot) {
  const t = { banker: 0, player: 0, tie: 0, bankerPair: 0, playerPair: 0, games: 0 };
  for (const cell of scoreboard.bead_plate.cells) {
    t.games += 1;
    if (cell.outcome === "BankerWin") t.banker += 1;
    else if (cell.outcome === "PlayerWin") t.player += 1;
    else t.tie += 1;
    if (cell.banker_pair) t.bankerPair += 1;
    if (cell.player_pair) t.playerPair += 1;
  }
  return t;
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

function TallyPanel({ scoreboard }: { scoreboard: ScoreboardSnapshot }) {
  const t = boardTally(scoreboard);
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

const FORECAST_ROWS: [FoodGlyph, string][] = [
  ["donut", "Donuts"],
  ["burger", "Hamburgers"],
  ["fries", "French fries"],
];

/** What each derived road would stamp if the next hand went Banker / Player. */
function NextHandPanel({ big }: { big: BigRoad }) {
  const ifBanker = nextMarks(big, "Banker");
  const ifPlayer = nextMarks(big, "Player");
  return (
    <table className="board-card board-card--key" aria-label="Next hand">
      <caption className="board-card-title">Next hand</caption>
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
        {FORECAST_ROWS.map(([glyph, label], i) => (
          <tr key={glyph} aria-label={label}>
            <th scope="row" className="board-key-label">
              {label}
            </th>
            <td className="board-key-cell">
              {ifBanker[i] && <FoodMark glyph={glyph} mark={ifBanker[i]} size={16} />}
            </td>
            <td className="board-key-cell">
              {ifPlayer[i] && <FoodMark glyph={glyph} mark={ifPlayer[i]} size={16} />}
            </td>
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
export function RoadsModal({ scoreboard, tableMin, tableMax, onClose }: RoadsModalProps) {
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
  const { cell, scale } = useFitCells(boardRef, fitRef);

  const hasLimits = tableMin !== undefined && tableMax !== undefined;

  return (
    <div className="roads-backdrop" onClick={onClose}>
      <div
        role="dialog"
        aria-label="All roads"
        className="roads-modal panel"
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
              <TallyPanel scoreboard={scoreboard} />
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
