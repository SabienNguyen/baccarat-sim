import { render, screen } from "@testing-library/react";
import { Card } from "./Card";
import type { CardView } from "../engine/types";

test("renders a face-down back with no peel until squeezed", () => {
  const { container } = render(<Card card="FaceDown" />);
  expect(screen.getByLabelText("face-down card")).toBeInTheDocument();
  expect(container.querySelector(".card-peel-under")).toBeNull();
});

test("a squeezed face-down card shows the fold but reveals nothing", () => {
  const fold = {
    grip: "pinch" as const,
    clip: "polygon(0% 70%, 100% 70%, 100% 100%, 0% 100%)",
    flapClip: "polygon(0% 70%, 100% 70%, 100% 40%, 0% 40%)",
    origin: "50.0% 70.0%",
    faceShift: { left: "0.0%", top: "40.0%" },
    angle: 0,
    progress: 0.4,
  };
  const { container } = render(<Card card="FaceDown" fold={fold} />);
  // the bend exposes the felt where the card lifted away
  expect(container.querySelector(".card-peel-under")).not.toBeNull();
  expect(container.querySelector(".card-peel-flap")).not.toBeNull();
  expect(screen.queryByText(/[♠♥♦♣]/)).not.toBeInTheDocument();
  // the card lifts off the felt: perspective tilt, hinged on the far edge,
  // with the shadow separating beneath it
  const card = container.querySelector<HTMLElement>(".card")!;
  expect(card.style.transform).toContain("perspective(");
  // the peel layers must stay transform-free: a composited (transformed)
  // child escapes the flap's clip-path on GPU and the face floats off
  const flap = container.querySelector<HTMLElement>(".card-peel-flap")!;
  expect(flap.style.transform).toBe("");
  expect(card.style.transformOrigin).toBe("50.0% 0.0%"); // pull-up: top edge rests
  expect(card.style.filter).toContain("drop-shadow");
});

test("a peeked card folds back to show the real face under the corner", () => {
  const card: CardView = { Peeked: { sliver: { suit: "Spades", rank: "Nine" } } };
  const { container } = render(<Card card={card} />);
  expect(screen.getByLabelText("peeked card, Spades")).toBeInTheDocument();
  // the flap IS the card coming off the table: the genuine face rides it,
  // rotated 180 about the crease — you read the near edge at the tip
  const face = container.querySelector<HTMLElement>(".card-peel-flap .card-peel-flap-face");
  expect(face).not.toBeNull();
  // placed by layout shift (symmetric artwork), never by transform
  expect(face!.style.transform).toBe("");
  expect(face!.style.top).not.toBe("");
  expect(container.querySelectorAll(".card-peel-flap .card-pip")).toHaveLength(9);
  // the squeezer's thumbs cover the corner indices: pips only on the flap
  expect(container.querySelectorAll(".card-peel-flap .card-index")).toHaveLength(0);
  // nothing hides under the lift but the table
  expect(container.querySelector(".card-peel-under .card-pip")).toBeNull();
});

test("renders a face-up card with corner indices, pips, and color", () => {
  const card: CardView = { FaceUp: { rank: "Nine", suit: "Hearts" } };
  const { container } = render(<Card card={card} />);
  const face = screen.getByLabelText("Nine of Hearts");
  expect(face).toBeInTheDocument();
  expect(face).toHaveAttribute("data-color", "red");
  expect(screen.getAllByText("9")).toHaveLength(2); // both corner indices
  expect(container.querySelectorAll(".card-pip")).toHaveLength(9); // nine pips
});

test("a court card shows a double-ended figure instead of pips", () => {
  const card: CardView = { FaceUp: { rank: "King", suit: "Clubs" } };
  const { container } = render(<Card card={card} />);
  expect(screen.getByLabelText("King of Clubs")).toHaveAttribute("data-color", "black");
  expect(container.querySelectorAll(".card-pip")).toHaveLength(0);
  expect(container.querySelectorAll(".card-court-half")).toHaveLength(2); // mirrored figure
});

test("a live fold clips exactly where the squeeze says", () => {
  const fold = {
    grip: "pinch" as const,
    clip: "polygon(100.0% 71.4%, 100.0% 100.0%, 0.0% 100.0%, 0.0% 71.4%)",
    flapClip: "polygon(100.0% 71.4%, 100.0% 42.9%, 0.0% 42.9%, 0.0% 71.4%)",
    origin: "50.0% 71.4%",
    faceShift: { left: "0.0%", top: "42.9%" },
    angle: 0,
    progress: 0.4,
  };
  const { container } = render(<Card card="FaceDown" fold={fold} />);
  const peel = container.querySelector<HTMLElement>(".card-peel-under");
  expect(peel?.style.clipPath).toBe(fold.clip);
});
