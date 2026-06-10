import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { App } from "./App";
import { createGameStore } from "./store/gameStore";
import type { GameSession, CommandResult } from "./engine/adapter";
import type { RoundSnapshot } from "./engine/types";
import { bettingSnapshot, dealingSnapshot } from "./test/fixtures";

function okResult(snap: RoundSnapshot): CommandResult {
  return { ok: true, snapshot: snap };
}

function fakeSession(initial: RoundSnapshot, spies: Partial<GameSession> = {}): GameSession {
  const ok = okResult(initial);
  return {
    snapshot: () => initial,
    placeBet: () => ok,
    clearBets: () => ok,
    deal: () => ok,
    peek: () => ok,
    reveal: () => ok,
    settle: () => ok,
    newShoe: () => ok,
    ...spies,
  };
}

test("mounts the composed table with its core regions", () => {
  const store = createGameStore(fakeSession(bettingSnapshot()));
  render(<App store={store} />);
  expect(screen.getByRole("heading", { name: "Baccarat Simulator" })).toBeInTheDocument();
  expect(screen.getByLabelText("HUD")).toBeInTheDocument();
  expect(screen.getByLabelText("Bet rail")).toBeInTheDocument();
  expect(screen.getByLabelText("Scoreboard")).toBeInTheDocument();
  expect(screen.getByLabelText("Player hand")).toBeInTheDocument();
  expect(screen.getByLabelText("Banker hand")).toBeInTheDocument();
});

test("in Dealing, clicking a face-down card peeks it at (side, index)", async () => {
  const peek = vi.fn(() => okResult(dealingSnapshot()));
  const store = createGameStore(fakeSession(dealingSnapshot(), { peek }));
  render(<App store={store} />);
  const faceDowns = screen.getAllByLabelText("face-down card");
  await userEvent.click(faceDowns[0]);
  expect(peek).toHaveBeenCalledWith("Banker", 0);
});

test("Reveal all reveals every hidden card in both hands", async () => {
  const reveal = vi.fn(() => okResult(dealingSnapshot()));
  const store = createGameStore(fakeSession(dealingSnapshot(), { reveal }));
  render(<App store={store} />);
  await userEvent.click(screen.getByRole("button", { name: "Reveal all" }));
  expect(reveal).toHaveBeenCalledTimes(3);
  expect(reveal).toHaveBeenCalledWith("Player", 1);
  expect(reveal).toHaveBeenCalledWith("Banker", 0);
  expect(reveal).toHaveBeenCalledWith("Banker", 1);
});

test("shows the win pop-up after a winning settle", () => {
  const dealing = dealingSnapshot();
  const won: RoundSnapshot = {
    ...dealing,
    phase: "Settled",
    bankroll: dealing.bankroll + 9500,
  };
  const store = createGameStore(
    fakeSession(dealing, { settle: () => okResult(won) }),
  );
  const { rerender } = render(<App store={store} />);
  expect(screen.queryByRole("status")).toBeNull();
  store.getState().settle();
  rerender(<App store={store} />);
  expect(screen.getByRole("status")).toHaveTextContent("+$95.00");
});

test("hides the Player's third card until the initial four are revealed (no count leak)", () => {
  const snap: RoundSnapshot = {
    ...dealingSnapshot(),
    player: {
      cards: [
        { FaceUp: { rank: "Two", suit: "Clubs" } },
        "FaceDown", // an initial card is still down
        { FaceUp: { rank: "King", suit: "Spades" } }, // the third card must stay hidden
      ],
      total: null,
    },
    banker: { cards: ["FaceDown", "FaceDown"], total: null },
  };
  const store = createGameStore(fakeSession(snap));
  render(<App store={store} />);
  expect(screen.queryByLabelText("King of Spades")).toBeNull();
});

test("renders the dealer line for the current phase", () => {
  const store = createGameStore(fakeSession(bettingSnapshot()));
  render(<App store={store} />);
  const dealer = screen.getByLabelText("Dealer");
  expect(dealer).toHaveTextContent("Place your bets.");
});

test("explain panel appears only when explain mode is on", async () => {
  const store = createGameStore(fakeSession(bettingSnapshot()));
  render(<App store={store} />);
  expect(screen.queryByLabelText("Explain")).toBeNull();
  await userEvent.click(screen.getByRole("button", { name: "Explain" }));
  expect(screen.getByLabelText("Explain")).toBeInTheDocument();
});
