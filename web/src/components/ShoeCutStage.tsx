import { useEffect, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent } from "react";
import type { CardView, CutReveal, PhaseTag, ShoeCutReason, ShoeView } from "../engine/types";
import { Card } from "./Card";
import { playSfx } from "../audio/sfx";
import "./shoecut.css";

export interface ShoeCutStageProps {
  shoe: ShoeView;
  phase: PhaseTag;
  /** true when this client holds the cut (solo: always) */
  canCut: boolean;
  /** name of the cutter for the waiting copy; null in solo */
  cutterName: string | null;
  onCut: (position: number) => void; // 0..=1000
  /** Non-null while the cut+burn reveal animation is playing — everyone at
   *  the table sees this (including non-cutters), driven by App watching
   *  `shoe.number` tick up. */
  animating: CutReveal | null;
  /** Fired once the animation timeline finishes (or immediately, under
   *  reduced motion). */
  onAnimationEnd: () => void;
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

/** Reveal timeline (ms from `animating` going non-null). Exported so App
 *  knows how long to keep the stage mounted after `shoe.number` ticks up. */
export const SHOE_CUT_ANIM_MS = 2600;
const STEP_TURN_MS = 800;
const STEP_BURN_MS = 1400;
const STEP_BANNER_MS = 2200;

type AnimStep = "cut" | "turn" | "burn" | "banner";

function clampPct(pct: number): number {
  return Math.min(CUT_MAX_PCT, Math.max(CUT_MIN_PCT, pct));
}

function prefersReducedMotion(): boolean {
  return typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function ShoeCutStage({
  shoe,
  phase,
  canCut,
  cutterName,
  onCut,
  animating,
  onAnimationEnd,
}: ShoeCutStageProps) {
  // Percent (5..95) along the stack; converted to the 0..=1000 wire unit
  // only when the cut is confirmed.
  const [pos, setPos] = useState(50);
  const [placed, setPlaced] = useState(false);
  const draggingRef = useRef(false);
  const stackRef = useRef<HTMLDivElement | null>(null);

  // The reveal timeline: which step is showing, and how many burn cards
  // have counted up so far.
  const [step, setStep] = useState<AnimStep | null>(null);
  const [burnedCount, setBurnedCount] = useState(0);

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

  // Drive the reveal timeline off `animating`. Reduced-motion users skip
  // straight to the banner and end the animation on the next paint.
  useEffect(() => {
    if (!animating) {
      setStep(null);
      setBurnedCount(0);
      return;
    }
    const timers: ReturnType<typeof setTimeout>[] = [];
    const schedule = (fn: () => void, ms: number) => {
      timers.push(setTimeout(fn, ms));
    };

    if (prefersReducedMotion()) {
      setStep("banner");
      setBurnedCount(animating.burned);
      schedule(onAnimationEnd, 0);
      return () => timers.forEach(clearTimeout);
    }

    setStep("cut");
    setBurnedCount(0);
    playSfx("shuffle");
    schedule(() => {
      setStep("turn");
      playSfx("flip");
    }, STEP_TURN_MS);
    schedule(() => {
      setStep("burn");
      const burned = animating.burned;
      if (burned <= 0) return;
      const interval = Math.max(40, 800 / burned);
      let i = 0;
      const tick = () => {
        i += 1;
        setBurnedCount(i);
        playSfx("deal");
        if (i < burned) schedule(tick, interval);
      };
      schedule(tick, 0);
    }, STEP_BURN_MS);
    schedule(() => setStep("banner"), STEP_BANNER_MS);
    schedule(onAnimationEnd, SHOE_CUT_ANIM_MS);

    return () => timers.forEach(clearTimeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [animating]);

  if (phase !== "ShoeCut" && animating === null) return null;

  if (animating) {
    const cutIndex = Math.min(
      SLIVER_COUNT,
      Math.max(0, Math.round((animating.position / 1000) * SLIVER_COUNT)),
    );
    const packetCount = SLIVER_COUNT - cutIndex;
    const turnedView: CardView = { FaceUp: animating.turned };
    const showTurned = step === "turn" || step === "burn" || step === "banner";
    const showBurn = step === "burn" || step === "banner";
    const showBanner = step === "banner";

    return (
      <div
        className="shoe-stage shoe-stage--anim"
        role="dialog"
        aria-modal="true"
        aria-label="Shoe cut"
        data-step={step ?? undefined}
      >
        <div className="shoe-backdrop" />
        <div className="shoe-stage-content">
          <div className="shoe-stack shoe-stack--anim" aria-label="Shoe">
            {Array.from({ length: cutIndex }).map((_, i) => (
              <span key={i} className="sliver" data-index={i} />
            ))}
            <div className="shoe-packet" style={{ gridColumn: `span ${packetCount}` }}>
              {Array.from({ length: packetCount }).map((_, i) => (
                <span key={i} className="sliver sliver--packet" data-index={cutIndex + i} />
              ))}
            </div>
          </div>
          {showTurned && (
            <div className="turned-card" aria-label="Turned card">
              <Card card={turnedView} />
            </div>
          )}
          {showBurn && (
            <>
              <div className="discard" aria-hidden="true">
                {Array.from({ length: animating.burned }).map((_, i) => (
                  <span key={i} className="sliver sliver--burned" />
                ))}
              </div>
              <span className="burn-counter">Burned {burnedCount}</span>
            </>
          )}
          {showBanner && <div className="shoe-banner">SHOE {shoe.number}</div>}
        </div>
      </div>
    );
  }

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
