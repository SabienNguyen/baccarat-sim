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

test("without WebGL2 the squeeze stays on the CSS peel (no overlay canvas)", () => {
  const { container } = render(<SqueezeCard card={faceDown} onPeek={() => {}} onReveal={() => {}} />);
  const el = container.firstChild as Element;
  fireEvent.pointerDown(el, { pointerId: 1, clientX: 50, clientY: 120 });
  fireEvent.pointerMove(el, { pointerId: 1, clientX: 50, clientY: 60 });
  expect(container.querySelector("canvas")).toBeNull();
});
