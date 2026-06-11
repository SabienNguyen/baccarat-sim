import { useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent, KeyboardEvent as ReactKeyboardEvent } from "react";
import type { CardView } from "../engine/types";
import { Card } from "./Card";
import { isFaceUp } from "../cards";
import { gripAt, PEEK_AT, type Grip, type PeelGrip } from "../squeeze";

const DRAG_DISTANCE_PX = 120;
/** Pointer travel (px) above which a gesture counts as a drag, not a tap. */
const TAP_SLOP_PX = 8;

interface SqueezeCardProps {
  card: CardView;
  onPeek: () => void;
  onReveal: () => void;
}

function isPeeked(card: CardView): boolean {
  return card !== "FaceDown" && typeof card === "object" && "Peeked" in card;
}

function gripFrom(e: ReactPointerEvent): Grip {
  const rect = e.currentTarget.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) {
    // jsdom / degenerate: distance-based fallback
    return { grip: "tl", dirX: 0, dirY: 0, reach: 0 };
  }
  return gripAt(e.clientX, e.clientY, rect);
}

export function SqueezeCard({ card, onPeek, onReveal }: SqueezeCardProps) {
  const [bend, setBend] = useState(0);
  const [peelGrip, setPeelGrip] = useState<PeelGrip>("tl");
  const start = useRef<{ x: number; y: number } | null>(null);
  const grip = useRef<Grip | null>(null);
  const peekedThisGesture = useRef(false);
  const revealedThisGesture = useRef(false);
  const draggedThisGesture = useRef(false);
  // A pointer drag is resolved by the pointer handlers; suppress the synthetic
  // `click` the browser fires afterward so it doesn't advance the card again.
  const suppressClick = useRef(false);

  const faceUp = isFaceUp(card);

  /** Progress tracks the pointer: movement INTO the card peels, retreating
   *  un-peels, and the fold chases the finger across the diagonal. Without
   *  real geometry (tests) it falls back to plain drag distance. */
  function progressFrom(clientX: number, clientY: number): number {
    if (start.current === null) return 0;
    const dx = clientX - start.current.x;
    const dy = clientY - start.current.y;
    const g = grip.current;
    if (g && g.reach > 0) {
      const along = dx * g.dirX + dy * g.dirY;
      return Math.min(Math.max(along / g.reach, 0), 1);
    }
    return Math.min(Math.hypot(dx, dy) / DRAG_DISTANCE_PX, 1);
  }

  function handlePointerDown(e: ReactPointerEvent) {
    if (faceUp) return;
    start.current = { x: e.clientX, y: e.clientY };
    grip.current = gripFrom(e);
    setPeelGrip(grip.current.grip);
    peekedThisGesture.current = false;
    revealedThisGesture.current = false;
    draggedThisGesture.current = false;
    e.currentTarget.setPointerCapture?.(e.pointerId);
  }

  function handlePointerMove(e: ReactPointerEvent) {
    if (faceUp || start.current === null) return;
    const dist = Math.hypot(e.clientX - start.current.x, e.clientY - start.current.y);
    if (dist > TAP_SLOP_PX) {
      draggedThisGesture.current = true;
    }
    const progress = progressFrom(e.clientX, e.clientY);
    setBend(progress);
    // Dragging only ever peeks — it grows the corner fold. The full flip is
    // committed on release (handlePointerUp), so the player can squeeze and
    // linger on the peek instead of the card snapping face-up mid-drag.
    // Fire peek as soon as progress crosses the threshold, even if a single
    // fast move jumps well past it, so a quick drag never skips the peek.
    if (progress >= PEEK_AT && !peekedThisGesture.current) {
      peekedThisGesture.current = true;
      if (!isPeeked(card)) onPeek();
    }
  }

  function handlePointerUp(e: ReactPointerEvent) {
    if (faceUp || start.current === null) return;
    const progress = progressFrom(e.clientX, e.clientY);
    // Releasing a started squeeze past the peek point commits the flip.
    if (!revealedThisGesture.current && progress >= PEEK_AT) {
      revealedThisGesture.current = true;
      onReveal();
    }
    // If this gesture was a real drag (or already acted), the pointer path has
    // resolved it; swallow the trailing synthetic click so it doesn't re-advance
    // a card the user peeked-then-retreated from.
    suppressClick.current =
      draggedThisGesture.current ||
      peekedThisGesture.current ||
      revealedThisGesture.current;
    start.current = null;
    setBend(0);
  }

  function advanceOneStep() {
    if (faceUp) return;
    if (isPeeked(card)) onReveal();
    else onPeek();
  }

  function handleClick() {
    // Swallow the synthetic click that follows a resolved pointer drag.
    if (suppressClick.current) {
      suppressClick.current = false;
      return;
    }
    // Only treat as a tap when no drag gesture is in progress.
    if (start.current !== null) return;
    advanceOneStep();
  }

  function handleKeyDown(e: ReactKeyboardEvent) {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      advanceOneStep();
    }
  }

  return (
    <div
      role="button"
      style={{ touchAction: "none" }}
      tabIndex={faceUp ? -1 : 0}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
    >
      <Card card={card} bend={bend} grip={peelGrip} />
    </div>
  );
}
