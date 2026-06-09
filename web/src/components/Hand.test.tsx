import { render, screen } from "@testing-library/react";
import { Hand } from "./Hand";
import { dealingSnapshot, settledSnapshot } from "../test/fixtures";

test("renders face-up, peeked, and face-down cards", () => {
  const snap = dealingSnapshot();
  render(<Hand side="Player" hand={snap.player} />);
  expect(screen.getByText(/Nine of Hearts/)).toBeInTheDocument();
  expect(screen.getByText(/Peeked: Spades/)).toBeInTheDocument();
});

test("hides total while cards are not all face-up", () => {
  const snap = dealingSnapshot();
  render(<Hand side="Player" hand={snap.player} />);
  expect(screen.queryByText(/Total:/)).not.toBeInTheDocument();
});

test("shows total when the hand is fully revealed", () => {
  const snap = settledSnapshot();
  render(<Hand side="Player" hand={snap.player} />);
  expect(screen.getByText("Total: 9")).toBeInTheDocument();
});
