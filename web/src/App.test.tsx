import { render, screen, fireEvent } from "@testing-library/react";
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

test("Reveal all flips the hidden cards one per beat, in ritual order", () => {
  vi.useFakeTimers();
  try {
    // a stateful table: each reveal actually turns that card
    let snap = dealingSnapshot();
    const reveal = vi.fn((side: "Player" | "Banker", i: number) => {
      const next = structuredClone(snap);
      const cards = side === "Player" ? next.player.cards : next.banker.cards;
      cards[i] = { FaceUp: { rank: "Two", suit: "Clubs" } };
      snap = next;
      return okResult(next);
    });
    const store = createGameStore(fakeSession(dealingSnapshot(), {
      snapshot: () => snap,
      reveal: reveal as never,
    }));
    render(<App store={store} />);
    fireEvent.click(screen.getByRole("button", { name: "Reveal all" }));
    // the first flip is immediate; the rest follow one per beat, in order
    expect(reveal).toHaveBeenCalledTimes(1);
    expect(reveal).toHaveBeenNthCalledWith(1, "Player", 1);
    vi.advanceTimersByTime(900);
    expect(reveal).toHaveBeenNthCalledWith(2, "Banker", 0);
    vi.advanceTimersByTime(900);
    expect(reveal).toHaveBeenNthCalledWith(3, "Banker", 1);
    vi.advanceTimersByTime(2000);
    expect(reveal).toHaveBeenCalledTimes(3); // table clear, pacer stopped
  } finally {
    vi.useRealTimers();
  }
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

test("New Shoe opens the cut-the-deck ritual and only shuffles after the cut", async () => {
  const newShoe = vi.fn(() => okResult(bettingSnapshot()));
  const store = createGameStore(fakeSession(bettingSnapshot(), { newShoe }));
  render(<App store={store} />);
  await userEvent.click(screen.getByRole("button", { name: "New Shoe" }));
  expect(screen.getByRole("dialog", { name: "Cut the deck" })).toBeInTheDocument();
  expect(newShoe).not.toHaveBeenCalled();
  fireEvent.click(screen.getByLabelText("Shoe").firstChild as Element);
  await userEvent.click(screen.getByRole("button", { name: /Cut & shuffle/ }));
  expect(newShoe).toHaveBeenCalledOnce();
  expect(screen.queryByRole("dialog", { name: "Cut the deck" })).toBeNull();
});
