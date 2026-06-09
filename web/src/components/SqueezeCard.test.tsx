import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SqueezeCard } from "./SqueezeCard";
import type { CardView } from "../engine/types";

const faceDown: CardView = "FaceDown";
const peeked: CardView = { Peeked: { sliver: { suit: "Spades" } } };
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

test("drag: crossing the peek threshold peeks, crossing reveal threshold reveals", () => {
  const onPeek = vi.fn();
  const onReveal = vi.fn();
  render(<SqueezeCard card={faceDown} onPeek={onPeek} onReveal={onReveal} />);
  const el = screen.getByRole("button");
  fireEvent.pointerDown(el, { pointerId: 1, clientY: 300 });
  fireEvent.pointerMove(el, { pointerId: 1, clientY: 264 }); // progress 0.30 -> peek
  expect(onPeek).toHaveBeenCalledOnce();
  expect(onReveal).not.toHaveBeenCalled();
  fireEvent.pointerMove(el, { pointerId: 1, clientY: 204 }); // progress 0.80 -> reveal
  expect(onReveal).toHaveBeenCalledOnce();
});

test("drag: releasing after a started peek commits the reveal", () => {
  const onPeek = vi.fn();
  const onReveal = vi.fn();
  render(<SqueezeCard card={faceDown} onPeek={onPeek} onReveal={onReveal} />);
  const el = screen.getByRole("button");
  fireEvent.pointerDown(el, { pointerId: 1, clientY: 300 });
  fireEvent.pointerMove(el, { pointerId: 1, clientY: 264 }); // 0.30 -> peek
  fireEvent.pointerUp(el, { pointerId: 1, clientY: 264 }); // release past peek -> reveal
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
