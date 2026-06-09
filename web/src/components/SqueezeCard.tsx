import { useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent, KeyboardEvent as ReactKeyboardEvent } from "react";
import type { CardView } from "../engine/types";
import { Card } from "./Card";
import { isFaceUp } from "../cards";
import { actionForProgress, PEEK_AT } from "../squeeze";

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

export function SqueezeCard({ card, onPeek, onReveal }: SqueezeCardProps) {
  const [bend, setBend] = useState(0);
  const startY = useRef<number | null>(null);
  const peekedThisGesture = useRef(false);
  const revealedThisGesture = useRef(false);
  const draggedThisGesture = useRef(false);
  // A pointer drag is resolved by the pointer handlers; suppress the synthetic
  // `click` the browser fires afterward so it doesn't advance the card again.
  const suppressClick = useRef(false);

  const faceUp = isFaceUp(card);

  function progressFrom(clientY: number): number {
    if (startY.current === null) return 0;
    return Math.min(Math.max((startY.current - clientY) / DRAG_DISTANCE_PX, 0), 1);
  }

  function handlePointerDown(e: ReactPointerEvent) {
    if (faceUp) return;
    startY.current = e.clientY;
    peekedThisGesture.current = false;
    revealedThisGesture.current = false;
    draggedThisGesture.current = false;
    e.currentTarget.setPointerCapture?.(e.pointerId);
  }

  function handlePointerMove(e: ReactPointerEvent) {
    if (faceUp || startY.current === null) return;
    if (Math.abs(startY.current - e.clientY) > TAP_SLOP_PX) {
      draggedThisGesture.current = true;
    }
    const progress = progressFrom(e.clientY);
    setBend(progress);
    const action = actionForProgress(progress);
    if (action === "peek" && !peekedThisGesture.current) {
      peekedThisGesture.current = true;
      if (!isPeeked(card)) onPeek();
    }
    if (action === "reveal" && !revealedThisGesture.current) {
      revealedThisGesture.current = true;
      onReveal();
    }
  }

  function handlePointerUp(e: ReactPointerEvent) {
    if (faceUp || startY.current === null) return;
    const progress = progressFrom(e.clientY);
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
    startY.current = null;
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
    if (startY.current !== null) return;
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
      tabIndex={faceUp ? -1 : 0}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
    >
      <Card card={card} bend={bend} />
    </div>
  );
}
