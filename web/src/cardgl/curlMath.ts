// The squeeze's geometry: card stock is inextensible, so every shape it
// takes is a flat sheet wrapped around a roll (a developable surface).
// This module is the single source of truth for that deformation — the
// vertex shader in shaders.ts is a line-for-line port and MUST stay in
// lockstep with deform().
import type { Grip } from "../squeeze";

/** Pinch parabola half-width standing in for "infinite" on edge grips:
 *  the falloff term vanishes and the roll is a pure cylinder. */
export const EDGE_HALF = 1e6;
/** Roll radius floor (px) — guards the division as the roll dies out. */
export const R_MIN = 0.75;

export interface CurlParams {
  /** grab point, card-local px */
  gx: number;
  gy: number;
  /** unit drag direction */
  nx: number;
  ny: number;
  /** unit crease direction */
  ux: number;
  uy: number;
  /** crease depth (px) */
  apex: number;
  /** parabola half-width (px) */
  half: number;
  /** roll radius at the grab column (px) */
  radius: number;
  /** lift of the free flap past the roll (rad) */
  theta: number;
  progress: number;
}

/** The roll the stock makes for this grip: a light touch is a lazy wide
 *  arc, a deep squeeze a tight curl about to crease. */
export function curlFromGrip(grip: Grip, cardW: number, cardH: number): CurlParams {
  const minDim = Math.min(cardW, cardH);
  const radius = Math.max(0.16 * minDim * (1.25 - 0.75 * grip.progress), 4);
  const theta = 0.35 * grip.progress;
  return {
    gx: grip.gx,
    gy: grip.gy,
    nx: grip.nx,
    ny: grip.ny,
    ux: grip.ux,
    uy: grip.uy,
    apex: grip.apex,
    half: grip.edge ? EDGE_HALF : grip.half,
    radius,
    theta,
    progress: grip.progress,
  };
}

export interface DeformedPoint {
  x: number;
  y: number;
  z: number;
}

/**
 * The u-modulated roll: per crease-parallel column, a 2D cylinder roll in
 * the drag direction, its amplitude shaped by the pinch parabola. The
 * contact line vt = a + (πr/2)·fall budgets the material the roll
 * consumes, which makes the fold's invariant exact: at full falloff and
 * theta 0 the grabbed edge lands at 2·apex — under the finger, exactly
 * like the CSS mirror model it replaces.
 */
export function deform(p: CurlParams, x: number, y: number): DeformedPoint {
  const dxg = x - p.gx;
  const dyg = y - p.gy;
  const du = dxg * p.ux + dyg * p.uy;
  const dv = dxg * p.nx + dyg * p.ny;
  const t = du / p.half;
  const fall = Math.max(1 - t * t, 0);
  if (fall <= 0 || p.apex < 1e-3) return { x, y, z: 0 };
  const a = p.apex * fall;
  const r = Math.max(p.radius * fall, R_MIN);
  const vt = a + Math.PI * r * 0.5 * fall;
  const s = vt - dv;
  let v2: number;
  let z: number;
  if (s <= 0) {
    // still resting on the felt, past the contact line
    v2 = dv;
    z = 0;
  } else if (s < Math.PI * r) {
    // wrapping up and over the roll
    const phi = s / r;
    v2 = vt - r * Math.sin(phi);
    z = r * (1 - Math.cos(phi));
  } else {
    // the free flap: straight stiff stock, lifted toward the fingers
    const e = s - Math.PI * r;
    v2 = vt + e * Math.cos(p.theta);
    z = 2 * r + e * Math.sin(p.theta);
  }
  return { x: p.gx + du * p.ux + v2 * p.nx, y: p.gy + du * p.uy + v2 * p.ny, z };
}

/** Rigid whole-card motion layered over the fold. */
export interface BodyPose {
  /** hinge axis direction in the card plane */
  tipAxis: [number, number];
  /** hinge point — the edge resting on the felt */
  tipPivot: [number, number];
  /** body tip toward the camera (rad) */
  tipRad: number;
  /** crease direction — the reveal's turn axis */
  flipAxis: [number, number];
  /** 0 while squeezing; 0→π during the flip */
  flipRad: number;
  /** extra z translation (px) */
  lift: number;
  /** grow toward the camera */
  scale: number;
}

export interface FlipFrame {
  rotU: number;
  lift: number;
  curlScale: number;
  settle: number;
}

/** Port of the CSS squeeze transform: tip about the edge opposite the
 *  pull, slight grow — exactly as Card.tsx computed it. */
export function poseFrom(grip: Grip, cardW: number, cardH: number, flip?: FlipFrame): BodyPose {
  const phi = (grip.angle * Math.PI) / 180;
  const p = grip.progress;
  const curl = flip ? flip.curlScale : 1;
  return {
    tipAxis: [Math.cos(phi), Math.sin(phi)],
    tipPivot: [(0.5 + 0.5 * Math.sin(phi)) * cardW, (0.5 - 0.5 * Math.cos(phi)) * cardH],
    tipRad: ((16 * p * Math.PI) / 180) * curl,
    flipAxis: [grip.ux, grip.uy],
    flipRad: flip ? flip.rotU : 0,
    lift: flip ? flip.lift : 0,
    scale: (1 + 0.02 * p) * (flip ? flip.settle : 1),
  };
}

/** The reveal: a rigid turn over the crease axis while the curl relaxes
 *  mid-air — the card lands face-up in its own slot. lift is 0..1 (the
 *  overlay scales it to px). Includes a small landing settle pop. */
export const FLIP_MS = 560;
export function flipFrame(tMs: number): FlipFrame {
  const t = Math.min(Math.max(tMs / FLIP_MS, 0), 1);
  const ease = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
  return {
    rotU: Math.PI * ease,
    lift: Math.sin(Math.PI * t),
    curlScale: Math.max(1 - t / 0.55, 0),
    settle: t > 0.92 ? 1 + 0.04 * Math.sin(((t - 0.92) / 0.08) * Math.PI) : 1,
  };
}
