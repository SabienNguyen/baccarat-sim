import { render, screen, fireEvent, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { App, GameTable, AUTO_ADVANCE_MS, SWEEP_MS } from "./App";
import { createGameStore } from "./store/gameStore";
import type { GameSession, CommandResult } from "./engine/adapter";
import type { RoundSnapshot } from "./engine/types";
import { bettingSnapshot, dealingSnapshot } from "./test/fixtures";
import { createRemoteStore } from "./multiplayer/remoteStore";

// A recording portal in place of the real (null) one, to check the table's
// gameplay signals and ad break are wired. Everything else is the real module.
const portalSpy = vi.hoisted(() => ({
  gameplayStart: vi.fn(),
  gameplayStop: vi.fn(),
  happyTime: vi.fn(),
  requestMidgameAd: vi.fn(async () => {}),
}));
vi.mock("./portal", async (importOriginal) => {
  const real = await importOriginal<typeof import("./portal")>();
  return {
    ...real,
    getPortal: () => ({
      ...real.nullAdapter,
      name: "fake",
      ...portalSpy,
    }),
  };
});

test("the table sends the portal its gameplay signals and an ad break on a fresh shoe", async () => {
  const store = createGameStore(fakeSession(bettingSnapshot()));
  render(<App store={store} />);
  expect(portalSpy.gameplayStart).not.toHaveBeenCalled();
  act(() => store.setState({ snapshot: dealingSnapshot() })); // the first deal
  expect(portalSpy.gameplayStart).toHaveBeenCalledOnce();
  act(() => store.setState({ busted: true }));
  expect(portalSpy.gameplayStop).toHaveBeenCalledOnce();
  act(() => store.setState({ busted: false })); // re-bought: play resumes
  expect(portalSpy.gameplayStart).toHaveBeenCalledTimes(2);
  act(() => store.setState({ goalReached: true }));
  expect(portalSpy.happyTime).toHaveBeenCalledOnce();
  expect(portalSpy.gameplayStop).toHaveBeenCalledTimes(2);
  act(() => store.setState({ goalReached: false, snapshot: bettingSnapshot() }));

  await userEvent.click(screen.getByRole("button", { name: "New Shoe" }));
  fireEvent.click(screen.getByLabelText("Shoe").firstChild as Element);
  await userEvent.click(screen.getByRole("button", { name: /Cut & shuffle/ }));
  expect(portalSpy.requestMidgameAd).toHaveBeenCalledOnce();
});

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

/** A settled hand where the Player made an unbet pair — fires the bonus nudge. */
function pairWinHand(): RoundSnapshot {
  return {
    ...dealingSnapshot(),
    phase: "Settled",
    player: {
      cards: [
        { FaceUp: { rank: "Nine", suit: "Hearts" } },
        { FaceUp: { rank: "Nine", suit: "Spades" } },
      ],
      total: 8,
    },
    banker: {
      cards: [
        { FaceUp: { rank: "Two", suit: "Clubs" } },
        { FaceUp: { rank: "Three", suit: "Hearts" } },
      ],
      total: 5,
    },
    outcome: "PlayerWin",
    payouts: [],
    bets: [],
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

test("single-player shows no Settle or Next-hand buttons", () => {
  const store = createGameStore(fakeSession(dealingSnapshot()));
  render(<App store={store} />);
  expect(screen.queryByRole("button", { name: "Settle" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Next hand" })).toBeNull();
});

test("single-player auto-settles once all cards are up, then auto-advances to Betting", () => {
  vi.useFakeTimers();
  try {
    const allUp: RoundSnapshot = {
      ...dealingSnapshot(),
      player: {
        cards: [
          { FaceUp: { rank: "Nine", suit: "Hearts" } },
          { FaceUp: { rank: "Four", suit: "Clubs" } },
        ],
        total: 3,
      },
      banker: {
        cards: [
          { FaceUp: { rank: "Two", suit: "Spades" } },
          { FaceUp: { rank: "Three", suit: "Hearts" } },
        ],
        total: 5,
      },
    };
    const settled: RoundSnapshot = {
      ...allUp,
      phase: "Settled",
      bankroll: allUp.bankroll + 500,
      outcome: "PlayerWin",
      payouts: [{ bet: { kind: { Main: "Player" }, amount: 500 }, net: 500 }],
    };
    let snap = allUp;
    const store = createGameStore(
      fakeSession(allUp, { snapshot: () => snap, settle: () => okResult((snap = settled)) }),
    );
    render(<App store={store} />);
    expect(store.getState().snapshot.phase).toBe("Dealing");
    act(() => vi.advanceTimersByTime(600)); // AUTO_SETTLE_MS
    expect(store.getState().snapshot.phase).toBe("Settled");
    act(() => vi.advanceTimersByTime(AUTO_ADVANCE_MS));
    expect(store.getState().snapshot.phase).toBe("Betting");
  } finally {
    vi.useRealTimers();
  }
});

test("single-player: an unbet bonus that hit is reported, but never offered as a bet", async () => {
  const pairWin: RoundSnapshot = {
    ...dealingSnapshot(),
    phase: "Settled",
    player: {
      cards: [
        { FaceUp: { rank: "Nine", suit: "Hearts" } },
        { FaceUp: { rank: "Nine", suit: "Spades" } },
      ],
      total: 8,
    },
    banker: {
      cards: [
        { FaceUp: { rank: "Two", suit: "Clubs" } },
        { FaceUp: { rank: "Three", suit: "Hearts" } },
      ],
      total: 5,
    },
    outcome: "PlayerWin",
    payouts: [],
    bets: [],
  };
  const placeBet = vi.fn(() => okResult(pairWin));
  const store = createGameStore(fakeSession(pairWin, { placeBet }));
  render(<App store={store} />);
  // it teaches that the bonus exists and what it pays...
  expect(screen.getByText(/PLAYER PAIR JUST HIT/)).toBeInTheDocument();
  expect(screen.getByText(/pays 11:1/)).toBeInTheDocument();
  // ...but must NOT invite a chase: a bonus hitting says nothing about the next
  // coup, and the side bets carry the worst edges on the table.
  expect(screen.queryByRole("button", { name: /bet .* next hand/ })).toBeNull();
  // the only control is dismissing the notice, which places no bet
  await userEvent.click(screen.getByRole("button", { name: "Dismiss" }));
  expect(placeBet).not.toHaveBeenCalled();
  expect(screen.queryByText(/PLAYER PAIR JUST HIT/)).toBeNull();
});

test("single-player: a winning-bonus hand auto-advances after the delay, clearing the banner", () => {
  vi.useFakeTimers();
  try {
    const store = createGameStore(fakeSession(pairWinHand()));
    render(<App store={store} />);
    expect(screen.getByText(/PLAYER PAIR JUST HIT/)).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(AUTO_ADVANCE_MS));
    expect(store.getState().snapshot.phase).toBe("Betting");
    expect(screen.queryByText(/PLAYER PAIR JUST HIT/)).toBeNull();
  } finally {
    vi.useRealTimers();
  }
});

test("single-player: the table sweeps the cards out before clearing to the next hand", () => {
  vi.useFakeTimers();
  try {
    const store = createGameStore(fakeSession(pairWinHand()));
    const { container } = render(<App store={store} />);
    act(() => vi.advanceTimersByTime(AUTO_ADVANCE_MS - SWEEP_MS - 100)); // still holding — no sweep yet
    expect(container.querySelector(".card-stage.sweeping")).toBeNull();
    expect(store.getState().snapshot.phase).toBe("Settled");
    act(() => vi.advanceTimersByTime(200)); // 100 ms into the sweep-out
    expect(container.querySelector(".card-stage.sweeping")).not.toBeNull();
    expect(store.getState().snapshot.phase).toBe("Settled");
    act(() => vi.advanceTimersByTime(SWEEP_MS - 100)); // AUTO_ADVANCE_MS: cleared to the next hand
    expect(store.getState().snapshot.phase).toBe("Betting");
    expect(container.querySelector(".card-stage.sweeping")).toBeNull();
  } finally {
    vi.useRealTimers();
  }
});

test("single-player: closing the bonus nudge hides it without advancing the hand", async () => {
  const store = createGameStore(fakeSession(pairWinHand()));
  render(<App store={store} />);
  expect(screen.getByText(/PLAYER PAIR JUST HIT/)).toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "Dismiss" }));
  expect(screen.queryByText(/PLAYER PAIR JUST HIT/)).toBeNull();
  // the hand stays settled — closing dismisses the notice, it doesn't move on
  expect(store.getState().snapshot.phase).toBe("Settled");
});

test("busting offers a re-buy and a way out", async () => {
  const user = userEvent.setup();
  const store = createGameStore(fakeSession(bettingSnapshot()));
  store.setState({ busted: true });
  const onLeave = vi.fn();
  const onReset = vi.fn();
  render(<GameTable store={store} onLeave={onLeave} onReset={onReset} />);
  expect(screen.getByRole("dialog", { name: "Busted" })).toBeInTheDocument();

  await user.click(screen.getByRole("button", { name: "Re-buy" }));
  expect(onReset).toHaveBeenCalledOnce();

  // leaving clears the dead roll first, so the next visit re-buys fresh
  await user.click(screen.getByRole("button", { name: "Leave table" }));
  expect(onReset).toHaveBeenCalledTimes(2);
  expect(onLeave).toHaveBeenCalledOnce();
});

test("single-player: a chip tapped during the sweep leaves the felt clean for the next deal", () => {
  // Reported as "cards vanish after a tie": the hand pushes, the player re-bets
  // as the dealer is mucking the cards, and every card from then on is invisible
  // until a page refresh. The sweep flag must not outlive the hand it swept.
  vi.useFakeTimers();
  try {
    const tied: RoundSnapshot = {
      ...dealingSnapshot(),
      phase: "Settled",
      player: {
        cards: [
          { FaceUp: { rank: "Four", suit: "Clubs" } },
          { FaceUp: { rank: "Two", suit: "Hearts" } },
        ],
        total: 6,
      },
      banker: {
        cards: [
          { FaceUp: { rank: "King", suit: "Spades" } },
          { FaceUp: { rank: "Six", suit: "Diamonds" } },
        ],
        total: 6,
      },
      bets: [],
      outcome: "Tie",
      payouts: [{ bet: { kind: { Main: "Player" }, amount: 500 }, net: 0 }],
    };
    const betting = bettingSnapshot({ bets: [{ kind: { Main: "Player" }, amount: 500 }] });
    const nextDeal: RoundSnapshot = {
      ...betting,
      phase: "Dealing",
      player: { cards: ["FaceDown", "FaceDown"], total: null },
      banker: { cards: ["FaceDown", "FaceDown"], total: null },
    };
    let snap = tied;
    const store = createGameStore(
      fakeSession(tied, {
        snapshot: () => snap,
        placeBet: () => okResult((snap = betting)),
        deal: () => okResult((snap = nextDeal)),
      }),
    );
    const { container } = render(<App store={store} />);
    act(() => vi.advanceTimersByTime(AUTO_ADVANCE_MS - SWEEP_MS + 100)); // mid-sweep: the muck is playing
    expect(container.querySelector(".card-stage.sweeping")).not.toBeNull();

    // the player re-bets before the muck finishes — this opens the next hand
    act(() => store.getState().stake({ Main: "Player" }));
    expect(store.getState().snapshot.phase).toBe("Betting");
    act(() => vi.advanceTimersByTime(AUTO_ADVANCE_MS)); // well past where the muck would have ended
    expect(container.querySelector(".card-stage.sweeping")).toBeNull();

    // and the next deal's cards land on a felt that is NOT still sweeping
    act(() => store.getState().deal());
    expect(store.getState().snapshot.phase).toBe("Dealing");
    expect(screen.getAllByLabelText("face-down card")).toHaveLength(4);
    expect(container.querySelector(".card-stage.sweeping")).toBeNull();
  } finally {
    vi.useRealTimers();
  }
});

// --- the high-limit ask: flip one / flip both of the dealer's cards ---

/** A table snapshot mid-squeeze: I hold Player (seat 0), the house holds Banker. */
function houseHoldsBanker(banker: RoundSnapshot["banker"]["cards"]): RoundSnapshot {
  return {
    ...bettingSnapshot({
      phase: "Dealing",
      player: { cards: ["FaceDown", "FaceDown"], total: null },
      banker: { cards: banker, total: null },
      bets: [{ kind: { Main: "Player" }, amount: 500 }],
    }),
    // squeeze rights ride along on a table snapshot
    ...({ player_squeezer: 0, banker_squeezer: null } as object),
  };
}

test("while I squeeze Player, I can ask the dealer to flip one of his cards", async () => {
  const initial = houseHoldsBanker(["FaceDown", "FaceDown"]);
  const afterOne = houseHoldsBanker([{ FaceUp: { rank: "Five", suit: "Clubs" } }, "FaceDown"]);
  const requestDealerFlip = vi.fn((): CommandResult => okResult(afterOne));
  const store = createGameStore(fakeSession(initial, { requestDealerFlip }));
  render(<GameTable store={store} onLeave={() => {}} />);

  const banker = screen.getByLabelText("Banker hand");
  expect(banker).toContainElement(screen.getByRole("group", { name: "Ask the dealer" }));
  expect(screen.queryByRole("group", { name: "Ask the dealer" })).toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "Flip one" }));
  expect(requestDealerFlip).toHaveBeenCalledWith("One");

  // one house card up: the ask narrows to the other card
  expect(screen.getByRole("button", { name: "Flip the other" })).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Flip both" })).not.toBeInTheDocument();
  expect(screen.getByLabelText("Five of Clubs")).toBeInTheDocument();
});

