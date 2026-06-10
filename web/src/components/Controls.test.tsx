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
      onRevealAll={vi.fn()}
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
      onRevealAll={vi.fn()}
      onSettle={vi.fn()}
      onNewShoe={vi.fn()}
    />,
  );
  expect(screen.getByRole("button", { name: "Deal" })).toBeDisabled();
});

test("Reveal all is disabled outside Dealing and enabled (and fires) in Dealing", async () => {
  const onRevealAll = vi.fn();
  const { rerender } = render(
    <Controls
      snapshot={bettingSnapshot()}
      onDeal={vi.fn()}
      onRevealAll={onRevealAll}
      onSettle={vi.fn()}
      onNewShoe={vi.fn()}
    />,
  );
  expect(screen.getByRole("button", { name: "Reveal all" })).toBeDisabled();

  rerender(
    <Controls
      snapshot={dealingSnapshot()}
      onDeal={vi.fn()}
      onRevealAll={onRevealAll}
      onSettle={vi.fn()}
      onNewShoe={vi.fn()}
    />,
  );
  const revealAll = screen.getByRole("button", { name: "Reveal all" });
  expect(revealAll).toBeEnabled();
  await userEvent.click(revealAll);
  expect(onRevealAll).toHaveBeenCalledOnce();
});

test("Settle is enabled in Dealing; no per-card Reveal buttons exist", () => {
  render(
    <Controls
      snapshot={dealingSnapshot()}
      onDeal={vi.fn()}
      onRevealAll={vi.fn()}
      onSettle={vi.fn()}
      onNewShoe={vi.fn()}
    />,
  );
  expect(screen.getByRole("button", { name: "Settle" })).toBeEnabled();
  expect(screen.queryByRole("button", { name: /^Reveal (Player|Banker) / })).toBeNull();
});

test("the Explain button reflects and toggles explain mode", async () => {
  const onToggleExplain = vi.fn();
  render(
    <Controls
      snapshot={bettingSnapshot()}
      onDeal={vi.fn()}
      onRevealAll={vi.fn()}
      onSettle={vi.fn()}
      onNewShoe={vi.fn()}
      explainOn={true}
      onToggleExplain={onToggleExplain}
    />,
  );
  const btn = screen.getByRole("button", { name: "Explain" });
  expect(btn).toHaveAttribute("aria-pressed", "true");
  await userEvent.click(btn);
  expect(onToggleExplain).toHaveBeenCalledOnce();
});
