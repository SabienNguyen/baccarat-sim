// The GL squeeze's stage: an overlay canvas covering the active card plus
// working room for the lifted flap and shadow. The render loop lives
// outside React — SqueezeCard mutates the gesture port, the rAF loop
// reads it, and React only hears back when the gesture fully resolves.
import { useEffect, useRef } from "react";
import type { MutableRefObject } from "react";
import type { CardView } from "../engine/types";
import { gripFrom } from "../squeeze";
import { curlFromGrip, poseFrom, flipFrame, FLIP_MS } from "./curlMath";
import type { CurlParams, BodyPose } from "./curlMath";
import { springStep, flutterScale, type SpringState } from "./springs";
import { buildFaceOps, buildBackOps, buildStockOps, paintTexture } from "./facePainter";
import { CardGLEngine } from "./engine";

// best effort: warm the card fonts so the first texture paint is crisp
if (typeof document !== "undefined" && "fonts" in document) {
  document.fonts.load('14px "Press Start 2P"').catch(() => {});
  document.fonts.load('17px "VT323"').catch(() => {});
}

/** SqueezeCard → overlay, by mutation: no React state on the hot path.
 *  Coordinates are card-local px. */
export interface GesturePort {
  /** live pointer while a finger is down */
  drag: { gx: number; gy: number; fx: number; fy: number } | null;
  /** one-shot on release: flutter flat, or commit the reveal flip */
  release: { kind: "settle" | "flip"; gx: number; gy: number; fx: number; fy: number } | null;
}

/** The slice of CardGLEngine the overlay drives — tests inject a fake. */
export interface OverlayEngine {
  render(curl: CurlParams, pose: BodyPose): void;
  setTopTexture(src: TexImageSource): void;
  setBotTexture(src: TexImageSource): void;
  dispose(): void;
  onContextLost?: () => void;
}

/** Finger-tracking stiffness (1/s): tight, but the stock has weight. */
const SPRING_OMEGA = 28;

interface Props {
  card: CardView;
  cardW: number;
  cardH: number;
  port: MutableRefObject<GesturePort>;
  onDone: () => void;
  /** test seam; production builds the real engine */
  engineFactory?: (canvas: HTMLCanvasElement, w: number, h: number, pad: number, dpr: number) => OverlayEngine;
}

