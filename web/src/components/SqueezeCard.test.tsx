import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SqueezeCard } from "./SqueezeCard";
import type { CardView } from "../engine/types";

const faceDown: CardView = "FaceDown";
const peeked: CardView = { Peeked: { sliver: { suit: "Spades", rank: "Nine" } } };
const faceUp: CardView = { FaceUp: { rank: "Nine", suit: "Hearts" } };

test("click fallback: a face-down card peeks", async () => {
  const onPeek = vi.fn();
  const onReveal = vi.fn();
  render(<SqueezeCard card={faceDown} onPeek={onPeek} onReveal={onReveal} />);
  await userEvent.click(screen.getByLabelText("face-down card"));
  expect(onPeek).toHaveBeenCalledOnce();
  expect(onReveal).not.toHaveBeenCalled();
});

test("click fallback: a peeked card reveals", async () => {
  const onPeek = vi.fn();
  const onReveal = vi.fn();
  render(<SqueezeCard card={peeked} onPeek={onPeek} onReveal={onReveal} />);
  await userEvent.click(screen.getByLabelText("peeked card, Spades"));
  expect(onReveal).toHaveBeenCalledOnce();
});

test("drag: dragging only peeks; the flip commits on release", () => {
  const onPeek = vi.fn();
  const onReveal = vi.fn();
  render(<SqueezeCard card={faceDown} onPeek={onPeek} onReveal={onReveal} />);
  const el = screen.getByRole("button");
  fireEvent.pointerDown(el, { pointerId: 1, clientY: 300 });
  fireEvent.pointerMove(el, { pointerId: 1, clientY: 264 }); // progress 0.30 -> peek
  expect(onPeek).toHaveBeenCalledOnce();
  expect(onReveal).not.toHaveBeenCalled();
  fireEvent.pointerMove(el, { pointerId: 1, clientY: 204 }); // 0.80 -> still only peek, no mid-drag flip
  expect(onReveal).not.toHaveBeenCalled();
  fireEvent.pointerUp(el, { pointerId: 1, clientY: 204 }); // release while held up -> reveal
  expect(onReveal).toHaveBeenCalledOnce();
});

test("drag: peeling works in any direction (downward drag also peeks)", () => {
  const onPeek = vi.fn();
  const onReveal = vi.fn();
  render(<SqueezeCard card={faceDown} onPeek={onPeek} onReveal={onReveal} />);
  const el = screen.getByRole("button");
  fireEvent.pointerDown(el, { pointerId: 1, clientY: 300 });
  fireEvent.pointerMove(el, { pointerId: 1, clientY: 336 }); // 36px DOWN -> progress 0.30
  expect(onPeek).toHaveBeenCalledOnce();
  expect(onReveal).not.toHaveBeenCalled();
});

test("drag: a sideways drag peeks too (distance-based progress)", () => {
  const onPeek = vi.fn();
  const onReveal = vi.fn();
  render(<SqueezeCard card={faceDown} onPeek={onPeek} onReveal={onReveal} />);
  const el = screen.getByRole("button");
  fireEvent.pointerDown(el, { pointerId: 1, clientX: 100, clientY: 300 });
  fireEvent.pointerMove(el, { pointerId: 1, clientX: 136, clientY: 300 }); // 36px RIGHT
  expect(onPeek).toHaveBeenCalledOnce();
});

test("drag: a fast jump past the reveal threshold still peeks first, and waits for release to flip", () => {
  const onPeek = vi.fn();
  const onReveal = vi.fn();
  render(<SqueezeCard card={faceDown} onPeek={onPeek} onReveal={onReveal} />);
  const el = screen.getByRole("button");
  fireEvent.pointerDown(el, { pointerId: 1, clientY: 300 });
  fireEvent.pointerMove(el, { pointerId: 1, clientY: 180 }); // single jump straight to progress 1.0
  expect(onPeek).toHaveBeenCalledOnce(); // peek must not be skipped by the jump
  expect(onReveal).not.toHaveBeenCalled(); // flip waits for release
});

test("drag: releasing a deep pull commits the reveal", () => {
  const onPeek = vi.fn();
  const onReveal = vi.fn();
  render(<SqueezeCard card={faceDown} onPeek={onPeek} onReveal={onReveal} />);
  const el = screen.getByRole("button");
  fireEvent.pointerDown(el, { pointerId: 1, clientY: 300 });
  fireEvent.pointerMove(el, { pointerId: 1, clientY: 210 }); // 0.75 -> deep
  fireEvent.pointerUp(el, { pointerId: 1, clientY: 210 }); // release deep -> reveal
  expect(onPeek).toHaveBeenCalledOnce();
  expect(onReveal).toHaveBeenCalledOnce();
});

