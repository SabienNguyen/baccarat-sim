import { useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent, KeyboardEvent as ReactKeyboardEvent } from "react";
import type { CardView } from "../engine/types";
import { Card, type PeelCorner } from "./Card";
import { isFaceUp } from "../cards";
import { PEEK_AT } from "../squeeze";

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

/** Which corner of the card the pointer grabbed (falls back to top-left). */
function grabbedCorner(e: ReactPointerEvent): PeelCorner {
  const rect = e.currentTarget.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) return "tl"; // jsdom / degenerate
  const right = e.clientX > rect.left + rect.width / 2;
  const bottom = e.clientY > rect.top + rect.height / 2;
  if (right && bottom) return "br";
  if (right) return "tr";
  if (bottom) return "bl";
  return "tl";
}

export function SqueezeCard({ card, onPeek, onReveal }: SqueezeCardProps) {
  const [bend, setBend] = useState(0);
  const [corner, setCorner] = useState<PeelCorner>("tl");
  const start = useRef<{ x: number; y: number } | null>(null);
  const peekedThisGesture = useRef(false);
  const revealedThisGesture = useRef(false);
  const draggedThisGesture = useRef(false);
  // A pointer drag is resolved by the pointer handlers; suppress the synthetic
  // `click` the browser fires afterward so it doesn't advance the card again.
  const suppressClick = useRef(false);

  const faceUp = isFaceUp(card);

  /** Progress is plain drag distance, so the peel works whichever way you pull. */
  function progressFrom(clientX: number, clientY: number): number {
    if (start.current === null) return 0;
    const dist = Math.hypot(clientX - start.current.x, clientY - start.current.y);
    return Math.min(dist / DRAG_DISTANCE_PX, 1);
  }

  function handlePointerDown(e: ReactPointerEvent) {
    if (faceUp) return;
    start.current = { x: e.clientX, y: e.clientY };
    setCorner(grabbedCorner(e));
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
      <Card card={card} bend={bend} corner={corner} />
    </div>
  );
}
