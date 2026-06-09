import { useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent, KeyboardEvent as ReactKeyboardEvent } from "react";
import type { CardView } from "../engine/types";
import { Card } from "./Card";
import { isFaceUp } from "../cards";
import { actionForProgress, PEEK_AT } from "../squeeze";

const DRAG_DISTANCE_PX = 120;

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
    e.currentTarget.setPointerCapture?.(e.pointerId);
  }

  function handlePointerMove(e: ReactPointerEvent) {
    if (faceUp || startY.current === null) return;
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
    startY.current = null;
    if (!revealedThisGesture.current && progress >= PEEK_AT) {
      revealedThisGesture.current = true;
      onReveal();
    }
    setBend(0);
  }

  function advanceOneStep() {
    if (faceUp) return;
    if (isPeeked(card)) onReveal();
    else onPeek();
  }

  function handleClick() {
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
