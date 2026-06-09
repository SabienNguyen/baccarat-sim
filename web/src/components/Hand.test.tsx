import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Hand } from "./Hand";
import { dealingSnapshot, settledSnapshot } from "../test/fixtures";

test("in Dealing, renders cards and a peeked card reveals at its index", async () => {
  const onPeek = vi.fn();
  const onReveal = vi.fn();
  render(
    <Hand
      side="Player"
      hand={dealingSnapshot().player}
      phase="Dealing"
      onPeek={onPeek}
      onReveal={onReveal}
    />,
  );
  expect(screen.getByLabelText("Nine of Hearts")).toBeInTheDocument();
  await userEvent.click(screen.getByLabelText("peeked card, Spades"));
  expect(onReveal).toHaveBeenCalledWith(1);
});

test("in Settled, renders static cards and shows the total", () => {
  render(<Hand side="Player" hand={settledSnapshot().player} phase="Settled" />);
  expect(screen.getByLabelText("Four of Clubs")).toBeInTheDocument();
  expect(screen.getByText("Total: 9")).toBeInTheDocument();
});

test("hides the total until every card is face up", () => {
  render(<Hand side="Player" hand={dealingSnapshot().player} phase="Dealing" />);
  expect(screen.queryByText(/Total:/)).not.toBeInTheDocument();
});
