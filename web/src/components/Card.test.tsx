import { render, screen } from "@testing-library/react";
import { Card } from "./Card";
import type { CardView } from "../engine/types";

test("renders a face-down back with no peel until squeezed", () => {
  const { container } = render(<Card card="FaceDown" />);
  expect(screen.getByLabelText("face-down card")).toBeInTheDocument();
  expect(container.querySelector(".card-peel-under")).toBeNull();
});

test("a squeezed face-down card shows the fold but reveals nothing", () => {
  const { container } = render(<Card card="FaceDown" bend={0.4} />);
  expect(container.querySelector(".card-peel-under")).not.toBeNull();
  expect(screen.queryByText(/[♠♥♦♣]/)).not.toBeInTheDocument();
});

test("a peeked card folds back to show the real face under the corner", () => {
  const card: CardView = { Peeked: { sliver: { suit: "Spades", rank: "Nine" } } };
  const { container } = render(<Card card={card} />);
  expect(screen.getByLabelText("peeked card, Spades")).toBeInTheDocument();
  // the genuine printed face (pip edges, index) sits under the fold
  expect(container.querySelector(".card-peel-face")).not.toBeNull();
  expect(container.querySelectorAll(".card-pip")).toHaveLength(9);
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

test("an edge grip peels a straight strip back", () => {
  const { container } = render(<Card card="FaceDown" bend={0.4} grip="bottom" />);
  expect(container.querySelector(".card-peel-under--bottom")).not.toBeNull();
  expect(container.querySelector(".card-peel-shade--bottom")).not.toBeNull();
});
