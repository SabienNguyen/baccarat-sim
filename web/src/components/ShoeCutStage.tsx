import { useEffect, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent } from "react";
import type { PhaseTag, ShoeCutReason, ShoeView } from "../engine/types";
import "./shoecut.css";

export interface ShoeCutStageProps {
  shoe: ShoeView;
  phase: PhaseTag;
  /** true when this client holds the cut (solo: always) */
  canCut: boolean;
  /** name of the cutter for the waiting copy; null in solo */
  cutterName: string | null;
  onCut: (position: number) => void; // 0..=1000
}

/** The shoe is 416 cards; a sliver per card would be sub-pixel on a 390px
 *  phone (720px stack / 416 ≈ 1.7px, and the 5px pointer-hit slop on a real
 *  finger would land on several at once). One sliver per 4 cards (104 of
 *  them) keeps each sliver a legible few pixels wide down to a 390px
 *  viewport while still reading as a long, continuous stack. */
const SLIVER_COUNT = 104;

const REASON_COPY: Record<ShoeCutReason, string> = {
  NewTable: "A fresh shoe on the table.",
  CutCardOut: "The cut card came out — that shoe is done.",
  Vote: "The table voted for a new shoe.",
  Requested: "You asked for a new shoe.",
};

const CUT_MIN_PCT = 5;
const CUT_MAX_PCT = 95;

function clampPct(pct: number): number {
  return Math.min(CUT_MAX_PCT, Math.max(CUT_MIN_PCT, pct));
}

export function ShoeCutStage({ shoe, phase, canCut, cutterName, onCut }: ShoeCutStageProps) {
  // Percent (5..95) along the stack; converted to the 0..=1000 wire unit
  // only when the cut is confirmed.
  const [pos, setPos] = useState(50);
  const [placed, setPlaced] = useState(false);
  const draggingRef = useRef(false);
  const stackRef = useRef<HTMLDivElement | null>(null);

  // Body+html scroll lock while the stage is mounted, same as PeelStage —
  // a stray touch-scroll behind the backdrop must not move the page.
  useEffect(() => {
    const prevBody = document.body.style.overflow;
    const prevHtml = document.documentElement.style.overflow;
    document.body.style.overflow = "hidden";
    document.documentElement.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prevBody;
      document.documentElement.style.overflow = prevHtml;
    };
  }, []);

  if (phase !== "ShoeCut") return null;

  const pctFromClientX = (clientX: number): number => {
    const rect = stackRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return pos;
    return clampPct(((clientX - rect.left) / rect.width) * 100);
  };

  const handlePointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!canCut) return;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    draggingRef.current = true;
    setPos(pctFromClientX(e.clientX));
    setPlaced(true);
  };
  const handlePointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!canCut || !draggingRef.current) return;
    setPos(pctFromClientX(e.clientX));
  };
  const handlePointerUp = () => {
    draggingRef.current = false;
  };

  const nudge = (delta: number) => {
    setPos((p) => clampPct(p + delta));
    setPlaced(true);
  };

  const handleKeyDown = (e: ReactKeyboardEvent<HTMLButtonElement>) => {
    switch (e.key) {
      case "ArrowLeft":
        e.preventDefault();
        nudge(e.shiftKey ? -5 : -1);
        break;
      case "ArrowRight":
        e.preventDefault();
        nudge(e.shiftKey ? 5 : 1);
        break;
      case "Home":
        e.preventDefault();
        setPos(CUT_MIN_PCT);
        setPlaced(true);
        break;
      case "End":
        e.preventDefault();
        setPos(CUT_MAX_PCT);
        setPlaced(true);
        break;
      case "Enter":
      case " ":
        e.preventDefault();
        if (placed) onCut(Math.round(pos * 10));
        break;
      default:
        break;
    }
  };

  const title = canCut ? "Cut the shoe" : `Waiting for ${cutterName} to cut the shoe`;
  const reason = shoe.cut_reason ? REASON_COPY[shoe.cut_reason] : null;

  return (
    <div className="shoe-stage" role="dialog" aria-modal="true" aria-label="Cut the shoe">
      <div className="shoe-backdrop" />
      <div className="shoe-stage-content">
        <h2 className="shoe-title">{title}</h2>
        {reason && <p className="shoe-subline">{reason}</p>}
        <div
          ref={stackRef}
          className={`shoe-stack${canCut ? "" : " shoe-stack--idle"}`}
          role="group"
          aria-label="Shoe"
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
        >
          {Array.from({ length: SLIVER_COUNT }).map((_, i) => (
            <span key={i} className="sliver" data-index={i} />
          ))}
          {canCut && (
            <button
              type="button"
              className="cut-card"
              aria-label="Cut card"
              aria-valuemin={50}
              aria-valuemax={950}
              aria-valuenow={Math.round(pos * 10)}
              style={{ left: `calc(${pos}%)` }}
              onKeyDown={handleKeyDown}
            >
              CUT
            </button>
          )}
        </div>
        {canCut && (
          <button
            type="button"
            className="btn btn--primary shoe-cut-confirm"
            disabled={!placed}
            onClick={() => onCut(Math.round(pos * 10))}
          >
            Cut here
          </button>
        )}
      </div>
    </div>
  );
}
