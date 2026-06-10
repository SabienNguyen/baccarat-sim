import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { BetRail } from "./BetRail";
import { bettingSnapshot, dealingSnapshot } from "../test/fixtures";
import { buyIn } from "../chips";

const rack = buyIn(1_000_000).rack;

const noopProps = {
  rack,
  hand: [] as number[],
  change: 0,
  stagedChips: [] as number[][],
  onPickChip: vi.fn(),
  onReturnHand: vi.fn(),
  onPlaceHand: vi.fn(),
  onPlaceChip: vi.fn(),
  onClear: vi.fn(),
  onOpenExchange: vi.fn(),
};

test("clicking a chip picks it up", async () => {
  const onPickChip = vi.fn();
  render(<BetRail snapshot={bettingSnapshot()} {...noopProps} onPickChip={onPickChip} />);
  await userEvent.click(screen.getByRole("button", { name: "$25.00 chip" }));
  expect(onPickChip).toHaveBeenCalledWith(2500);
});

test("clicking a spot places the hand there", async () => {
  const onPlaceHand = vi.fn();
  render(
    <BetRail
      snapshot={bettingSnapshot()}
      {...noopProps}
      hand={[2500, 500]}
      onPlaceHand={onPlaceHand}
    />,
  );
  await userEvent.click(screen.getByRole("button", { name: "Bet Player" }));
  expect(onPlaceHand).toHaveBeenCalledWith({ Main: "Player" });
});

test("the hand tray shows the picked total and returns chips", async () => {
  const onReturnHand = vi.fn();
  render(
    <BetRail
      snapshot={bettingSnapshot()}
      {...noopProps}
      hand={[10000, 2500]}
      onReturnHand={onReturnHand}
    />,
  );
  expect(screen.getByLabelText("Chips in hand")).toHaveTextContent("$125.00 in hand");
  await userEvent.click(screen.getByRole("button", { name: "Return" }));
  expect(onReturnHand).toHaveBeenCalledOnce();
});

test("dropping a chip on a spot places that denomination", () => {
  const onPlaceChip = vi.fn();
  render(<BetRail snapshot={bettingSnapshot()} {...noopProps} onPlaceChip={onPlaceChip} />);
  const spot = screen.getByRole("button", { name: "Bet Banker" });
  fireEvent.drop(spot, { dataTransfer: { getData: () => "50000" } });
  expect(onPlaceChip).toHaveBeenCalledWith({ Main: "Banker" }, 50000);
});

test("a chip dropped outside the Betting phase is ignored", () => {
  const onPlaceChip = vi.fn();
  render(<BetRail snapshot={dealingSnapshot()} {...noopProps} onPlaceChip={onPlaceChip} />);
  const spot = screen.getByRole("button", { name: "Bet Banker" });
  fireEvent.drop(spot, { dataTransfer: { getData: () => "50000" } });
  expect(onPlaceChip).not.toHaveBeenCalled();
});

test("staged chips render on their spot with the staked total", () => {
  const snap = bettingSnapshot({
    bets: [
      { kind: { Main: "Player" }, amount: 12500 },
      { kind: { Main: "Banker" }, amount: 2500 },
    ],
  });
  render(
    <BetRail
      snapshot={snap}
      {...noopProps}
      stagedChips={[
        [10000, 2500],
        [2500],
      ]}
    />,
  );
  const player = screen.getByRole("button", { name: "Bet Player" });
  expect(player).toHaveTextContent("$125.00");
  const banker = screen.getByRole("button", { name: "Bet Banker" });
  expect(banker).toHaveTextContent("$25.00");
});

test("the Exchange button opens the dealer exchange", async () => {
  const onOpenExchange = vi.fn();
  render(<BetRail snapshot={bettingSnapshot()} {...noopProps} onOpenExchange={onOpenExchange} />);
  await userEvent.click(screen.getByRole("button", { name: "Exchange" }));
  expect(onOpenExchange).toHaveBeenCalledOnce();
});

test("bet spots are disabled outside the Betting phase", () => {
  render(<BetRail snapshot={dealingSnapshot()} {...noopProps} />);
  expect(screen.getByRole("button", { name: "Bet Player" })).toBeDisabled();
});