test("drag past peek then retreat and release does NOT reveal (incl. trailing click)", () => {
  const onPeek = vi.fn();
  const onReveal = vi.fn();
  const { rerender } = render(
    <SqueezeCard card={faceDown} onPeek={onPeek} onReveal={onReveal} />,
  );
  const el = screen.getByRole("button");
  fireEvent.pointerDown(el, { pointerId: 1, clientY: 300 });
  fireEvent.pointerMove(el, { pointerId: 1, clientY: 264 }); // 0.30 -> peek fires
  expect(onPeek).toHaveBeenCalledOnce();
  // the parent re-renders the card as Peeked once peek lands
  rerender(<SqueezeCard card={peeked} onPeek={onPeek} onReveal={onReveal} />);
  fireEvent.pointerMove(el, { pointerId: 1, clientY: 312 }); // retreat below peek
  fireEvent.pointerUp(el, { pointerId: 1, clientY: 312 }); // release: no commit
  fireEvent.click(el); // browser's trailing synthetic click must be swallowed
  expect(onReveal).not.toHaveBeenCalled();
});

test("a face-up card ignores interaction", async () => {
  const onPeek = vi.fn();
  const onReveal = vi.fn();
  render(<SqueezeCard card={faceUp} onPeek={onPeek} onReveal={onReveal} />);
  await userEvent.click(screen.getByLabelText("Nine of Hearts"));
  expect(onPeek).not.toHaveBeenCalled();
  expect(onReveal).not.toHaveBeenCalled();
});

test("the fold measures the card itself, not its wrapper", () => {
  render(<SqueezeCard card={faceDown} onPeek={vi.fn()} onReveal={vi.fn()} />);
  const wrapper = screen.getByRole("button");
  const card = wrapper.querySelector(".card")!;
  const box = (left: number, top: number, width: number, height: number) =>
    ({ left, top, width, height, right: left + width, bottom: top + height, x: left, y: top, toJSON: () => "" }) as DOMRect;
  // the wrapper is bigger than the card (margins, baseline slack): clip
  // percentages must come from the card's own box or the fold drifts off
  // the finger
  vi.spyOn(wrapper, "getBoundingClientRect").mockReturnValue(box(0, 0, 108, 154));
  vi.spyOn(card as HTMLElement, "getBoundingClientRect").mockReturnValue(box(7, 7, 94, 140));
  fireEvent.pointerDown(wrapper, { pointerId: 1, clientX: 54, clientY: 140 });
  fireEvent.pointerMove(wrapper, { pointerId: 1, clientX: 54, clientY: 80 });
  const under = wrapper.querySelector<HTMLElement>(".card-peel-under");
  expect(under).not.toBeNull();
  // grab (47,133) in card space pulled to (47,73): crease at y=103 of 140
  expect(under!.style.clipPath).toContain("73.6%");
});

test("drag: a mid-pull release keeps the card unflipped — peeking is free", () => {
  const onPeek = vi.fn();
  const onReveal = vi.fn();
  render(<SqueezeCard card={faceDown} onPeek={onPeek} onReveal={onReveal} />);
  const el = screen.getByRole("button");
  fireEvent.pointerDown(el, { pointerId: 1, clientY: 300 });
  fireEvent.pointerMove(el, { pointerId: 1, clientY: 250 }); // 0.42: peeked, not committed
  expect(onPeek).toHaveBeenCalledOnce();
  fireEvent.pointerUp(el, { pointerId: 1, clientY: 250 }); // let go: not ready to know
  fireEvent.click(el); // swallow the trailing synthetic click
  expect(onReveal).not.toHaveBeenCalled();
});

test("a released peek lies flat again — back to the original unflipped state", () => {
  render(<SqueezeCard card={peeked} onPeek={vi.fn()} onReveal={vi.fn()} />);
  // at rest (no live fold), your own peeked card shows no bend at all
  expect(document.querySelector(".card-peel-under")).toBeNull();
  expect(document.querySelector(".card-peel-flap")).toBeNull();
  expect(screen.getByLabelText(/peeked card/)).toBeInTheDocument();
});

test("an interrupted gesture (pointercancel) settles the fold instead of sticking", () => {
  const onPeek = vi.fn();
  const onReveal = vi.fn();
  render(<SqueezeCard card={faceDown} onPeek={onPeek} onReveal={onReveal} />);
  const el = screen.getByRole("button");
  const card = el.querySelector(".card")!;
  const box = (left: number, top: number, width: number, height: number) =>
    ({ left, top, width, height, right: left + width, bottom: top + height, x: left, y: top, toJSON: () => "" }) as DOMRect;
  vi.spyOn(el, "getBoundingClientRect").mockReturnValue(box(0, 0, 108, 154));
  vi.spyOn(card as HTMLElement, "getBoundingClientRect").mockReturnValue(box(7, 7, 94, 140));
  fireEvent.pointerDown(el, { pointerId: 1, clientX: 54, clientY: 140 });
  fireEvent.pointerMove(el, { pointerId: 1, clientX: 54, clientY: 100 }); // mid-squeeze, fold up
  expect(document.querySelector(".card-peel-under")).not.toBeNull();
  // the browser takes the pointer away (incoming call, scroll takeover)
  fireEvent.pointerCancel(el, { pointerId: 1, clientX: 54, clientY: 100 });
  expect(document.querySelector(".card-peel-under")).toBeNull(); // no stuck fold
  expect(onReveal).not.toHaveBeenCalled();
  fireEvent.click(el); // any trailing synthetic click is swallowed too
  expect(onReveal).not.toHaveBeenCalled();
});

