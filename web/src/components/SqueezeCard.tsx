import { useEffect, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent, KeyboardEvent as ReactKeyboardEvent } from "react";
import type { CardView } from "../engine/types";
import { Card } from "./Card";
import { isFaceUp } from "../cards";
import { foldFrom, gripFrom, PEEK_AT, REVEAL_AT, type Fold } from "../squeeze";
import { CardGLOverlay, type GesturePort } from "../cardgl/CardGLOverlay";
import { CardGLEngine } from "../cardgl/engine";

const DRAG_DISTANCE_PX = 120;
/** Pointer travel (px) above which a gesture counts as a drag, not a tap. */
const TAP_SLOP_PX = 8;

// The GL gate, checked once: real curvature when WebGL2 is there and the
// user hasn't asked for reduced motion; otherwise the CSS peel carries on.
let glChecked = false;
let glOk = false;
function glMode(): boolean {
  if (!glChecked) {
    glChecked = true;
    glOk =
      CardGLEngine.isSupported() &&
      !(typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches);
  }
  return glOk;
}

interface SqueezeCardProps {
  card: CardView;
  onPeek: () => void;
  onReveal: () => void;
}

function isPeeked(card: CardView): boolean {
  return card !== "FaceDown" && typeof card === "object" && "Peeked" in card;
}

/** What pointer-down pinned: the grab point and the card's geometry. */
interface Grab {
  x: number;
  y: number;
  rect: { left: number; top: number; width: number; height: number };
}

/** The card's padding box in viewport coordinates — the box the peel's
 *  clip-path percentages actually resolve against. */
function cardPaddingBox(wrapper: Element): Grab["rect"] {
  const card = wrapper.querySelector(".card");
  if (!card) return { left: 0, top: 0, width: 0, height: 0 };
  const r = card.getBoundingClientRect();
  const cs = typeof getComputedStyle !== "undefined" ? getComputedStyle(card) : null;
  const edge = (v: string | undefined) => parseFloat(v ?? "") || 0;
  const bl = edge(cs?.borderLeftWidth);
  const bt = edge(cs?.borderTopWidth);
  return {
    left: r.left + bl,
    top: r.top + bt,
    width: Math.max(r.width - bl - edge(cs?.borderRightWidth), 0),
    height: Math.max(r.height - bt - edge(cs?.borderBottomWidth), 0),
  };
}

