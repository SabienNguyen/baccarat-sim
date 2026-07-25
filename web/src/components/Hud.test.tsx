import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Hud } from "./Hud";
import { bettingSnapshot, settledSnapshot } from "../test/fixtures";

test("shows bankroll, phase, and table limits", () => {
  render(<Hud snapshot={bettingSnapshot()} />);
  expect(screen.getByText("$1,000.00")).toBeInTheDocument();
  expect(screen.getByText(/Betting/)).toBeInTheDocument();
});

test("shows outcome and payouts when settled", () => {
  render(<Hud snapshot={settledSnapshot()} />);
  // This asserted /PlayerWin/ — the wire enum the box used to print verbatim,
  // which the all-caps display font rendered as "PLAYERWIN". The outcome is
  // words now, so the old spelling must be gone rather than merely joined.
  expect(screen.getByText("Player win")).toBeInTheDocument();
  expect(screen.queryByText(/PlayerWin/)).toBeNull();
  expect(screen.getByText("+$5.00")).toBeInTheDocument();
});



test("house actions live in the panel: Reset bank and Lobby fire their handlers", async () => {
  const onResetBankroll = vi.fn();
  const onLeave = vi.fn();
  render(
    <Hud
      snapshot={bettingSnapshot()}
      onResetBankroll={onResetBankroll}
      onLeave={onLeave}
    />,
  );
  await userEvent.click(screen.getByRole("button", { name: "Reset bank" }));
  expect(onResetBankroll).toHaveBeenCalledOnce();
  await userEvent.click(screen.getByRole("button", { name: "Lobby" }));
  expect(onLeave).toHaveBeenCalledOnce();
});

test("shows goal progress when the table has a win condition", () => {
  render(<Hud snapshot={bettingSnapshot()} goal={400_000} />);
  // betting fixture bankroll is $1,000 of a $4,000 goal -> 25%
  expect(screen.getByText("Goal $4,000.00")).toBeInTheDocument();
  expect(screen.getByText("25%")).toBeInTheDocument();
});
