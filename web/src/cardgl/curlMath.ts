// The squeeze's geometry: card stock is inextensible, so every shape it
// takes is a flat sheet wrapped around a roll (a developable surface).
// This module is the single source of truth for that deformation — the
// vertex shader in shaders.ts is a line-for-line port and MUST stay in
// lockstep with deform().
import type { Grip } from "../squeeze";

/** Roll radius floor (px) — guards the division in the wrap. */
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
  /** roll radius (px) */
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
 * A uniform cylinder roll about the crease: card stock is inextensible
 * and STIFF, so a squeeze folds it about a line — every point displaces
 * identically at equal depth into the fold (no shear: artwork stays
 * rigid, the card's straight edges stay straight). Edge pulls and corner
 * pinches differ only in where the gesture puts the crease. The contact
 * line vt = apex + πr/2 budgets the material the roll consumes, keeping
 * the fold's invariant exact: at theta 0 the grabbed edge lands at
 * 2·apex — under the finger, exactly like the CSS mirror model.
 */
export function deform(p: CurlParams, x: number, y: number): DeformedPoint {
  const dxg = x - p.gx;
  const dyg = y - p.gy;
  const du = dxg * p.ux + dyg * p.uy;
  const dv = dxg * p.nx + dyg * p.ny;
  if (p.apex < 1e-3) return { x, y, z: 0 };
  const a = p.apex;
  const r = Math.max(p.radius, R_MIN);
  const vt = a + Math.PI * r * 0.5;
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
  /** in-plane translation (px) — the flip sliding the card home */
  slide: [number, number];
  /** grow toward the camera */
  scale: number;
}

/** Port of the CSS squeeze transform: tip about the edge opposite the
 *  pull, slight grow — exactly as Card.tsx computed it. */
export function poseFrom(grip: Grip, cardW: number, cardH: number): BodyPose {
  const phi = (grip.angle * Math.PI) / 180;
  const p = grip.progress;
  return {
    tipAxis: [Math.cos(phi), Math.sin(phi)],
    tipPivot: [(0.5 + 0.5 * Math.sin(phi)) * cardW, (0.5 - 0.5 * Math.cos(phi)) * cardH],
    tipRad: (16 * p * Math.PI) / 180,
    slide: [0, 0],
    scale: 1 + 0.02 * p,
  };
}

/**
 * The reveal IS the peel completing: the fold sweeps across the whole
 * card over the release crease (a dealer turning the card over its far
 * edge), then the face-up card slides home into its slot. The mirror
 * about the final crease displaces the card by 2·(aEnd − dv) along the
 * drag; the slide is exactly that vector reversed, so the card lands
 * back where it lay — face up.
 */
export const FLIP_MS = 640;
/** Residual roll radius once the fold has fully closed (px). */
const FLIP_R_END = 1.2;
/** Fraction of the flip spent sweeping the fold; the rest slides home. */
const SWEEP_END = 0.62;

export interface FlipSpec {
  a0: number;
  r0: number;
  theta0: number;
  /** crease depth at which the fold has consumed the whole card */
  aEnd: number;
  /** the slide bringing the mirrored card back into its slot */
  slideX: number;
  slideY: number;
}

export function flipSpecFrom(curl: CurlParams, cardW: number, cardH: number): FlipSpec {
  // the card's farthest extent along the drag, measured from the grab
  let vMax = 0;
  for (const [cx, cy] of [
    [0, 0],
    [cardW, 0],
    [cardW, cardH],
    [0, cardH],
  ]) {
    vMax = Math.max(vMax, (cx - curl.gx) * curl.nx + (cy - curl.gy) * curl.ny);
  }
  const aEnd = vMax + Math.PI * FLIP_R_END * 0.5 + 2;
  const dvC = (cardW / 2 - curl.gx) * curl.nx + (cardH / 2 - curl.gy) * curl.ny;
  return {
    a0: curl.apex,
    r0: curl.radius,
    theta0: curl.theta,
    aEnd,
    slideX: -2 * (aEnd - dvC) * curl.nx,
    slideY: -2 * (aEnd - dvC) * curl.ny,
  };
}

export interface FlipState {
  apex: number;
  radius: number;
  theta: number;
  slideX: number;
  slideY: number;
  /** scales the squeeze body tip away as the fold takes over */
  tipScale: number;
  /** landing pop */
  settle: number;
  done: boolean;
}

export function flipAt(tMs: number, spec: FlipSpec): FlipState {
  const t = Math.min(Math.max(tMs / FLIP_MS, 0), 1);
  const tA = Math.min(t / SWEEP_END, 1);
  const eA = tA < 0.5 ? 4 * tA * tA * tA : 1 - Math.pow(-2 * tA + 2, 3) / 2;
  const tB = Math.max((t - SWEEP_END) / (1 - SWEEP_END), 0);
  const eB = 1 - Math.pow(1 - tB, 3);
  return {
    apex: spec.a0 + (spec.aEnd - spec.a0) * eA,
    // the roll breathes wider mid-turn (a stiff card makes a lazy arc),
    // then tightens so the card lands flat
    radius: spec.r0 + (FLIP_R_END - spec.r0) * tA + 0.35 * spec.r0 * Math.sin(Math.PI * tA),
    theta: spec.theta0 * (1 - tA),
    slideX: spec.slideX * eB,
    slideY: spec.slideY * eB,
    tipScale: Math.max(1 - 2 * tA, 0),
    settle: tB > 0.85 ? 1 + 0.04 * Math.sin(((tB - 0.85) / 0.15) * Math.PI) : 1,
    done: tMs >= FLIP_MS,
  };
}
