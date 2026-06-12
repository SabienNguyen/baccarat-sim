# CardGL Squeeze Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the flat CSS clip-path squeeze with a custom zero-dependency WebGL2 micro-engine rendering true card-stock curvature (developable roll), per-pixel lighting, a projected shadow, spring-driven drag feel, and a real 3D reveal flip — with the CSS peel kept as automatic fallback.

**Architecture:** A per-column cylinder-roll deformation (amplitude shaped by the existing parabolic falloff — edge grips are the exact developable cylinder, pinches read as a cone) computed identically in pure TS (tested) and GLSL (ported). The existing `squeeze.ts` gesture math is refactored to expose its geometric core (`gripFrom`), which both the CSS `foldFrom` path and the new GL path consume. A single overlay canvas per squeezing card; rendering decoupled from React via a mutable gesture port + rAF loop; physics = critically damped springs on the finger position + the existing flutter envelope on release.

**Tech Stack:** React 18, TypeScript, raw WebGL2 (no new dependencies), Canvas2D texture rasterization, vitest/jsdom (GL never active in tests).

**Branch:** `feat/cardgl-squeeze` off `main`. Conventional commits `feat(web): …`. Merge to `main` when all gates pass (CI deploys on push).

**Invariants that must hold throughout:**
- All existing tests stay green after every task (`cd web && npx vitest run`).
- jsdom has no 2D canvas and no WebGL2 → every GL/canvas entry point must null-guard; pure modules carry the test weight.
- No React state updates per pointer-move/rAF frame in GL mode (refs + direct uniform writes only).
- The face textures replicate the DOM card art exactly (colors below), so the GL↔DOM handoff is seamless.

