import { render, screen } from "@testing-library/react";
import { App } from "./App";
import { createGameStore } from "./store/gameStore";
import type { GameSession, CommandResult } from "./engine/adapter";
import { bettingSnapshot } from "./test/fixtures";

function fakeSession(): GameSession {
  const ok: CommandResult = { ok: true, snapshot: bettingSnapshot() };
  return {
    snapshot: () => bettingSnapshot(),
    placeBet: () => ok,
    clearBets: () => ok,
    deal: () => ok,
    peek: () => ok,
    reveal: () => ok,
    settle: () => ok,
    newShoe: () => ok,
  };
}

test("mounts the composed table with its core regions", () => {
  const store = createGameStore(fakeSession());
  render(<App store={store} />);
  expect(screen.getByRole("heading", { name: "Baccarat Simulator" })).toBeInTheDocument();
  expect(screen.getByLabelText("HUD")).toBeInTheDocument();
  expect(screen.getByLabelText("Bet rail")).toBeInTheDocument();
  expect(screen.getByLabelText("Scoreboard")).toBeInTheDocument();
  expect(screen.getByLabelText("Player hand")).toBeInTheDocument();
  expect(screen.getByLabelText("Banker hand")).toBeInTheDocument();
});