export function CardGLOverlay({ card, cardW, cardH, port, onDone, engineFactory }: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const cardRef = useRef(card);
  cardRef.current = card;
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;
  const pad = Math.round(0.6 * cardW);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = Math.min(typeof devicePixelRatio !== "undefined" ? devicePixelRatio : 1, 2);
    const texScale = Math.min(dpr * 2, 3);
    let engine: OverlayEngine;
    try {
      engine = (engineFactory ?? ((c, w, h, p, d) => new CardGLEngine(c, w, h, p, d)))(canvas, cardW, cardH, pad, dpr);
    } catch {
      onDoneRef.current();
      return;
    }
    engine.onContextLost = () => onDoneRef.current();

    const back = paintTexture(buildBackOps(), cardW, cardH, texScale);
    if (back) engine.setTopTexture(back);
    const stock = paintTexture(buildStockOps(), cardW, cardH, texScale);
    if (stock) engine.setBotTexture(stock);

    // The card's underside: blank stock until peeked, then the printed
    // face (indices covered, thumbs on edge grips), the full face once
    // it turns. Repainted only when the wanted kind changes.
    let botKind = "stock";
    const wantBot = (edgeGrip: boolean): { kind: string; paint: () => HTMLCanvasElement | null } => {
      const c = cardRef.current;
      if (c !== "FaceDown" && typeof c === "object" && "FaceUp" in c) {
        const { rank, suit } = c.FaceUp;
        return {
          kind: `up-${rank}-${suit}`,
          paint: () => paintTexture(buildFaceOps(rank, suit), cardW, cardH, texScale),
        };
      }
      if (c !== "FaceDown" && typeof c === "object" && "Peeked" in c) {
        const { rank, suit } = c.Peeked.sliver;
        return {
          kind: `peek-${rank}-${suit}-${edgeGrip}`,
          paint: () =>
            paintTexture(buildFaceOps(rank, suit, { coverIndices: true, thumbs: edgeGrip }), cardW, cardH, texScale),
        };
      }
      return { kind: "stock", paint: () => stock };
    };

    const fx: SpringState = { x: 0, v: 0 };
    const fy: SpringState = { x: 0, v: 0 };
    let sprung = false;
    let mode: "drag" | "settle" | "flip" = "drag";
    let t0 = 0;
    let from: { gx: number; gy: number; fx: number; fy: number } | null = null;
    let last = 0;
    let raf = 0;
    const rect = { left: 0, top: 0, width: cardW, height: cardH };
    const minDim = Math.min(cardW, cardH);

    const frame = (now: number) => {
      const dt = Math.min(now - (last || now), 50);
      last = now;
      const p = port.current;

      // a fresh grab interrupts a settle/flip-in-waiting: back to dragging
      if (mode !== "drag" && p.drag && !p.release) {
        mode = "drag";
        sprung = false;
        from = null;
      }

      if (mode === "drag" && p.release) {
        mode = p.release.kind;
        t0 = now;
        // the flutter/flip starts from the sprung finger, not the raw one
        from = {
          gx: p.release.gx,
          gy: p.release.gy,
          fx: sprung ? fx.x : p.release.fx,
          fy: sprung ? fy.x : p.release.fy,
        };
      }

      if (mode === "drag") {
        if (p.drag) {
          if (!sprung) {
            // the fold starts at the finger, no lag on contact
            fx.x = p.drag.fx;
            fy.x = p.drag.fy;
            fx.v = fy.v = 0;
            sprung = true;
          }
          const sx = springStep(fx, p.drag.fx, SPRING_OMEGA, dt);
          const sy = springStep(fy, p.drag.fy, SPRING_OMEGA, dt);
          fx.x = sx.x;
          fx.v = sx.v;
          fy.x = sy.x;
          fy.v = sy.v;
          const grip = gripFrom(p.drag.gx, p.drag.gy, fx.x, fy.x, rect);
          if (grip) {
            const tex = wantBot(grip.edge);
            if (tex.kind !== botKind) {
              const c = tex.paint();
              if (c) {
                engine.setBotTexture(c);
                botKind = tex.kind;
              }
            }
            engine.render(curlFromGrip(grip, cardW, cardH), poseFrom(grip, cardW, cardH));
          }
        }
      } else if (mode === "settle" && from) {
        const s = flutterScale(now - t0);
        const grip =
          s > 0 ? gripFrom(from.gx, from.gy, from.gx + (from.fx - from.gx) * s, from.gy + (from.fy - from.gy) * s, rect) : null;
        if (grip) {
          engine.render(curlFromGrip(grip, cardW, cardH), poseFrom(grip, cardW, cardH));
        } else {
          onDoneRef.current();
          return;
        }
      } else if (mode === "flip" && from) {
        const t = now - t0;
        const grip = gripFrom(from.gx, from.gy, from.fx, from.fy, rect);
        if (!grip || t >= FLIP_MS) {
          onDoneRef.current();
          return;
        }
        const tex = wantBot(grip.edge);
        if (tex.kind !== botKind) {
          const c = tex.paint();
          if (c) {
            engine.setBotTexture(c);
            botKind = tex.kind;
          }
        }
        const ff = flipFrame(t);
        const curl = curlFromGrip(grip, cardW, cardH);
        curl.apex *= ff.curlScale;
        engine.render(curl, poseFrom(grip, cardW, cardH, { ...ff, lift: ff.lift * 0.35 * minDim }));
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(raf);
      engine.dispose();
    };
    // mount-once: the loop reads everything live through refs
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden
      style={{
        position: "absolute",
        left: -pad,
        top: -pad,
        width: cardW + 2 * pad,
        height: cardH + 2 * pad,
        pointerEvents: "none",
        zIndex: 4,
      }}
    />
  );
}