test("without WebGL2 the squeeze stays on the CSS peel (no overlay canvas)", () => {
  const { container } = render(<SqueezeCard card={faceDown} onPeek={() => {}} onReveal={() => {}} />);
  const el = container.firstChild as Element;
  fireEvent.pointerDown(el, { pointerId: 1, clientX: 50, clientY: 120 });
  fireEvent.pointerMove(el, { pointerId: 1, clientX: 50, clientY: 60 });
  expect(container.querySelector("canvas")).toBeNull();
});

function box(left: number, top: number, width: number, height: number) {
  return {
    left,
    top,
    width,
    height,
    right: left + width,
    bottom: top + height,
    x: left,
    y: top,
    toJSON: () => "",
  } as DOMRect;
}

describe("peel reach (T8b)", () => {
  test("a drag starting 20px outside the card face still reaches PEEK_AT", () => {
    const onPeek = vi.fn();
    const onReveal = vi.fn();
    render(<SqueezeCard card={faceDown} onPeek={onPeek} onReveal={onReveal} />);
    const el = screen.getByRole("button");
    const card = el.querySelector(".card")!;
    vi.spyOn(card as HTMLElement, "getBoundingClientRect").mockReturnValue(box(0, 0, 94, 140));
    // 20px above the card's top edge — inside the 28px reach, outside the face
    fireEvent.pointerDown(el, { pointerId: 1, clientX: 47, clientY: -20 });
    fireEvent.pointerMove(el, { pointerId: 1, clientX: 47, clientY: 60 });
    expect(onPeek).toHaveBeenCalledOnce();
  });

  test("a grab in the reach maps to the nearest point on the card, not the raw click", () => {
    const onPeek = vi.fn();
    render(<SqueezeCard card={faceDown} onPeek={onPeek} onReveal={vi.fn()} />);
    const el = screen.getByRole("button");
    const card = el.querySelector(".card")!;
    vi.spyOn(card as HTMLElement, "getBoundingClientRect").mockReturnValue(box(0, 0, 94, 140));
    // 20px outside on every axis (up and to the left) — clamps to the corner (0, 0)
    fireEvent.pointerDown(el, { pointerId: 1, clientX: -20, clientY: -20 });
    // a tiny move that would be well under PEEK_AT if it had to travel the
    // full 20px + this distance from the raw click point
    fireEvent.pointerMove(el, { pointerId: 1, clientX: 40, clientY: 56 });
    expect(onPeek).toHaveBeenCalledOnce();
  });
});

describe("peek lens (T8b)", () => {
  afterEach(() => {
    // @ts-expect-error test cleanup of a global we stub per-test
    delete window.matchMedia;
  });

  test("shows a magnifier while a peek is held on a coarse pointer, gone on release", () => {
    window.matchMedia = vi.fn().mockReturnValue({ matches: true }) as unknown as typeof matchMedia;
    const onPeek = vi.fn();
    const onReveal = vi.fn();
    render(<SqueezeCard card={faceDown} onPeek={onPeek} onReveal={onReveal} />);
    const el = screen.getByRole("button");
    const card = el.querySelector(".card")!;
    vi.spyOn(card as HTMLElement, "getBoundingClientRect").mockReturnValue(box(7, 7, 94, 140));
    fireEvent.pointerDown(el, { pointerId: 1, clientX: 54, clientY: 140 });
    expect(document.querySelector(".peek-lens")).toBeNull();
    fireEvent.pointerMove(el, { pointerId: 1, clientX: 54, clientY: 80 });
    expect(onPeek).toHaveBeenCalledOnce();
    const lens = document.querySelector(".peek-lens");
    expect(lens).not.toBeNull();
    // above the finger: the lens's top must sit above the pointer's y (140)
    const top = parseFloat((lens as HTMLElement).style.top);
    expect(top).toBeLessThan(80);
    fireEvent.pointerUp(el, { pointerId: 1, clientX: 54, clientY: 80 });
    expect(document.querySelector(".peek-lens")).toBeNull();
  });

  test("never shows the magnifier on a fine pointer", () => {
    window.matchMedia = vi.fn().mockReturnValue({ matches: false }) as unknown as typeof matchMedia;
    const onPeek = vi.fn();
    const onReveal = vi.fn();
    render(<SqueezeCard card={faceDown} onPeek={onPeek} onReveal={onReveal} />);
    const el = screen.getByRole("button");
    const card = el.querySelector(".card")!;
    vi.spyOn(card as HTMLElement, "getBoundingClientRect").mockReturnValue(box(7, 7, 94, 140));
    fireEvent.pointerDown(el, { pointerId: 1, clientX: 54, clientY: 140 });
    fireEvent.pointerMove(el, { pointerId: 1, clientX: 54, clientY: 80 });
    expect(onPeek).toHaveBeenCalledOnce();
    expect(document.querySelector(".peek-lens")).toBeNull();
  });
});
