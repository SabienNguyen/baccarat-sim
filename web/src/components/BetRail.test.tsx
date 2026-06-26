import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { BetRail } from "./BetRail";
import { bettingSnapshot, dealingSnapshot } from "../test/fixtures";
import { CHIP_DENOMINATIONS } from "../chips";

const noopProps = {
  denoms: CHIP_DENOMINATIONS,
  selectedChip: 2500,
  available: 1_000_000,
  onSelectChip: vi.fn(),
  onStake: vi.fn(),
  onClear: vi.fn(),
};

// keep the side-bet drawer's saved state from leaking between tests
beforeEach(() => {
  try {
    localStorage.removeItem("baccarat.sidebets.open");
  } catch {
    /* storage unavailable in this env — fine */
  }
});

test("clicking a chip arms its denomination", async () => {
  const onSelectChip = vi.fn();
  render(<BetRail snapshot={bettingSnapshot()} {...noopProps} onSelectChip={onSelectChip} />);
  await userEvent.click(screen.getByRole("button", { name: "$5.00 chip" }));
  expect(onSelectChip).toHaveBeenCalledWith(500);
});

test("clicking a spot stakes the armed chip there", async () => {
  const onStake = vi.fn();
  render(<BetRail snapshot={bettingSnapshot()} {...noopProps} onStake={onStake} />);
  await userEvent.click(screen.getByRole("button", { name: "Bet Player" }));
  expect(onStake).toHaveBeenCalledWith({ Main: "Player" });
});

test("dropping a chip on a spot stakes that denomination", () => {
  const onStake = vi.fn();
  render(<BetRail snapshot={bettingSnapshot()} {...noopProps} onStake={onStake} />);
  const spot = screen.getByRole("button", { name: "Bet Banker" });
  fireEvent.drop(spot, { dataTransfer: { getData: () => "50000" } });
  expect(onStake).toHaveBeenCalledWith({ Main: "Banker" }, 50000);
});

test("a chip dropped outside Betting is ignored", () => {
  const onStake = vi.fn();
  render(<BetRail snapshot={dealingSnapshot()} {...noopProps} onStake={onStake} />);
  fireEvent.drop(screen.getByRole("button", { name: "Bet Banker" }), {
    dataTransfer: { getData: () => "50000" },
  });
  expect(onStake).not.toHaveBeenCalled();
});

test("staked totals render on their spot", () => {
  const snap = bettingSnapshot({
    bets: [
      { kind: { Main: "Player" }, amount: 12500 },
      { kind: { Main: "Banker" }, amount: 2500 },
    ],
  });
  render(<BetRail snapshot={snap} {...noopProps} />);
  expect(screen.getByRole("button", { name: "Bet Player" })).toHaveTextContent("$125.00");
  expect(screen.getByRole("button", { name: "Bet Banker" })).toHaveTextContent("$25.00");
});

test("a chip past the available balance is disabled", () => {
  render(<BetRail snapshot={bettingSnapshot()} {...noopProps} available={2500} />);
  expect(screen.getByRole("button", { name: "$1,000.00 chip" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "$25.00 chip" })).toBeEnabled();
});

test("the armed chip shows as pressed", () => {
  render(<BetRail snapshot={bettingSnapshot()} {...noopProps} selectedChip={2500} />);
  expect(screen.getByRole("button", { name: "$25.00 chip" })).toHaveAttribute("aria-pressed", "true");
});

test("bet spots are disabled outside the Betting phase", () => {
  render(<BetRail snapshot={dealingSnapshot()} {...noopProps} />);
  expect(screen.getByRole("button", { name: "Bet Player" })).toBeDisabled();
});

test("side bets are hidden until the drawer is opened", async () => {
  render(<BetRail snapshot={bettingSnapshot()} {...noopProps} />);
  expect(screen.queryByRole("button", { name: "Bet Dragon 7" })).toBeNull();
  await userEvent.click(screen.getByRole("button", { name: /Side bets/ }));
  expect(screen.getByRole("button", { name: "Bet Dragon 7" })).toBeInTheDocument();
});

test("a staked side bet forces the drawer open", () => {
  const snap = bettingSnapshot({ bets: [{ kind: { Side: "Dragon7" }, amount: 500 }] });
  render(<BetRail snapshot={snap} {...noopProps} />);
  expect(screen.getByRole("button", { name: "Bet Dragon 7" })).toBeInTheDocument();
});

test("the info icon opens the bonus-bets explainer", async () => {
  render(<BetRail snapshot={bettingSnapshot()} {...noopProps} />);
  await userEvent.click(screen.getByRole("button", { name: "What are the bonus bets?" }));
  expect(screen.getByRole("dialog", { name: "Bonus bets" })).toHaveTextContent(/Dragon 7/);
});

test("Clear bets is disabled when nothing is staged", () => {
  render(<BetRail snapshot={bettingSnapshot()} {...noopProps} />);
  expect(screen.getByRole("button", { name: "Clear bets" })).toBeDisabled();
});
