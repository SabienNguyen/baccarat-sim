import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { BetRail } from "./BetRail";
import { bettingSnapshot, dealingSnapshot } from "../test/fixtures";
import type { BetKind } from "../engine/types";

const noopProps = {
  onSelectChip: vi.fn(),
  onPlaceBet: vi.fn(),
  onPlaceChip: vi.fn(),
  onClear: vi.fn(),
};

test("placing a bet calls onPlaceBet with the spot's BetKind", async () => {
  const onPlaceBet = vi.fn();
  render(
    <BetRail snapshot={bettingSnapshot()} selectedChip={2500} {...noopProps} onPlaceBet={onPlaceBet} />,
  );
  await userEvent.click(screen.getByRole("button", { name: "Bet Player" }));
  const expected: BetKind = { Main: "Player" };
  expect(onPlaceBet).toHaveBeenCalledWith(expected);
});

test("selecting a chip calls onSelectChip with the denomination", async () => {
  const onSelectChip = vi.fn();
  render(
    <BetRail snapshot={bettingSnapshot()} selectedChip={2500} {...noopProps} onSelectChip={onSelectChip} />,
  );
  await userEvent.click(screen.getByRole("button", { name: "$500.00 chip" }));
  expect(onSelectChip).toHaveBeenCalledWith(50000);
});

test("dropping a chip on a spot places that amount via onPlaceChip", () => {
  const onPlaceChip = vi.fn();
  render(
    <BetRail snapshot={bettingSnapshot()} selectedChip={2500} {...noopProps} onPlaceChip={onPlaceChip} />,
  );
  const spot = screen.getByRole("button", { name: "Bet Banker" });
  fireEvent.drop(spot, {
    dataTransfer: { getData: () => "50000" },
  });
  expect(onPlaceChip).toHaveBeenCalledWith({ Main: "Banker" }, 50000);
});

test("a chip dropped outside the Betting phase is ignored", () => {
  const onPlaceChip = vi.fn();
  render(
    <BetRail snapshot={dealingSnapshot()} selectedChip={2500} {...noopProps} onPlaceChip={onPlaceChip} />,
  );
  const spot = screen.getByRole("button", { name: "Bet Banker" });
  fireEvent.drop(spot, { dataTransfer: { getData: () => "50000" } });
  expect(onPlaceChip).not.toHaveBeenCalled();
});

test("bet spots are disabled outside the Betting phase", () => {
  render(<BetRail snapshot={dealingSnapshot()} selectedChip={2500} {...noopProps} />);
  expect(screen.getByRole("button", { name: "Bet Player" })).toBeDisabled();
});

test("lists staged bets with formatted amounts", () => {
  render(<BetRail snapshot={dealingSnapshot()} selectedChip={2500} {...noopProps} />);
  expect(screen.getByText(/Player.*\$5\.00/)).toBeInTheDocument();
});
