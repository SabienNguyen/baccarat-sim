import { render, act } from "@testing-library/react";
import { vi } from "vitest";
import { CardGLOverlay, createFrameLoop, type GesturePort, type OverlayEngine } from "./CardGLOverlay";
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

function mount(port: GesturePort, engine: OverlayEngine, onDone: () => void, onReady?: () => void) {
  const ref = createRef<GesturePort>() as React.MutableRefObject<GesturePort>;
  ref.current = port;
  return render(
    <CardGLOverlay
      card="FaceDown"
      cardW={90}
      cardH={126}
      port={ref}
      onDone={onDone}
      onReady={onReady}
      engineFactory={() => engine}
    />,
  );
}

test("the overlay paints a flat frame, THEN signals ready — never the reverse", () => {
  const engine = makeFakeEngine();
  let rendersAtReady = -1;
  const onReady = () => {
    rendersAtReady = engine.renders.length;
  };
  mount({ drag: null, release: null }, engine, () => {}, onReady);
  // ready must fire with at least one frame already painted, before any rAF
  expect(rendersAtReady).toBeGreaterThanOrEqual(1);
  expect(engine.renders[0].apex).toBe(0); // and that frame is the flat card
});

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

test("the overlay stops scheduling frames once a settle finishes", () => {
  const engine = makeFakeEngine();
  const port: GesturePort = { drag: null, release: { kind: "settle", gx: 45, gy: 124, fx: 45, fy: 60 } };
  const done = vi.fn();
  mount(port, engine, done);
  pump(0);
  for (let t = 16; t < 1500 && done.mock.calls.length === 0; t += 16) pump(t);
  expect(done).toHaveBeenCalledTimes(1);
  // the tick that reported done must not have re-armed the loop
  expect(rafQueue.length).toBe(0);
});

test("unmounting mid-drag cancels the pending frame", () => {
  const engine = makeFakeEngine();
  const port: GesturePort = { drag: { gx: 45, gy: 124, fx: 45, fy: 60 }, release: null };
  const cancel = vi.fn();
  vi.stubGlobal("cancelAnimationFrame", cancel);
  const { unmount } = mount(port, engine, () => {});
  pump(0);
  expect(rafQueue.length).toBe(1); // drag mode re-armed itself for the next frame
  unmount();
  expect(cancel).toHaveBeenCalled();
});

describe("createFrameLoop", () => {
  let queue: FrameRequestCallback[] = [];
  beforeEach(() => {
    queue = [];
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
      queue.push(cb);
      return queue.length;
    });
    vi.stubGlobal("cancelAnimationFrame", () => {});
  });
  afterEach(() => vi.unstubAllGlobals());

  function fire(now: number) {
    const q = queue;
    queue = [];
    q.forEach((cb) => cb(now));
  }

  test("start schedules repeated ticks until stop", () => {
    const seen: number[] = [];
    const loop = createFrameLoop((now) => {
      seen.push(now);
    });
    loop.start();
    expect(loop.isRunning()).toBe(true);
    fire(0);
    fire(16);
    expect(seen).toEqual([0, 16]);
    loop.stop();
    expect(loop.isRunning()).toBe(false);
    fire(32); // nothing left queued once stopped
    expect(seen).toEqual([0, 16]);
  });

  test("a tick returning false stops the loop itself, without an external stop()", () => {
    let calls = 0;
    const loop = createFrameLoop(() => {
      calls += 1;
      return calls < 2 ? undefined : false;
    });
    loop.start();
    fire(0);
    fire(16);
    expect(calls).toBe(2);
    expect(loop.isRunning()).toBe(false);
    expect(queue.length).toBe(0);
  });

  test("start is idempotent while already running", () => {
    let ticks = 0;
    const loop = createFrameLoop(() => {
      ticks += 1;
    });
    loop.start();
    loop.start();
    expect(queue.length).toBe(1);
    fire(0);
    expect(ticks).toBe(1);
  });
});