test("once both of the dealer's cards are up, the ask is gone", () => {
  const bothUp = houseHoldsBanker([
    { FaceUp: { rank: "Five", suit: "Clubs" } },
    { FaceUp: { rank: "Two", suit: "Hearts" } },
  ]);
  const store = createGameStore(fakeSession(bothUp, { requestDealerFlip: () => okResult(bothUp) }));
  render(<GameTable store={store} onLeave={() => {}} />);
  expect(screen.queryByRole("group", { name: "Ask the dealer" })).not.toBeInTheDocument();
});

test("no ask before the deal, nor at a plain session without a house dealer", () => {
  const store = createGameStore(fakeSession(bettingSnapshot()));
  render(<GameTable store={store} onLeave={() => {}} />);
  expect(screen.queryByRole("group", { name: "Ask the dealer" })).not.toBeInTheDocument();
});

// --- squeeze rights at a shared table: only the holder gets the gesture ---

/** A shared table mid-squeeze: I'm seat 3 holding Banker; seat 5 holds Player. */
function sharedTableStore(overrides: { player_squeezer: number | null; banker_squeezer: number | null }) {
  const send = vi.fn();
  const view = {
    ...bettingSnapshot({
      phase: "Dealing",
      player: { cards: ["FaceDown", "FaceDown"], total: null },
      banker: { cards: ["FaceDown", "FaceDown"], total: null },
      bets: [{ kind: { Main: "Banker" }, amount: 500 }],
    }),
    seats: [
      { id: 3, name: "me", bankroll: 100_000, staked: 500, sitting_out: false, ready: true, decided: true },
      { id: 5, name: "them", bankroll: 100_000, staked: 500, sitting_out: false, ready: true, decided: true },
    ],
    ...overrides,
  } as Parameters<typeof createRemoteStore>[0]["view"];
  return { store: createRemoteStore({ tier: "mid", view, me: 3, send }), send };
}

