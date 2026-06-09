import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Controls } from "./Controls";
import { bettingSnapshot, dealingSnapshot } from "../test/fixtures";

test("Deal is enabled in Betting with at least one bet", async () => {
  const onDeal = vi.fn();
  const snap = bettingSnapshot({ bets: [{ kind: { Main: "Player" }, amount: 500 }] });
  render(
    <Controls
      snapshot={snap}
      onDeal={onDeal}
      onReveal={vi.fn()}
      onSettle={vi.fn()}
      onNewShoe={vi.fn()}
    />,
  );
  const deal = screen.getByRole("button", { name: "Deal" });
  expect(deal).toBeEnabled();
  await userEvent.click(deal);
  expect(onDeal).toHaveBeenCalledOnce();
});

test("Deal is disabled in Betting with no bets", () => {
  render(
    <Controls
      snapshot={bettingSnapshot()}
      onDeal={vi.fn()}
      onReveal={vi.fn()}
      onSettle={vi.fn()}
      onNewShoe={vi.fn()}
    />,
  );
  expect(screen.getByRole("button", { name: "Deal" })).toBeDisabled();
});

test("Settle is enabled in Dealing and a Reveal button exists per hidden card", () => {
  render(
    <Controls
      snapshot={dealingSnapshot()}
      onDeal={vi.fn()}
      onReveal={vi.fn()}
      onSettle={vi.fn()}
      onNewShoe={vi.fn()}
    />,
  );
  expect(screen.getByRole("button", { name: "Settle" })).toBeEnabled();
  expect(screen.getAllByRole("button", { name: /^Reveal / })).toHaveLength(3);
});

test("clicking a Reveal button calls onReveal with that hand and index", async () => {
  const onReveal = vi.fn();
  render(
    <Controls
      snapshot={dealingSnapshot()}
      onDeal={vi.fn()}
      onReveal={onReveal}
      onSettle={vi.fn()}
      onNewShoe={vi.fn()}
    />,
  );
  await userEvent.click(screen.getByRole("button", { name: "Reveal Player 1" }));
  expect(onReveal).toHaveBeenCalledWith("Player", 1);
});
