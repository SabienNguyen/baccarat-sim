import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Hud } from "./Hud";
import { bettingSnapshot, settledSnapshot } from "../test/fixtures";

test("shows bankroll, phase, and table limits", () => {
  render(<Hud snapshot={bettingSnapshot()} lastError={null} />);
  expect(screen.getByText("$1,000.00")).toBeInTheDocument();
  expect(screen.getByText(/Betting/)).toBeInTheDocument();
});

test("shows outcome and payouts when settled", () => {
  render(<Hud snapshot={settledSnapshot()} lastError={null} />);
  expect(screen.getByText(/PlayerWin/)).toBeInTheDocument();
  expect(screen.getByText("+$5.00")).toBeInTheDocument();
});

test("shows an error message when a command was rejected", () => {
  render(
    <Hud
      snapshot={bettingSnapshot()}
      lastError={{ WrongPhase: { expected: "Dealing", found: "Betting" } }}
    />,
  );
  expect(screen.getByRole("alert")).toHaveTextContent(/WrongPhase/);
});

test("house actions live in the panel: Reset bank and Lobby fire their handlers", async () => {
  const onResetBankroll = vi.fn();
  const onLeave = vi.fn();
  render(
    <Hud
      snapshot={bettingSnapshot()}
      lastError={null}
      onResetBankroll={onResetBankroll}
      onLeave={onLeave}
    />,
  );
  await userEvent.click(screen.getByRole("button", { name: "Reset bank" }));
  expect(onResetBankroll).toHaveBeenCalledOnce();
  await userEvent.click(screen.getByRole("button", { name: "Lobby" }));
  expect(onLeave).toHaveBeenCalledOnce();
});