export function SqueezeCard({ card, onPeek, onReveal }: SqueezeCardProps) {
  const [fold, setFold] = useState<Fold | null>(null);
  const [glActive, setGlActive] = useState(false);
  const port = useRef<GesturePort>({ drag: null, release: null });
  const glRect = useRef<{ width: number; height: number }>({ width: 0, height: 0 });
  const wrapperRef = useRef<HTMLDivElement>(null);
  const start = useRef<Grab | null>(null);
  const springRaf = useRef(0);
  useEffect(() => () => cancelAnimationFrame(springRaf.current), []);

  /** Released card stock doesn't vanish — it springs flat with a small
   *  flutter (a damped bounce re-bending once before it settles). The GL
   *  overlay runs its own flutter; this is the CSS fallback's. */
  function springBack(grab: Grab, fx: number, fy: number) {
    cancelAnimationFrame(springRaf.current);
    if (
      typeof matchMedia !== "undefined" &&
      matchMedia("(prefers-reduced-motion: reduce)").matches
    ) {
      setFold(null);
      return;
    }
    const t0 = performance.now();
    const TAU = 140; // ms — how fast the energy drains
    const OMEGA = 0.013; // rad/ms — flat at ~120ms, one soft re-bend after
    const step = (now: number) => {
      const t = now - t0;
      const s = Math.exp(-t / TAU) * Math.abs(Math.cos(OMEGA * t));
      if (s < 0.02) {
        setFold(null);
        return;
      }
      const x = grab.x + (fx - grab.x) * s;
      const y = grab.y + (fy - grab.y) * s;
      setFold(foldFrom(grab.x, grab.y, x, y, grab.rect));
      springRaf.current = requestAnimationFrame(step);
    };
    springRaf.current = requestAnimationFrame(step);
  }
  const peekedThisGesture = useRef(false);
  const revealedThisGesture = useRef(false);
  const draggedThisGesture = useRef(false);
  // A pointer drag is resolved by the pointer handlers; suppress the synthetic
  // `click` the browser fires afterward so it doesn't advance the card again.
  const suppressClick = useRef(false);

  const faceUp = isFaceUp(card);

  /** Drag progress for the thresholds. Without real geometry (tests)
   *  progress falls back to plain drag distance. */
  function progressAt(clientX: number, clientY: number): number {
    const grab = start.current;
    if (grab === null) return 0;
    if (grab.rect.width === 0 || grab.rect.height === 0) {
      const dist = Math.hypot(clientX - grab.x, clientY - grab.y);
      return Math.min(dist / DRAG_DISTANCE_PX, 1);
    }
    return gripFrom(grab.x, grab.y, clientX, clientY, grab.rect)?.progress ?? 0;
  }

  function handlePointerDown(e: ReactPointerEvent) {
    if (faceUp) return;
    cancelAnimationFrame(springRaf.current);
    const rect = cardPaddingBox(e.currentTarget);
    start.current = {
      x: e.clientX,
      y: e.clientY,
      // Measure the card's padding box, NOT this wrapper: the fold's clip
      // percentages resolve against the peel spans (inset 0 inside the
      // card's border), so any other box squashes the fold off the finger.
      rect,
    };
    peekedThisGesture.current = false;
    revealedThisGesture.current = false;
    draggedThisGesture.current = false;
    if (glMode() && rect.width > 0) {
      glRect.current = { width: rect.width, height: rect.height };
      port.current = { drag: null, release: null };
      setGlActive(true);
    }
    e.currentTarget.setPointerCapture?.(e.pointerId);
  }

  function handlePointerMove(e: ReactPointerEvent) {
    if (faceUp || start.current === null) return;
    const grab = start.current;
    const dist = Math.hypot(e.clientX - grab.x, e.clientY - grab.y);
    if (dist > TAP_SLOP_PX) {
      draggedThisGesture.current = true;
    }
    const progress = progressAt(e.clientX, e.clientY);
    if (glMode() && glActive && grab.rect.width > 0) {
      // GL mode: the overlay reads the port each frame — no state, no
      // re-render, the fold rides the raw pointer at display rate
      port.current.drag = {
        gx: grab.x - grab.rect.left,
        gy: grab.y - grab.rect.top,
        fx: e.clientX - grab.rect.left,
        fy: e.clientY - grab.rect.top,
      };
    } else {
      setFold(grab.rect.width > 0 ? foldFrom(grab.x, grab.y, e.clientX, e.clientY, grab.rect) : null);
    }
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
    const progress = progressAt(e.clientX, e.clientY);
    // Only a DEEP pull commits the flip on release. Letting go of a
    // shallower squeeze keeps the card down — peeking costs nothing, the
    // reveal is a deliberate act.
    if (!revealedThisGesture.current && progress >= REVEAL_AT) {
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
    const grab = start.current;
    start.current = null;
    if (glMode() && glActive && grab.rect.width > 0) {
      if (draggedThisGesture.current) {
        // hand the gesture to the overlay: flutter flat, or turn it over
        port.current.drag = null;
        port.current.release = {
          kind: revealedThisGesture.current ? "flip" : "settle",
          gx: grab.x - grab.rect.left,
          gy: grab.y - grab.rect.top,
          fx: e.clientX - grab.rect.left,
          fy: e.clientY - grab.rect.top,
        };
      } else {
        // a tap: nothing to animate from this gesture
        setGlActive(false);
      }
      return;
    }
    // a revealed card flips face-up — no stock left to spring
    if (!revealedThisGesture.current && fold !== null) {
      springBack(grab, e.clientX, e.clientY);
    } else {
      setFold(null);
    }
  }

  function advanceOneStep() {
    if (faceUp) return;
    if (isPeeked(card)) {
      // a tap-reveal still deserves the real flip: run it from a
      // synthetic bottom-edge grip, like a dealer turning the card
      if (glMode() && wrapperRef.current) {
        const rect = cardPaddingBox(wrapperRef.current);
        if (rect.width > 0) {
          glRect.current = { width: rect.width, height: rect.height };
          port.current = {
            drag: null,
            release: {
              kind: "flip",
              gx: rect.width / 2,
              gy: rect.height - 2,
              fx: rect.width / 2,
              fy: rect.height * 0.45,
            },
          };
          setGlActive(true);
        }
      }
      onReveal();
    } else {
      onPeek();
    }
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
      ref={wrapperRef}
      role="button"
      // a folding card rises above its neighbors — the wrapper must carry
      // the z-order, since the card's own z-index can't escape it
      style={{ touchAction: "none", position: "relative", zIndex: fold || glActive ? 3 : undefined }}
      tabIndex={faceUp ? -1 : 0}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
    >
      {/* opacity (not visibility) keeps the labels in the a11y tree while
          the GL overlay owns the pixels */}
      <span style={glActive ? { opacity: 0 } : undefined}>
        <Card card={card} fold={fold} restFlat />
      </span>
      {glActive && (
        <CardGLOverlay
          card={card}
          cardW={glRect.current.width}
          cardH={glRect.current.height}
          port={port}
          onDone={() => setGlActive(false)}
        />
      )}
    </div>
  );
}
