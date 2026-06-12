import { render, act } from "@testing-library/react";
import { vi } from "vitest";
import { CardGLOverlay, type GesturePort, type OverlayEngine } from "./CardGLOverlay";
import type { CurlParams } from "./curlMath";
import { createRef } from "react";

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

/** Fire every queued frame callback at the given timestamp. */
function pump(now: number) {
  const q = rafQueue;
  rafQueue = [];
  act(() => q.forEach((cb) => cb(now)));
}

function makeFakeEngine() {
  return {
    renders: [] as CurlParams[],
    render(curl: CurlParams) {
      this.renders.push(curl);
    },
    setTopTexture() {},
    setBotTexture() {},
    dispose() {},
    onContextLost: undefined as (() => void) | undefined,
  };
}

function mount(port: GesturePort, engine: OverlayEngine, onDone: () => void) {
  const ref = createRef<GesturePort>() as React.MutableRefObject<GesturePort>;
  ref.current = port;
  return render(
    <CardGLOverlay card="FaceDown" cardW={90} cardH={126} port={ref} onDone={onDone} engineFactory={() => engine} />,
  );
}

test("a live drag renders curls that track the pointer", () => {
  const engine = makeFakeEngine();
  const port: GesturePort = { drag: { gx: 45, gy: 124, fx: 45, fy: 60 }, release: null };
  mount(port, engine, () => {});
  pump(0);
  pump(16);
  pump(32);
  expect(engine.renders.length).toBeGreaterThan(0);
  expect(engine.renders.at(-1)!.apex).toBeGreaterThan(0);
});

test("a settle release flutters flat and reports done", () => {
  const engine = makeFakeEngine();
  const port: GesturePort = { drag: null, release: { kind: "settle", gx: 45, gy: 124, fx: 45, fy: 60 } };
  const done = vi.fn();
  mount(port, engine, done);
  pump(0);
  for (let t = 16; t < 1500 && done.mock.calls.length === 0; t += 16) pump(t);
  expect(done).toHaveBeenCalled();
});

test("a flip release runs the full turn then reports done", () => {
  const engine = makeFakeEngine();
  const port: GesturePort = { drag: null, release: { kind: "flip", gx: 45, gy: 124, fx: 45, fy: 60 } };
  const done = vi.fn();
  mount(port, engine, done);
  pump(0);
  for (let t = 16; t < 1500 && done.mock.calls.length === 0; t += 16) pump(t);
  expect(done).toHaveBeenCalled();
  expect(engine.renders.length).toBeGreaterThan(5); // the turn actually animated
});