test("at a shared table, another seat's hand is a plain face-down card, not a squeeze", async () => {
  const { store, send } = sharedTableStore({ player_squeezer: 5, banker_squeezer: 3 });
  render(<GameTable store={store} onLeave={() => {}} />);
  const player = screen.getByLabelText("Player hand");
  const banker = screen.getByLabelText("Banker hand");
  // my Banker cards are squeezable; seat 5's Player cards are not
  expect(banker.querySelectorAll('[role="button"]').length).toBe(2);
  expect(player.querySelectorAll('[role="button"]').length).toBe(0);
  expect(player.querySelectorAll('[aria-label="face-down card"]').length).toBe(2);
  // clicking their card sends nothing to the server
  await userEvent.click(player.querySelectorAll('[aria-label="face-down card"]')[0]);
  expect(send).not.toHaveBeenCalledWith(expect.objectContaining({ type: "peek", hand: "Player" }));
});

test("at a shared table, a house-held hand is the dealer's — no gesture for anyone", () => {
  const { store } = sharedTableStore({ player_squeezer: null, banker_squeezer: 3 });
  render(<GameTable store={store} onLeave={() => {}} />);
  expect(screen.getByLabelText("Player hand").querySelectorAll('[role="button"]').length).toBe(0);
  expect(screen.getByLabelText("Banker hand").querySelectorAll('[role="button"]').length).toBe(2);
});