**Color/typography constants (mirrored from theme.css / cards.css — canvas can't read CSS vars):**
`INK #15110f`, `FACE_BG #f6f1e0`, `STOCK_BG #f9f4e6`, `BACK_A #3a2a55`, `BACK_B #4a3a6a`, `BEVEL_HI #4a4060`, `BEVEL_LO #140f1f`, `RED #c0202a`, `BLACK #1a1a1a`, `THUMB_SKIN #d9a679`, fonts `"Press Start 2P"` (display) / `"VT323"` (text).

---

## File Map

| File | Status | Responsibility |
|---|---|---|
| `web/src/cardArt.ts` | create | Card artwork data (pips, glyphs, colors) shared by DOM card + texture painter |
| `web/src/components/Card.tsx` | modify | Import art data from `cardArt.ts` (delete local copies) |
| `web/src/squeeze.ts` | modify | Extract `gripFrom` (geometric core); `foldFrom` delegates to it, outputs unchanged |
| `web/src/cardgl/springs.ts` | create | Critically damped spring step + release flutter envelope |
| `web/src/cardgl/curlMath.ts` | create | Grip→CurlParams, reference deformation, body pose builder, flip timeline |
| `web/src/cardgl/facePainter.ts` | create | Paint-op builders (pure, tested) + canvas executor + texture maker |
| `web/src/cardgl/mat4.ts` | create | Minimal column-major mat4: perspective, multiply, axis rotation through point |
| `web/src/cardgl/shaders.ts` | create | GLSL vertex/fragment source (port of `curlMath.deform`) |
| `web/src/cardgl/engine.ts` | create | `CardGLEngine`: context, mesh, textures, two-pass render, context-loss |
| `web/src/cardgl/CardGLOverlay.tsx` | create | Overlay canvas, rAF loop, drag/settle/flip state machine |
| `web/src/components/SqueezeCard.tsx` | modify | GL mode wiring: gesture port, overlay mount, DOM hide; CSS path untouched as fallback |

Tests: `web/src/cardArt.test.ts` (optional smoke), `web/src/squeeze.test.ts` (add `gripFrom` cases), `web/src/cardgl/springs.test.ts`, `web/src/cardgl/curlMath.test.ts`, `web/src/cardgl/facePainter.test.ts`, `web/src/cardgl/mat4.test.ts`, `web/src/cardgl/overlay.test.tsx`.

---

### Task 0: Branch

- [ ] **Step 0.1:** `git checkout -b feat/cardgl-squeeze` (from clean `main`). Run `cd web && npx vitest run` — expect all green (baseline).

### Task 1: Extract card art data → `web/src/cardArt.ts`

**Files:** Create `web/src/cardArt.ts`; Modify `web/src/components/Card.tsx`.

- [ ] **Step 1.1: Create `web/src/cardArt.ts`** — move (verbatim) from `Card.tsx`: `RANK_SHORT`, `SUIT_GLYPH`, `PIP_LAYOUT`, `COURT_GLYPH`, `suitColor`, all `export`ed, importing `Rank, Suit` from `./engine/types`.
- [ ] **Step 1.2: Modify `Card.tsx`** — delete the local copies, add `import { RANK_SHORT, SUIT_GLYPH, PIP_LAYOUT, COURT_GLYPH, suitColor } from "../cardArt";`.
- [ ] **Step 1.3:** Run `npx vitest run` — all green (pure move; `Card.test.tsx` pins rendering).
- [ ] **Step 1.4:** Commit `refactor(web): extract card artwork data for reuse by the GL texture painter`.

### Task 2: Extract `gripFrom` in `web/src/squeeze.ts`

The geometric core of `foldFrom` (grab/drag frame, cap, apex, half-width, edge banding, progress, angle) becomes an exported `gripFrom`; `foldFrom` consumes it and keeps byte-identical outputs.

- [ ] **Step 2.1: Write failing tests** (append to `web/src/squeeze.test.ts`):

```ts
import { gripFrom } from "./squeeze";

test("gripFrom exposes the fold's geometric core", () => {
  const g = gripFrom(45, 120, 45, 60, RECT)!;
  expect(g.edge).toBe(true);
  expect(g.gx).toBe(45);
  expect(g.gy).toBe(120);
  expect(g.nx).toBeCloseTo(0);
  expect(g.ny).toBeCloseTo(-1);
  expect(g.bend).toBeCloseTo(60);
  expect(g.apex).toBeCloseTo(30);
  expect(g.angle).toBeCloseTo(0);
  expect(g.progress).toBeGreaterThan(0);
});

test("gripFrom matches foldFrom's grip taxonomy and null cases", () => {
  expect(gripFrom(85, 120, 30, 60, RECT)!.edge).toBe(false); // corner pinch
  expect(gripFrom(45, 120, 45, 170, RECT)).toBeNull();       // pull off the card
  expect(gripFrom(45, 120, 45, 120, RECT)).toBeNull();       // no travel
});
```

- [ ] **Step 2.2:** Run `npx vitest run src/squeeze.test.ts` — FAIL (`gripFrom` not exported).
- [ ] **Step 2.3: Refactor `squeeze.ts`.** Add above `foldFrom`:

```ts
/** The geometric core of a squeeze gesture — everything the fold's
 *  geometry derives from, shared by the CSS peel and the GL engine. */
export interface Grip {
  /** grab point, card-local px */
  gx: number;
  gy: number;
  /** unit drag direction */
  nx: number;
  ny: number;
  /** unit crease direction (perpendicular to the drag) */
  ux: number;
  uy: number;
  /** capped finger travel (px) — the fold's depth driver */
  bend: number;
  /** crease depth along the drag = bend/2 (px) */
  apex: number;
  /** half-width of the pinch parabola (px) */
  half: number;
  /** straight side fold vs corner pinch */
  edge: boolean;
  /** 0..1 — drives the peek/reveal thresholds */
  progress: number;
  /** CSS gradient angle (deg): 0 up, clockwise */
  angle: number;
}

export function gripFrom(gx: number, gy: number, fx: number, fy: number, rect: Rect): Grip | null {
  // body: lines moved verbatim from foldFrom — local g, nx/ny, len guard,
  // toward-card dot-product guard, nux/nuy/ux/uy, reach/bend/apex/half,
  // the edge-band classification, then:
  return {
    gx: g.x, gy: g.y, nx: nux, ny: nuy, ux, uy,
    bend, apex, half, edge,
    progress: Math.min(bend / reach, 1),
    angle: (Math.atan2(nx, -ny) * 180) / Math.PI,
  };
}
```

`foldFrom` becomes: call `gripFrom`; on null return null; then the existing polygon/leaf/css-string construction using the Grip fields (`g = {x: grip.gx, y: grip.gy}`, etc.). **No output change.**

- [ ] **Step 2.4:** Run `npx vitest run` — ALL green (the 14 existing foldFrom tests are the refactor's safety net).
- [ ] **Step 2.5:** Commit `refactor(web): expose gripFrom — the squeeze gesture's geometric core`.

### Task 3: `web/src/cardgl/springs.ts`

- [ ] **Step 3.1: Write failing tests** `web/src/cardgl/springs.test.ts`:

```ts
import { springStep, flutterScale, type SpringState } from "./springs";

test("a critically damped spring converges without overshoot", () => {
  let s: SpringState = { x: 0, v: 0 };
  for (let i = 0; i < 60; i++) {
    s = springStep(s, 100, 30, 16);
    expect(s.x).toBeLessThanOrEqual(100 + 1e-9); // never crosses the target
  }
  expect(Math.abs(s.x - 100)).toBeLessThan(0.5);
});

test("the spring is stable at huge time steps", () => {
  let s: SpringState = { x: 0, v: 500 };
  s = springStep(s, 100, 30, 500);
  expect(Number.isFinite(s.x)).toBe(true);
  expect(Math.abs(s.x - 100)).toBeLessThan(5);
});

test("flutter starts at full hold and dies out", () => {
  expect(flutterScale(0)).toBeCloseTo(1);
  expect(flutterScale(1000)).toBe(0);
});

test("flutter re-bends once before settling", () => {
  // |cos| zero near 121ms, local max near 242ms: the one soft re-bend
  expect(flutterScale(242)).toBeGreaterThan(flutterScale(121) + 0.1);
});
```

- [ ] **Step 3.2:** Run — FAIL (module missing).
- [ ] **Step 3.3: Implement `web/src/cardgl/springs.ts`:**

```ts
export interface SpringState {
  x: number;
  v: number;
}

/** One exact step of a critically damped spring toward `target`.
 *  Closed-form (not Euler), so it is stable at any dt. omega: 1/s. */
export function springStep(s: SpringState, target: number, omega: number, dtMs: number): SpringState {
  const dt = dtMs / 1000;
  const dx = s.x - target;
  const tmp = (s.v + omega * dx) * dt;
  const decay = Math.exp(-omega * dt);
  return { x: target + (dx + tmp) * decay, v: (s.v - omega * tmp) * decay };
}

/** Released card stock springs flat with one soft re-bend: a damped
 *  oscillation envelope on the curl depth. 1 = fold fully held, 0 = flat.
 *  Same constants the CSS spring-back used, so the feel carries over. */
export const FLUTTER_TAU = 140; // ms
export const FLUTTER_OMEGA = 0.013; // rad/ms
export function flutterScale(tMs: number): number {
  const s = Math.exp(-tMs / FLUTTER_TAU) * Math.abs(Math.cos(FLUTTER_OMEGA * tMs));
  return s < 0.02 ? 0 : s;
}
```

- [ ] **Step 3.4:** Run — PASS. **Step 3.5:** Commit `feat(web): parameter-space springs for the GL squeeze`.

### Task 4: `web/src/cardgl/curlMath.ts` — curl params, reference deformation, poses, flip timeline

- [ ] **Step 4.1: Write failing tests** `web/src/cardgl/curlMath.test.ts`:

```ts
import { gripFrom } from "../squeeze";
import { curlFromGrip, deform, poseFrom, flipFrame, EDGE_HALF, FLIP_MS, type CurlParams } from "./curlMath";

const RECT = { left: 0, top: 0, width: 90, height: 126 };
// bottom-edge pull: grab (45,124) → finger (45,60); bend 64, apex 32
const grip = gripFrom(45, 124, 45, 60, RECT)!;
const base = curlFromGrip(grip, 90, 126);
const flatTipped: CurlParams = { ...base, theta: 0 };

test("curl params inherit the grip frame; edge grips flatten the falloff", () => {
  expect(base.apex).toBeCloseTo(32);
  expect(base.half).toBe(EDGE_HALF); // straight bottom-edge pull = cylinder
  expect(base.radius).toBeGreaterThan(4);
  expect(base.theta).toBeGreaterThan(0);
});

test("material deeper than the contact line stays flat on the felt", () => {
  const p = deform(base, 45, 20); // v = 104, far past the fold
  expect(p.x).toBeCloseTo(45);
  expect(p.y).toBeCloseTo(20);
  expect(p.z).toBe(0);
});

test("the grabbed edge lands exactly under the finger (theta=0)", () => {
  const tip = deform(flatTipped, 45, 124); // the grab point itself
  // mirrored over the roll: travels bend=64 along the drag (up)
  expect(tip.y).toBeCloseTo(124 - 64, 5);
  expect(tip.x).toBeCloseTo(45, 5);
  expect(tip.z).toBeCloseTo(2 * base.radius, 5); // resting on top of the roll
});

test("the two roll regions meet continuously", () => {
  // find the v where s = πr and sample both sides
  const r = base.radius;
  const vt = base.apex + Math.PI * r * 0.5;
  const vAtBoundary = vt - Math.PI * r;
  const eps = 0.01;
  const a = deform(flatTipped, 45, 124 - (vAtBoundary - eps));
  const b = deform(flatTipped, 45, 124 - (vAtBoundary + eps));
  expect(Math.abs(a.y - b.y)).toBeLessThan(0.1);
  expect(Math.abs(a.z - b.z)).toBeLessThan(0.1);
});

test("the card never sinks through the table", () => {
  for (let x = 0; x <= 90; x += 9) {
    for (let y = 0; y <= 126; y += 9) {
      expect(deform(base, x, y).z).toBeGreaterThanOrEqual(-1e-9);
    }
  }
});

test("a pinch dies out past the parabola's rim", () => {
  const pinch = curlFromGrip(gripFrom(85, 120, 30, 60, RECT)!, 90, 126);
  expect(pinch.half).toBeLessThan(EDGE_HALF);
  // walk along the crease direction well past half: undeformed
  const far = deform(pinch, 85 + pinch.ux * (pinch.half + 30), 120 + pinch.uy * (pinch.half + 30));
  expect(far.z).toBe(0);
});

test("an edge grip deforms uniformly across the card", () => {
  const a = deform(base, 10, 124);
  const b = deform(base, 80, 124);
  expect(a.z).toBeCloseTo(b.z, 5);
  expect(a.y).toBeCloseTo(b.y, 5);
});

test("poseFrom ports the CSS body tip", () => {
  const pose = poseFrom(grip, 90, 126);
  expect(pose.tipRad).toBeCloseTo((16 * grip.progress * Math.PI) / 180);
  expect(pose.scale).toBeCloseTo(1 + 0.02 * grip.progress);
  expect(pose.flipRad).toBe(0);
  expect(pose.lift).toBe(0);
  // straight up pull (angle 0): hinge pivot is the top edge midpoint
  expect(pose.tipPivot[0]).toBeCloseTo(45);
  expect(pose.tipPivot[1]).toBeCloseTo(0);
});

test("the flip turns the card exactly over and settles flat", () => {
  expect(flipFrame(0).rotU).toBeCloseTo(0);
  expect(flipFrame(0).curlScale).toBeCloseTo(1);
  expect(flipFrame(FLIP_MS).rotU).toBeCloseTo(Math.PI);
  expect(flipFrame(FLIP_MS).curlScale).toBe(0);
  expect(flipFrame(FLIP_MS).lift).toBeCloseTo(0, 5);
  expect(flipFrame(FLIP_MS / 2).lift).toBeCloseTo(1, 5); // peak mid-air
  // rotation is monotonic
  let prev = -1;
  for (let t = 0; t <= FLIP_MS; t += 20) {
    const r = flipFrame(t).rotU;
    expect(r).toBeGreaterThanOrEqual(prev);
    prev = r;
  }
});
```

- [ ] **Step 4.2:** Run — FAIL. **Step 4.3: Implement `web/src/cardgl/curlMath.ts`:**

```ts
import type { Grip } from "../squeeze";

/** Pinch parabola half-width standing in for "infinite" on edge grips:
 *  the falloff term vanishes and the roll is a pure cylinder. */
export const EDGE_HALF = 1e6;
/** Roll radius floor (px) — guards the division as the roll dies out. */
export const R_MIN = 0.75;

export interface CurlParams {
  gx: number; gy: number;       // grab, card-local px
  nx: number; ny: number;       // unit drag direction
  ux: number; uy: number;       // unit crease direction
  apex: number;                 // crease depth (px)
  half: number;                 // parabola half-width (px)
  radius: number;               // roll radius at the grab column (px)
  theta: number;                // lift of the free flap past the roll (rad)
  progress: number;
}

/** The roll the stock makes for this grip: a light touch is a lazy wide
 *  arc, a deep squeeze a tight curl about to crease. */
export function curlFromGrip(grip: Grip, cardW: number, cardH: number): CurlParams {
  const minDim = Math.min(cardW, cardH);
  const radius = Math.max(0.16 * minDim * (1.25 - 0.75 * grip.progress), 4);
  const theta = 0.35 * grip.progress;
  return {
    gx: grip.gx, gy: grip.gy, nx: grip.nx, ny: grip.ny, ux: grip.ux, uy: grip.uy,
    apex: grip.apex, half: grip.edge ? EDGE_HALF : grip.half,
    radius, theta, progress: grip.progress,
  };
}

export interface DeformedPoint { x: number; y: number; z: number; }

/**
 * The u-modulated roll: per crease-parallel column, a 2D cylinder roll in
 * the drag direction, its amplitude shaped by the pinch parabola. The
 * contact line vt = a + (πr/2)·fall budgets the material the roll consumes,
 * which makes the fold's invariant exact: at full falloff and theta 0 the
 * grabbed edge lands at 2·apex — under the finger, like the CSS model.
 * MUST stay in lockstep with deform() in shaders.ts.
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
    v2 = dv;
    z = 0;
  } else if (s < Math.PI * r) {
    const phi = s / r;
    v2 = vt - r * Math.sin(phi);
    z = r * (1 - Math.cos(phi));
  } else {
    const e = s - Math.PI * r;
    v2 = vt + e * Math.cos(p.theta);
    z = 2 * r + e * Math.sin(p.theta);
  }
  return { x: p.gx + du * p.ux + v2 * p.nx, y: p.gy + du * p.uy + v2 * p.ny, z };
}

/** Rigid whole-card motion layered over the fold. */
export interface BodyPose {
  tipAxis: [number, number];  // hinge axis direction in the card plane
  tipPivot: [number, number]; // hinge point (the edge resting on the felt)
  tipRad: number;             // body tip toward the camera
  flipAxis: [number, number]; // crease direction — the reveal's turn axis
  flipRad: number;            // 0 while squeezing; 0→π during the flip
  lift: number;               // extra z translation (px)
  scale: number;              // grow toward the camera
}

/** Port of the CSS squeeze transform: tip about the edge opposite the
 *  pull, slight grow, exactly as Card.tsx computed it. */
export function poseFrom(grip: Grip, cardW: number, cardH: number, flip?: { rotU: number; lift: number; curlScale: number; settle: number }): BodyPose {
  const phi = (grip.angle * Math.PI) / 180;
  const p = grip.progress;
  const curl = flip ? flip.curlScale : 1;
  return {
    tipAxis: [Math.cos(phi), Math.sin(phi)],
    tipPivot: [(0.5 + 0.5 * Math.sin(phi)) * cardW, (0.5 - 0.5 * Math.cos(phi)) * cardH],
    tipRad: (16 * p * Math.PI / 180) * curl,
    flipAxis: [grip.ux, grip.uy],
    flipRad: flip ? flip.rotU : 0,
    lift: flip ? flip.lift : 0,
    scale: (1 + 0.02 * p) * (flip ? flip.settle : 1),
  };
}

/** The reveal: a rigid turn over the crease axis while the curl relaxes
 *  mid-air — the card lands face-up in its own slot. lift is 0..1 (the
 *  overlay scales it by 0.35·minDim). */
export const FLIP_MS = 560;
export interface FlipFrame { rotU: number; lift: number; curlScale: number; settle: number }
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
```

- [ ] **Step 4.4:** Run — PASS (the tip-invariant test pins `2·vt − πr = 2a` exactly).
- [ ] **Step 4.5:** Commit `feat(web): curl math — the u-modulated roll with an exact finger invariant`.

### Task 5: `web/src/cardgl/facePainter.ts`

Pure paint-op builders (testable in jsdom) + a thin canvas executor (null-guarded).

- [ ] **Step 5.1: Write failing tests** `web/src/cardgl/facePainter.test.ts`:

```ts
import { buildFaceOps, buildBackOps, buildStockOps, paintTexture, RED, BLACK, REF_W, REF_H } from "./facePainter";

const textOps = (ops: ReturnType<typeof buildFaceOps>) =>
  ops.filter((o) => o.op === "text") as Extract<(typeof ops)[number], { op: "text" }>[];

test("the ace of spades is one big centered pip", () => {
  const ops = buildFaceOps("Ace", "Spades");
  const pips = textOps(ops).filter((o) => o.text === "♠" && o.px === 50);
  expect(pips).toHaveLength(1);
  expect(pips[0].x).toBeCloseTo(50);
  expect(pips[0].color).toBe(BLACK);
});

test("the five of hearts lays five red pips, lower ones flipped", () => {
  const ops = buildFaceOps("Five", "Hearts");
  const pips = textOps(ops).filter((o) => o.text === "♥" && o.px === 17);
  expect(pips).toHaveLength(5);
  expect(pips.every((o) => o.color === RED)).toBe(true);
  expect(pips.filter((o) => o.flip).length).toBe(2); // the y>50% pair
});

test("covering the indices removes exactly the four corner glyphs", () => {
  const full = textOps(buildFaceOps("Nine", "Clubs")).length;
  const covered = textOps(buildFaceOps("Nine", "Clubs", { coverIndices: true })).length;
  expect(full - covered).toBe(4);
});

test("thumbs are two skin ellipses over the index corners", () => {
  const ops = buildFaceOps("Nine", "Clubs", { coverIndices: true, thumbs: true });
  const thumbs = ops.filter((o) => o.op === "ellipse");
  expect(thumbs).toHaveLength(2);
});

test("court cards draw the figure double-ended", () => {
  const ops = buildFaceOps("King", "Diamonds");
  const courts = textOps(ops).filter((o) => o.text === "♚");
  expect(courts).toHaveLength(2);
  expect(courts.filter((o) => o.flip)).toHaveLength(1);
});

test("the back is stripes and bevel on the card blank", () => {
  const kinds = buildBackOps().map((o) => o.op);
  expect(kinds).toContain("stripes");
  expect(kinds).toContain("bevel");
  expect(buildStockOps().map((o) => o.op)).toEqual(["roundRect"]);
});

test("paintTexture degrades to null without 2D canvas (jsdom)", () => {
  expect(paintTexture(buildStockOps(), REF_W, REF_H, 2)).toBeNull();
});
```

- [ ] **Step 5.2:** Run — FAIL. **Step 5.3: Implement** (geometry in 100×143 reference units, scaled by the executor; insets mirror cards.css — pip area `inset 12px 20px`, court `inset 19px 22px`, thumbs at the index corners):

```ts
import type { Rank, Suit } from "../engine/types";
import { PIP_LAYOUT, RANK_SHORT, SUIT_GLYPH, COURT_GLYPH, suitColor } from "../cardArt";

export const REF_W = 100;
export const REF_H = 143;
export const INK = "#15110f";
export const FACE_BG = "#f6f1e0";
export const STOCK_BG = "#f9f4e6";
export const BACK_A = "#3a2a55";
export const BACK_B = "#4a3a6a";
export const BEVEL_HI = "#4a4060";
export const BEVEL_LO = "#140f1f";
export const RED = "#c0202a";
export const BLACK = "#1a1a1a";
export const THUMB_SKIN = "#d9a679";
const FONT_TEXT = '"VT323", ui-monospace, monospace';
const FONT_DISPLAY = '"Press Start 2P", ui-monospace, monospace';

export type PaintOp =
  | { op: "roundRect"; x: number; y: number; w: number; h: number; r: number; fill?: string; stroke?: string; lineWidth?: number }
  | { op: "stripes"; period: number; colorA: string; colorB: string }
  | { op: "bevel"; inset: number; hi: string; lo: string }
  | { op: "text"; text: string; x: number; y: number; px: number; font: string; color: string; flip?: boolean }
  | { op: "ellipse"; x: number; y: number; rx: number; ry: number; fill: string; stroke?: string; lineWidth?: number }
  | { op: "line"; x1: number; y1: number; x2: number; y2: number; color: string; width: number };

const blank = (fill: string): PaintOp => ({ op: "roundRect", x: 1.5, y: 1.5, w: 97, h: 140, r: 9, fill, stroke: INK, lineWidth: 3 });

export function buildFaceOps(rank: Rank, suit: Suit, opts: { coverIndices?: boolean; thumbs?: boolean } = {}): PaintOp[] {
  const color = suitColor(suit) === "red" ? RED : BLACK;
  const ops: PaintOp[] = [blank(FACE_BG)];
  if (!opts.coverIndices) {
    ops.push(
      { op: "text", text: RANK_SHORT[rank], x: 12, y: 13, px: 14, font: FONT_DISPLAY, color },
      { op: "text", text: SUIT_GLYPH[suit], x: 12, y: 27, px: 13, font: FONT_TEXT, color },
      { op: "text", text: RANK_SHORT[rank], x: 88, y: 130, px: 14, font: FONT_DISPLAY, color, flip: true },
      { op: "text", text: SUIT_GLYPH[suit], x: 88, y: 116, px: 13, font: FONT_TEXT, color, flip: true },
    );
  }
  const pips = PIP_LAYOUT[rank];
  if (pips) {
    for (const [px, py] of pips) {
      ops.push({
        op: "text", text: SUIT_GLYPH[suit],
        x: 20 + (px / 100) * 60, y: 12 + (py / 100) * 119,
        px: rank === "Ace" ? 50 : 17, font: FONT_TEXT, color, flip: py > 50,
      });
    }
  }
  const court = COURT_GLYPH[rank];
  if (court) {
    ops.push(
      { op: "roundRect", x: 22, y: 19, w: 56, h: 105, r: 3, stroke: color, lineWidth: 2 },
      { op: "line", x1: 25, y1: 71.5, x2: 75, y2: 71.5, color, width: 1.5 },
      { op: "text", text: court, x: 50, y: 45, px: 30, font: FONT_TEXT, color },
      { op: "text", text: court, x: 50, y: 97, px: 30, font: FONT_TEXT, color, flip: true },
    );
  }
  if (opts.thumbs) {
    ops.push(
      { op: "ellipse", x: 13, y: 17, rx: 13, ry: 12, fill: THUMB_SKIN, stroke: INK, lineWidth: 2 },
      { op: "ellipse", x: 87, y: 126, rx: 13, ry: 12, fill: THUMB_SKIN, stroke: INK, lineWidth: 2 },
    );
  }
  return ops;
}

export function buildBackOps(): PaintOp[] {
  return [blank(BACK_A), { op: "stripes", period: 12, colorA: BACK_A, colorB: BACK_B }, { op: "bevel", inset: 3, hi: BEVEL_HI, lo: BEVEL_LO }];
}

export function buildStockOps(): PaintOp[] {
  return [blank(STOCK_BG)];
}

function traceRoundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

export function applyOps(ctx: CanvasRenderingContext2D, ops: PaintOp[], wPx: number, hPx: number): void {
  ctx.save();
  ctx.scale(wPx / REF_W, hPx / REF_H);
  for (const o of ops) {
    switch (o.op) {
      case "roundRect":
        traceRoundRect(ctx, o.x, o.y, o.w, o.h, o.r);
        if (o.fill) { ctx.fillStyle = o.fill; ctx.fill(); }
        if (o.stroke) { ctx.strokeStyle = o.stroke; ctx.lineWidth = o.lineWidth ?? 1; ctx.stroke(); }
        break;
      case "stripes": {
        ctx.save();
        traceRoundRect(ctx, 3, 3, 94, 137, 7);
        ctx.clip();
        ctx.translate(REF_W / 2, REF_H / 2);
        ctx.rotate(Math.PI / 4);
        const span = REF_W + REF_H;
        for (let i = -span, k = 0; i < span; i += o.period / 2, k++) {
          ctx.fillStyle = k % 2 === 0 ? o.colorA : o.colorB;
          ctx.fillRect(-span, i, span * 2, o.period / 2);
        }
        ctx.restore();
        break;
      }
      case "bevel":
        ctx.lineWidth = 2;
        ctx.strokeStyle = o.hi;
        ctx.beginPath(); ctx.moveTo(o.inset, REF_H - o.inset); ctx.lineTo(o.inset, o.inset); ctx.lineTo(REF_W - o.inset, o.inset); ctx.stroke();
        ctx.strokeStyle = o.lo;
        ctx.beginPath(); ctx.moveTo(REF_W - o.inset, o.inset); ctx.lineTo(REF_W - o.inset, REF_H - o.inset); ctx.lineTo(o.inset, REF_H - o.inset); ctx.stroke();
        break;
      case "text":
        ctx.save();
        ctx.translate(o.x, o.y);
        if (o.flip) ctx.rotate(Math.PI);
        ctx.font = `${o.px}px ${o.font}`;
        ctx.fillStyle = o.color;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(o.text, 0, 0);
        ctx.restore();
        break;
      case "ellipse":
        ctx.beginPath();
        ctx.ellipse(o.x, o.y, o.rx, o.ry, 0, 0, Math.PI * 2);
        ctx.fillStyle = o.fill; ctx.fill();
        if (o.stroke) { ctx.strokeStyle = o.stroke; ctx.lineWidth = o.lineWidth ?? 1; ctx.stroke(); }
        break;
      case "line":
        ctx.beginPath(); ctx.moveTo(o.x1, o.y1); ctx.lineTo(o.x2, o.y2);
        ctx.strokeStyle = o.color; ctx.lineWidth = o.width; ctx.stroke();
        break;
    }
  }
  ctx.restore();
}

/** Rasterize ops at wPx×hPx CSS px × scale. Null where 2D canvas is
 *  unavailable (jsdom) — callers fall back to the CSS peel. */
export function paintTexture(ops: PaintOp[], wPx: number, hPx: number, scale: number): HTMLCanvasElement | null {
  const c = document.createElement("canvas");
  c.width = Math.max(Math.round(wPx * scale), 1);
  c.height = Math.max(Math.round(hPx * scale), 1);
  const ctx = c.getContext("2d");
  if (!ctx) return null;
  ctx.scale(scale, scale);
  applyOps(ctx, ops, wPx, hPx);
  return c;
}
```

- [ ] **Step 5.4:** Run — PASS. **Step 5.5:** Commit `feat(web): canvas face painter — card art as data, rasterized to GL textures`.

### Task 6: `mat4.ts`, `shaders.ts`, `engine.ts`

- [ ] **Step 6.1: Write failing tests** `web/src/cardgl/mat4.test.ts`:

```ts
import { identity, multiply, perspective, translation, rotationAboutAxis, scaleAboutPoint, transformPoint } from "./mat4";

test("identity leaves points alone", () => {
  expect(transformPoint(identity(), [3, 4, 5])).toEqual([3, 4, 5]);
});

test("translation moves, multiply composes", () => {
  const m = multiply(translation(1, 0, 0), translation(0, 2, 0));
  expect(transformPoint(m, [0, 0, 0])).toEqual([1, 2, 0]);
});

test("rotation about an axis through a point keeps the point fixed", () => {
  const m = rotationAboutAxis([5, 5, 0], [0, 0, 1], Math.PI / 2);
  const fixed = transformPoint(m, [5, 5, 0]);
  expect(fixed[0]).toBeCloseTo(5);
  expect(fixed[1]).toBeCloseTo(5);
  const p = transformPoint(m, [6, 5, 0]); // 90° about z through (5,5)
  expect(p[0]).toBeCloseTo(5);
  expect(p[1]).toBeCloseTo(6);
});

test("scaleAboutPoint grows away from its anchor", () => {
  const m = scaleAboutPoint(2, [10, 10, 0]);
  expect(transformPoint(m, [11, 10, 0])[0]).toBeCloseTo(12);
});

test("perspective shrinks with distance", () => {
  const proj = perspective(Math.PI / 3, 1, 10, 1000);
  const near = transformPoint(proj, [10, 0, -100]);
  const far = transformPoint(proj, [10, 0, -200]);
  expect(Math.abs(near[0])).toBeGreaterThan(Math.abs(far[0]));
});
```

- [ ] **Step 6.2:** Run — FAIL. **Step 6.3: Implement `web/src/cardgl/mat4.ts`** (column-major Float32Array; `transformPoint` does the perspective divide; standard formulas):

```ts
export type Mat4 = Float32Array;

export function identity(): Mat4 {
  const m = new Float32Array(16);
  m[0] = m[5] = m[10] = m[15] = 1;
  return m;
}

export function multiply(a: Mat4, b: Mat4): Mat4 {
  const out = new Float32Array(16);
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 4; r++) {
      let s = 0;
      for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k];
      out[c * 4 + r] = s;
    }
  }
  return out;
}

export function translation(x: number, y: number, z: number): Mat4 {
  const m = identity();
  m[12] = x; m[13] = y; m[14] = z;
  return m;
}

export function perspective(fovY: number, aspect: number, near: number, far: number): Mat4 {
  const f = 1 / Math.tan(fovY / 2);
  const m = new Float32Array(16);
  m[0] = f / aspect;
  m[5] = f;
  m[10] = (far + near) / (near - far);
  m[11] = -1;
  m[14] = (2 * far * near) / (near - far);
  return m;
}

/** Rodrigues rotation about a unit axis through a point. */
export function rotationAboutAxis(p: [number, number, number], axis: [number, number, number], rad: number): Mat4 {
  const [x, y, z] = axis;
  const c = Math.cos(rad), s = Math.sin(rad), t = 1 - c;
  const r = identity();
  r[0] = t * x * x + c;     r[4] = t * x * y - s * z; r[8] = t * x * z + s * y;
  r[1] = t * x * y + s * z; r[5] = t * y * y + c;     r[9] = t * y * z - s * x;
  r[2] = t * x * z - s * y; r[6] = t * y * z + s * x; r[10] = t * z * z + c;
  return multiply(translation(p[0], p[1], p[2]), multiply(r, translation(-p[0], -p[1], -p[2])));
}

export function scaleAboutPoint(s: number, p: [number, number, number]): Mat4 {
  const m = identity();
  m[0] = m[5] = m[10] = s;
  return multiply(translation(p[0], p[1], p[2]), multiply(m, translation(-p[0], -p[1], -p[2])));
}

export function transformPoint(m: Mat4, v: [number, number, number]): [number, number, number] {
  const w = m[3] * v[0] + m[7] * v[1] + m[11] * v[2] + m[15] || 1;
  return [
    (m[0] * v[0] + m[4] * v[1] + m[8] * v[2] + m[12]) / w,
    (m[1] * v[0] + m[5] * v[1] + m[9] * v[2] + m[13]) / w,
    (m[2] * v[0] + m[6] * v[1] + m[10] * v[2] + m[14]) / w,
  ];
}
```

- [ ] **Step 6.4:** Run mat4 tests — PASS. Commit `feat(web): minimal mat4 for the card GL engine`.

- [ ] **Step 6.5: Create `web/src/cardgl/shaders.ts`** — the GLSL port of `deform` (MUST mirror curlMath; any change happens in both):

```ts
export const VERT = `#version 300 es
precision highp float;
in vec2 aPos;
uniform vec2 uCard;
uniform vec2 uGrab, uDir, uPerp;
uniform float uApex, uHalf, uRadius, uTheta;
uniform mat4 uModel, uPV;
uniform float uShadowPass;
out vec2 vUV;
out vec3 vNormal;
out float vShadowAlpha;

const float PI = 3.14159265359;
const float R_MIN = 0.75;

vec3 deform(vec2 p) {
  vec2 d = p - uGrab;
  float du = dot(d, uPerp);
  float dv = dot(d, uDir);
  float t = du / uHalf;
  float fall = max(1.0 - t * t, 0.0);
  if (fall <= 0.0 || uApex < 1e-3) return vec3(p, 0.0);
  float a = uApex * fall;
  float r = max(uRadius * fall, R_MIN);
  float vt = a + 0.5 * PI * r * fall;
  float s = vt - dv;
  float v2; float z;
  if (s <= 0.0) { v2 = dv; z = 0.0; }
  else if (s < PI * r) {
    float phi = s / r;
    v2 = vt - r * sin(phi);
    z = r * (1.0 - cos(phi));
  } else {
    float e = s - PI * r;
    v2 = vt + e * cos(uTheta);
    z = 2.0 * r + e * sin(uTheta);
  }
  return vec3(uGrab + du * uPerp + v2 * uDir, z);
}

void main() {
  vec3 P = deform(aPos);
  // finite-difference normal: exact in every region, no case analysis
  vec3 Px = deform(aPos + vec2(1.5, 0.0));
  vec3 Py = deform(aPos + vec2(0.0, 1.5));
  vec3 N = normalize(cross(Px - P, Py - P));
  vec4 world = uModel * vec4(P, 1.0);
  vNormal = mat3(uModel) * N;
  vUV = aPos / uCard;
  if (uShadowPass > 0.5) {
    // flatten onto the felt, offset along the light, fade with height
    vec2 sxy = world.xy + vec2(2.0, 3.0) + world.z * vec2(0.18, 0.45);
    vShadowAlpha = mix(0.38, 0.10, clamp(world.z / 50.0, 0.0, 1.0));
    gl_Position = uPV * vec4(sxy, 0.0, 1.0);
  } else {
    vShadowAlpha = 0.0;
    gl_Position = uPV * world;
  }
}`;

export const FRAG = `#version 300 es
precision highp float;
in vec2 vUV;
in vec3 vNormal;
in float vShadowAlpha;
uniform sampler2D uTop, uBot;
uniform float uShadowPass;
uniform vec3 uLight;
out vec4 frag;

void main() {
  if (uShadowPass > 0.5) {
    float a = texture(uTop, vUV).a;
    if (a < 0.01) discard;
    frag = vec4(0.0, 0.0, 0.0, a * vShadowAlpha);
    return;
  }
  vec4 tex = gl_FrontFacing
    ? texture(uTop, vUV)
    : texture(uBot, vec2(1.0 - vUV.x, vUV.y)); // the underside, seen mirrored
  if (tex.a < 0.01) discard;
  vec3 n = normalize(gl_FrontFacing ? vNormal : -vNormal);
  float diff = max(dot(n, uLight), 0.0);
  // normalized so a flat card is exactly 1.0 — seamless DOM handoff
  float light = clamp(0.62 + 0.38 * (diff / 0.69), 0.0, 1.12);
  vec3 h = normalize(uLight + vec3(0.0, 0.0, 1.0));
  float spec = pow(max(dot(n, h), 0.0), 28.0) * 0.16;
  frag = vec4(tex.rgb * light + vec3(spec), tex.a);
}`;
```

- [ ] **Step 6.6: Create `web/src/cardgl/engine.ts`:**

```ts
import { VERT, FRAG } from "./shaders";
import { identity, multiply, perspective, translation, rotationAboutAxis, scaleAboutPoint, type Mat4 } from "./mat4";
import type { CurlParams, BodyPose } from "./curlMath";

const COLS = 48;
const ROWS = 64;
const FOCAL = 640; // px — matches the CSS perspective(640px)

export class CardGLEngine {
  private gl: WebGL2RenderingContext;
  private program: WebGLProgram;
  private indexCount: number;
  private uni: Record<string, WebGLUniformLocation | null> = {};
  private texTop: WebGLTexture;
  private texBot: WebGLTexture;
  private pv: Mat4;
  private cardW: number;
  private cardH: number;
  private pad: number;
  onContextLost?: () => void;

  static isSupported(): boolean {
    try {
      return !!document.createElement("canvas").getContext("webgl2");
    } catch {
      return false;
    }
  }

  constructor(canvas: HTMLCanvasElement, cardW: number, cardH: number, pad: number, dpr: number) {
    this.cardW = cardW;
    this.cardH = cardH;
    this.pad = pad;
    canvas.width = Math.round((cardW + 2 * pad) * dpr);
    canvas.height = Math.round((cardH + 2 * pad) * dpr);
    const gl = canvas.getContext("webgl2", { alpha: true, antialias: true, premultipliedAlpha: false });
    if (!gl) throw new Error("webgl2 unavailable");
    this.gl = gl;
    canvas.addEventListener("webglcontextlost", (e) => {
      e.preventDefault();
      this.onContextLost?.();
    });

    this.program = this.link(VERT, FRAG);
    gl.useProgram(this.program);
    for (const name of ["uCard", "uGrab", "uDir", "uPerp", "uApex", "uHalf", "uRadius", "uTheta", "uModel", "uPV", "uShadowPass", "uTop", "uBot", "uLight"]) {
      this.uni[name] = gl.getUniformLocation(this.program, name);
    }

    // grid mesh over the card rectangle, positions in card-local px
    const verts = new Float32Array((COLS + 1) * (ROWS + 1) * 2);
    let vi = 0;
    for (let r = 0; r <= ROWS; r++) {
      for (let c = 0; c <= COLS; c++) {
        verts[vi++] = (c / COLS) * cardW;
        verts[vi++] = (r / ROWS) * cardH;
      }
    }
    const idx = new Uint16Array(COLS * ROWS * 6);
    let ii = 0;
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const a = r * (COLS + 1) + c;
        const b = a + 1;
        const d = a + (COLS + 1);
        const e = d + 1;
        idx[ii++] = a; idx[ii++] = b; idx[ii++] = d;
        idx[ii++] = b; idx[ii++] = e; idx[ii++] = d;
      }
    }
    this.indexCount = idx.length;

    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    const vbo = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.bufferData(gl.ARRAY_BUFFER, verts, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    const ibo = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, idx, gl.STATIC_DRAW);

    this.texTop = this.makeTexture();
    this.texBot = this.makeTexture();

    // camera over the card center, focal length = the CSS perspective.
    // World y grows DOWN (card-local px) → flip y into NDC via the view.
    const w = cardW + 2 * pad;
    const h = cardH + 2 * pad;
    const fovY = 2 * Math.atan(h / 2 / FOCAL);
    const proj = perspective(fovY, w / h, 100, 2000);
    const flipY = identity();
    flipY[5] = -1;
    const view = translation(-(pad + cardW / 2), -(pad + cardH / 2), -FOCAL);
    this.pv = multiply(proj, multiply(flipY, view));
    // overlay world origin == card origin; shift card into the padded canvas
    this.pv = multiply(this.pv, translation(pad, pad, 0));
    // NOTE the double pad shift above: view centers on (pad + w/2) while
    // geometry is in card coords — the final translation(pad,pad,0) maps
    // card (0,0) to canvas (pad,pad). Verified by the flat-frame check.

    gl.enable(gl.BLEND);
    gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.uniform3f(this.uni.uLight, -0.35, -0.5, 0.79); // upper-left key light
    gl.uniform2f(this.uni.uCard, cardW, cardH);
    gl.uniform1i(this.uni.uTop, 0);
    gl.uniform1i(this.uni.uBot, 1);
    gl.uniformMatrix4fv(this.uni.uPV, false, this.pv);
  }

  private link(vs: string, fs: string): WebGLProgram {
    const gl = this.gl;
    const compile = (type: number, src: string) => {
      const s = gl.createShader(type)!;
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
        throw new Error(gl.getShaderInfoLog(s) ?? "shader compile failed");
      }
      return s;
    };
    const p = gl.createProgram()!;
    gl.attachShader(p, compile(gl.VERTEX_SHADER, vs));
    gl.attachShader(p, compile(gl.FRAGMENT_SHADER, fs));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
      throw new Error(gl.getProgramInfoLog(p) ?? "program link failed");
    }
    return p;
  }

  private makeTexture(): WebGLTexture {
    const gl = this.gl;
    const t = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    return t;
  }

  private upload(tex: WebGLTexture, src: TexImageSource) {
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src);
    gl.generateMipmap(gl.TEXTURE_2D);
  }

  setTopTexture(src: TexImageSource) { this.upload(this.texTop, src); }
  setBotTexture(src: TexImageSource) { this.upload(this.texBot, src); }

  private modelMatrix(pose: BodyPose): Mat4 {
    const cx = this.cardW / 2;
    const cy = this.cardH / 2;
    let m = scaleAboutPoint(pose.scale, [cx, cy, 0]);
    if (pose.flipRad !== 0) {
      m = multiply(m, rotationAboutAxis([cx, cy, 0], [pose.flipAxis[0], pose.flipAxis[1], 0], pose.flipRad));
    }
    if (pose.tipRad !== 0) {
      m = multiply(m, rotationAboutAxis([pose.tipPivot[0], pose.tipPivot[1], 0], [pose.tipAxis[0], pose.tipAxis[1], 0], pose.tipRad));
    }
    if (pose.lift !== 0) m = multiply(translation(0, 0, pose.lift), m);
    return m;
  }

  render(curl: CurlParams, pose: BodyPose) {
    const gl = this.gl;
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.useProgram(this.program);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.texTop);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.texBot);

    gl.uniform2f(this.uni.uGrab, curl.gx, curl.gy);
    gl.uniform2f(this.uni.uDir, curl.nx, curl.ny);
    gl.uniform2f(this.uni.uPerp, curl.ux, curl.uy);
    gl.uniform1f(this.uni.uApex, curl.apex);
    gl.uniform1f(this.uni.uHalf, curl.half);
    gl.uniform1f(this.uni.uRadius, curl.radius);
    gl.uniform1f(this.uni.uTheta, curl.theta);
    gl.uniformMatrix4fv(this.uni.uModel, false, this.modelMatrix(pose));

    // pass 1: shadow flattened onto the felt — no depth write
    gl.disable(gl.DEPTH_TEST);
    gl.uniform1f(this.uni.uShadowPass, 1);
    gl.drawElements(gl.TRIANGLES, this.indexCount, gl.UNSIGNED_SHORT, 0);

    // pass 2: the card
    gl.enable(gl.DEPTH_TEST);
    gl.uniform1f(this.uni.uShadowPass, 0);
    gl.drawElements(gl.TRIANGLES, this.indexCount, gl.UNSIGNED_SHORT, 0);
  }

  dispose() {
    this.gl.getExtension("WEBGL_lose_context")?.loseContext();
  }
}
```

- [ ] **Step 6.7:** Add a jsdom guard test (append to `mat4.test.ts` or a new `engine.test.ts`):

```ts
import { CardGLEngine } from "./engine";
test("WebGL2 is not available in jsdom — the GL path stays off in tests", () => {
  expect(CardGLEngine.isSupported()).toBe(false);
});
```

- [ ] **Step 6.8:** `npx vitest run` + `npx tsc --noEmit` — green. Commit `feat(web): CardGL engine — mesh, curl shaders, lighting, projected shadow`.

### Task 7: `CardGLOverlay.tsx` + `SqueezeCard` wiring

- [ ] **Step 7.1: Write failing tests** `web/src/cardgl/overlay.test.tsx` (drive rAF manually; inject a fake engine):

```tsx
import { render, act } from "@testing-library/react";
import { CardGLOverlay, type GesturePort, type OverlayEngine } from "./CardGLOverlay";
import { useRef } from "react";

let rafQueue: FrameRequestCallback[] = [];
beforeEach(() => {
  rafQueue = [];
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
    rafQueue.push(cb);
    return rafQueue.length;
  });
  vi.stubGlobal("cancelAnimationFrame", () => {});
});
afterEach(() => vi.unstubAllGlobals());

function pump(now: number) {
  const q = rafQueue;
  rafQueue = [];
  act(() => q.forEach((cb) => cb(now)));
}

function makeFakeEngine() {
  return {
    renders: [] as Array<{ apex: number }>,
    render(curl: { apex: number }) { this.renders.push({ apex: curl.apex }); },
    setTopTexture() {},
    setBotTexture() {},
    dispose() {},
  };
}

function Harness({ port, engine, onDone }: { port: GesturePort; engine: OverlayEngine; onDone: () => void }) {
  const ref = useRef<GesturePort>(port);
  return (
    <CardGLOverlay
      card="FaceDown"
      cardW={90}
      cardH={126}
      port={ref}
      onDone={onDone}
      engineFactory={() => engine}
    />
  );
}

test("a live drag renders curls that track the pointer", () => {
  const engine = makeFakeEngine();
  const port: GesturePort = { drag: { gx: 45, gy: 124, fx: 45, fy: 60 }, release: null };
  render(<Harness port={port} engine={engine} onDone={() => {}} />);
  pump(0); pump(16); pump(32);
  expect(engine.renders.length).toBeGreaterThan(0);
  expect(engine.renders.at(-1)!.apex).toBeGreaterThan(0);
});

test("a settle release flutters flat and reports done", () => {
  const engine = makeFakeEngine();
  const port: GesturePort = { drag: null, release: { kind: "settle", gx: 45, gy: 124, fx: 45, fy: 60 } };
  const done = vi.fn();
  render(<Harness port={port} engine={engine} onDone={done} />);
  pump(0);
  for (let t = 16; t < 1200 && !done.mock.calls.length; t += 16) pump(t);
  expect(done).toHaveBeenCalled();
  expect(engine.renders.at(-1)!.apex).toBeLessThan(1);
});

test("a flip release runs the full turn then reports done", () => {
  const engine = makeFakeEngine();
  const port: GesturePort = { drag: null, release: { kind: "flip", gx: 45, gy: 124, fx: 45, fy: 60 } };
  const done = vi.fn();
  render(<Harness port={port} engine={engine} onDone={done} />);
  pump(0);
  for (let t = 16; t < 1200 && !done.mock.calls.length; t += 16) pump(t);
  expect(done).toHaveBeenCalled();
});
```

- [ ] **Step 7.2:** Run — FAIL. **Step 7.3: Implement `web/src/cardgl/CardGLOverlay.tsx`:**

```tsx
import { useEffect, useRef } from "react";
import type { MutableRefObject } from "react";
import type { CardView } from "../engine/types";
import { gripFrom } from "../squeeze";
import { curlFromGrip, poseFrom, flipFrame, FLIP_MS, type CurlParams, type BodyPose } from "./curlMath";
import { springStep, flutterScale, type SpringState } from "./springs";
import { buildFaceOps, buildBackOps, buildStockOps, paintTexture } from "./facePainter";
import { CardGLEngine } from "./engine";

/** SqueezeCard → overlay, by mutation: no React state on the hot path.
 *  Coordinates are card-local px. */
export interface GesturePort {
  drag: { gx: number; gy: number; fx: number; fy: number } | null;
  release: { kind: "settle" | "flip"; gx: number; gy: number; fx: number; fy: number } | null;
}

/** The slice of CardGLEngine the overlay drives — lets tests inject a fake. */
export interface OverlayEngine {
  render(curl: CurlParams, pose: BodyPose): void;
  setTopTexture(src: TexImageSource): void;
  setBotTexture(src: TexImageSource): void;
  dispose(): void;
  onContextLost?: () => void;
}

const SPRING_OMEGA = 28; // 1/s — tight but weighty finger tracking
const TEX_SCALE = Math.min((typeof devicePixelRatio !== "undefined" ? devicePixelRatio : 1) * 2, 3);

function isPeeked(card: CardView): boolean {
  return card !== "FaceDown" && typeof card === "object" && "Peeked" in card;
}

interface Props {
  card: CardView;
  cardW: number;
  cardH: number;
  port: MutableRefObject<GesturePort>;
  onDone: () => void;
  /** test seam; production uses the real engine */
  engineFactory?: (canvas: HTMLCanvasElement, w: number, h: number, pad: number, dpr: number) => OverlayEngine;
}

export function CardGLOverlay({ card, cardW, cardH, port, onDone, engineFactory }: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const engineRef = useRef<OverlayEngine | null>(null);
  const cardRef = useRef(card);
  cardRef.current = card;
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;
  const pad = Math.round(0.6 * cardW);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = Math.min(typeof devicePixelRatio !== "undefined" ? devicePixelRatio : 1, 2);
    let engine: OverlayEngine;
    try {
      engine = (engineFactory ?? ((c, w, h, p, d) => new CardGLEngine(c, w, h, p, d)))(canvas, cardW, cardH, pad, dpr);
    } catch {
      onDoneRef.current();
      return;
    }
    engineRef.current = engine;
    engine.onContextLost = () => onDoneRef.current();

    // textures: top = the card back; underside = blank stock until peeked,
    // then the printed face (indices covered; thumbs ride edge grips)
    const back = paintTexture(buildBackOps(), cardW, cardH, TEX_SCALE);
    if (back) engine.setTopTexture(back);
    const stock = paintTexture(buildStockOps(), cardW, cardH, TEX_SCALE);
    if (stock) engine.setBotTexture(stock);

    let botKind = "stock";
    const wantBot = (): { kind: string; paint: () => HTMLCanvasElement | null } => {
      const c = cardRef.current;
      if (c !== "FaceDown" && typeof c === "object" && "FaceUp" in c) {
        const { rank, suit } = c.FaceUp;
        return { kind: `up-${rank}-${suit}`, paint: () => paintTexture(buildFaceOps(rank, suit), cardW, cardH, TEX_SCALE) };
      }
      if (isPeeked(cardRef.current)) {
        const { rank, suit } = (cardRef.current as { Peeked: { sliver: { rank: never; suit: never } } }).Peeked.sliver;
        return { kind: `peek-${rank}-${suit}`, paint: () => paintTexture(buildFaceOps(rank, suit, { coverIndices: true, thumbs: true }), cardW, cardH, TEX_SCALE) };
      }
      return { kind: "stock", paint: () => stock };
    };

    const f: SpringState[] = [{ x: 0, v: 0 }, { x: 0, v: 0 }];
    let sprung = false;
    let mode: "drag" | "settle" | "flip" = "drag";
    let t0 = 0;
    let releaseGrab: { gx: number; gy: number; fx: number; fy: number } | null = null;
    let last = 0;
    let raf = 0;

    const frame = (now: number) => {
      const dt = Math.min(now - (last || now), 50);
      last = now;
      const p = port.current;

      const want = wantBot();
      if (want.kind !== botKind) {
        const tex = want.paint();
        if (tex) {
          engine.setBotTexture(tex);
          botKind = want.kind;
        }
      }

      if (mode === "drag" && p.release) {
        mode = p.release.kind === "flip" ? "flip" : "settle";
        t0 = now;
        releaseGrab = { gx: p.release.gx, gy: p.release.gy, fx: sprung ? f[0].x : p.release.fx, fy: sprung ? f[1].x : p.release.fy };
      }

      const rect = { left: 0, top: 0, width: cardW, height: cardH };
      if (mode === "drag") {
        if (!p.drag) {
          raf = requestAnimationFrame(frame);
          return;
        }
        if (!sprung) {
          f[0] = { x: p.drag.gx, v: 0 };
          f[1] = { x: p.drag.gy, v: 0 };
          sprung = true;
        }
        f[0] = springStep(f[0], p.drag.fx, SPRING_OMEGA, dt);
        f[1] = springStep(f[1], p.drag.fy, SPRING_OMEGA, dt);
        const grip = gripFrom(p.drag.gx, p.drag.gy, f[0].x, f[1].x, rect);
        if (grip) engine.render(curlFromGrip(grip, cardW, cardH), poseFrom(grip, cardW, cardH));
      } else if (mode === "settle" && releaseGrab) {
        const s = flutterScale(now - t0);
        const fx = releaseGrab.gx + (releaseGrab.fx - releaseGrab.gx) * s;
        const fy = releaseGrab.gy + (releaseGrab.fy - releaseGrab.gy) * s;
        const grip = gripFrom(releaseGrab.gx, releaseGrab.gy, fx, fy, rect);
        if (grip && s > 0) {
          engine.render(curlFromGrip(grip, cardW, cardH), poseFrom(grip, cardW, cardH));
        } else {
          onDoneRef.current();
          return;
        }
      } else if (mode === "flip" && releaseGrab) {
        const t = now - t0;
        const ff = flipFrame(t);
        const grip = gripFrom(releaseGrab.gx, releaseGrab.gy, releaseGrab.fx, releaseGrab.fy, rect);
        if (!grip || t >= FLIP_MS) {
          onDoneRef.current();
          return;
        }
        const curl = curlFromGrip(grip, cardW, cardH);
        curl.apex *= ff.curlScale;
        const minDim = Math.min(cardW, cardH);
        engine.render(curl, poseFrom(grip, cardW, cardH, { rotU: ff.rotU, lift: ff.lift * 0.35 * minDim, curlScale: ff.curlScale, settle: ff.settle }));
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(raf);
      engine.dispose();
      engineRef.current = null;
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
```

- [ ] **Step 7.4:** Run overlay tests — PASS. Adjust only the test seam if act() warnings appear (renders happen outside React — expected and fine).
- [ ] **Step 7.5: Wire `SqueezeCard.tsx`.** Changes (CSS path untouched, GL added beside it):

```tsx
// new imports
import { gripFrom } from "../squeeze";
import { CardGLOverlay, type GesturePort } from "../cardgl/CardGLOverlay";
import { CardGLEngine } from "../cardgl/engine";

// module level — the GL gate, evaluated once
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
/** test seam */
export function resetGlModeForTests() { glChecked = false; }
```

Inside the component:

```tsx
const [glActive, setGlActive] = useState(false);
const portRef = useRef<GesturePort>({ drag: null, release: null });
const glRect = useRef<{ width: number; height: number }>({ width: 0, height: 0 });
```

- `handlePointerDown`: after measuring `rect` — if `glMode()` and the rect is real: `glRect.current = rect; portRef.current = { drag: null, release: null }; setGlActive(true);`
- `handlePointerMove`: GL branch writes the port instead of state:

```tsx
if (glMode() && glActive && start.current) {
  const r = start.current.rect;
  portRef.current.drag = {
    gx: start.current.x - r.left, gy: start.current.y - r.top,
    fx: e.clientX - r.left, fy: e.clientY - r.top,
  };
} else {
  setFold(liveFold);
}
```

(threshold logic above stays shared — it derives from `progress`, which `foldAt` still computes.)
- `handlePointerUp`: GL branch replaces springBack/setFold:

```tsx
if (glMode() && glActive && grab.rect.width > 0) {
  const r = grab.rect;
  portRef.current.drag = null;
  portRef.current.release = {
    kind: revealedThisGesture.current ? "flip" : "settle",
    gx: grab.x - r.left, gy: grab.y - r.top,
    fx: e.clientX - r.left, fy: e.clientY - r.top,
  };
} else if (!revealedThisGesture.current && fold !== null) {
  springBack(grab, e.clientX, e.clientY);
} else {
  setFold(null);
}
```

- `advanceOneStep` (tap/keyboard reveal): when revealing in GL mode, run the same flip from a synthetic bottom-edge grip:

```tsx
if (isPeeked(card)) {
  if (glMode()) {
    const rect = cardPaddingBox(/* wrapper element via a ref */);
    if (rect.width > 0) {
      glRect.current = rect;
      portRef.current = {
        drag: null,
        release: { kind: "flip", gx: rect.width / 2, gy: rect.height - 2, fx: rect.width / 2, fy: rect.height * 0.45 },
      };
      setGlActive(true);
    }
  }
  onReveal();
}
```

(add `const wrapperRef = useRef<HTMLDivElement>(null)` on the outer div so `cardPaddingBox(wrapperRef.current!)` works from click/keyboard.)
- Render:

```tsx
return (
  <div ref={wrapperRef} role="button" /* ...unchanged handlers/props... */>
    <span style={{ opacity: glActive ? 0 : 1 }}>
      <Card card={card} fold={glMode() ? null : fold} restFlat />
    </span>
    {glActive && (
      <CardGLOverlay
        card={card}
        cardW={glRect.current.width}
        cardH={glRect.current.height}
        port={portRef}
        onDone={() => setGlActive(false)}
      />
    )}
  </div>
);
```

Note: `opacity` (not `visibility`) keeps the aria-labels in the a11y tree. In jsdom `glMode()` is false (no WebGL2) → behavior byte-identical to today → existing `SqueezeCard.test.tsx` passes untouched.

- [ ] **Step 7.6:** Add one integration test (append to `SqueezeCard.test.tsx`):

```tsx
test("without WebGL2 the squeeze stays on the CSS peel (no overlay canvas)", () => {
  const { container } = render(<SqueezeCard card="FaceDown" onPeek={() => {}} onReveal={() => {}} />);
  fireEvent.pointerDown(container.firstChild as Element, { clientX: 50, clientY: 120 });
  fireEvent.pointerMove(container.firstChild as Element, { clientX: 50, clientY: 60 });
  expect(container.querySelector("canvas")).toBeNull();
});
```

- [ ] **Step 7.7:** `npx vitest run` (full) + `npx tsc --noEmit` — green. Commit `feat(web): GL squeeze overlay — spring-tracked curl, flutter settle, 3D reveal flip`.

### Task 8: Font preload nicety

- [ ] **Step 8.1:** In `CardGLOverlay.tsx` module scope (best effort, before first texture paint):

```ts
if (typeof document !== "undefined" && "fonts" in document) {
  document.fonts.load('14px "Press Start 2P"').catch(() => {});
  document.fonts.load('17px "VT323"').catch(() => {});
}
```

- [ ] **Step 8.2:** Tests + typecheck green. Commit `feat(web): preload card fonts for the GL texture painter`.

### Task 9: Visual verification & tuning (browser)

- [ ] **Step 9.1:** `cd web && npm run dev`; drive the app to the Dealing phase (place a bet, deal).
- [ ] **Step 9.2:** Verify with screenshots (use the project's verify/run tooling) — checklist:
  - Corner pinch → curved cone-like roll, silhouette extends past the card edge, artwork distorts over the roll, specular sheen tracks the crease.
  - Straight edge pull → uniform cylinder fold; thumbs visible over the index corners on the lifted face.
  - Pips read on the underside after peek; corner indices stay covered.
  - Release short of reveal → flutter settle (one soft re-bend), DOM card returns seamlessly.
  - Deep pull release → 3D flip: lifts, turns over the crease, lands face-up in the slot, settle pop; DOM FaceUp card appears with no jump (flip-in CSS finished while hidden).
  - Tap a peeked card → same GL flip.
  - Shadow: darker/sharper near contact, lighter as the card lifts.
  - **Sign checks:** body tip rotates the grabbed side UP (flip `tipRad` sign if down); flat card shows the BACK texture (flip `gl.frontFace(gl.CW)` in engine if face/back are swapped).
  - DevTools performance: no React commits during drag; 60fps.
  - Console clean (no GL warnings per frame).
- [ ] **Step 9.3:** Tune constants only (radius curve, SPRING_OMEGA, light vector, spec strength, shadow alphas) — each change in both TS and GLSL where mirrored. Commit `fix(web): GL squeeze feel tuning from visual pass`.

### Task 10: Gates & merge

- [ ] **Step 10.1:** `cd web && npx vitest run && npx tsc --noEmit && npm run build` — all green.
- [ ] **Step 10.2:** Update `docs/` roadmap note if applicable; merge: `git checkout main && git merge feat/cardgl-squeeze` (ff or merge commit per history style), push. CI runs cargo + vitest gates and deploys Pages.
- [ ] **Step 10.3:** Verify the live site after CI.

---

## Self-Review Notes

- **Spec coverage:** curvature rendering (Task 4/6), lighting+shadow (Task 6), springs/flutter (Task 3/7), real flip (Task 4/7), texture parity (Task 5), React decoupling (Task 7 port+rAF), fallbacks (Task 7 gate + CSS path untouched), zero deps (raw WebGL2).
- **Risk register:** (1) GLSL/TS drift — mitigated by lockstep comment + invariant tests on the TS reference; (2) winding/rotation signs — explicit visual sign-check step; (3) `act()` warnings in overlay tests — renders bypass React state, assert on the fake engine only; (4) handoff flash at flip end — flip duration 560ms > flip-in 460ms so the hidden DOM animation has finished.
- **Type consistency check:** `Grip` (squeeze.ts) → `curlFromGrip(grip, w, h)`; `CurlParams`/`BodyPose` (curlMath) → `engine.render(curl, pose)`; `GesturePort`/`OverlayEngine` (CardGLOverlay) — names match across tasks.
