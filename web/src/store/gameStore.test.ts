import { createGameStore } from "./gameStore";
import type { GameSession, CommandResult } from "../engine/adapter";
import type { RoundSnapshot, CommandError } from "../engine/types";

function snapshotWith(overrides: Partial<RoundSnapshot> = {}): RoundSnapshot {
  return {
    phase: "Betting",
    player: { cards: [], total: null },
    banker: { cards: [], total: null },
    bets: [],
    bankroll: 1_000_000,
    table_min: 500,
    table_max: 5_000_000,
    outcome: null,
    payouts: null,
    events: [],
    scoreboard: {
      bead_plate: { cells: [] },
      big_road: { columns: [] },
      big_eye_boy: { columns: [] },
      small_road: { columns: [] },
      cockroach_pig: { columns: [] },
    },
    explain: [],
    ...overrides,
  };
}

function fakeSession(result: CommandResult, initial?: RoundSnapshot): GameSession {
  const snap = initial ?? snapshotWith();
  return {
    snapshot: () => snap,
    placeBet: () => result,
    clearBets: () => result,
    deal: () => result,
    peek: () => result,
    reveal: () => result,
    settle: () => result,
    newShoe: () => result,
  };
}

test("starts with the smallest denomination armed and no error", () => {
  const store = createGameStore(fakeSession({ ok: true, snapshot: snapshotWith() }));
  expect(store.getState().selectedChip).toBe(100);
  expect(store.getState().lastError).toBeNull();
});

test("selectChip arms a denomination", () => {
  const store = createGameStore(fakeSession({ ok: true, snapshot: snapshotWith() }));
  store.getState().selectChip(2500);
  expect(store.getState().selectedChip).toBe(2500);
});

test("stake places the armed chip via placeBet", () => {
  const placeBet = vi.fn((): CommandResult => ({ ok: true, snapshot: snapshotWith() }));
  const store = createGameStore({ ...fakeSession({ ok: true, snapshot: snapshotWith() }), placeBet });
  store.getState().selectChip(2500);
  store.getState().stake({ Main: "Player" });
  expect(placeBet).toHaveBeenCalledWith({ Main: "Player" }, 2500);
});

test("stake with an explicit denom (drag) ignores the armed chip", () => {
  const placeBet = vi.fn((): CommandResult => ({ ok: true, snapshot: snapshotWith() }));
  const store = createGameStore({ ...fakeSession({ ok: true, snapshot: snapshotWith() }), placeBet });
  store.getState().stake({ Main: "Banker" }, 50000);
  expect(placeBet).toHaveBeenCalledWith({ Main: "Banker" }, 50000);
});

test("stake refuses a chip the balance can't cover", () => {
  const placeBet = vi.fn((): CommandResult => ({ ok: true, snapshot: snapshotWith() }));
  // bankroll 1,000,000 already fully staked → nothing left to bet
  const staked = snapshotWith({ bets: [{ kind: { Main: "Player" }, amount: 1_000_000 }] });
  const store = createGameStore({ ...fakeSession({ ok: true, snapshot: staked }, staked), placeBet });
  store.getState().stake({ Main: "Tie" }, 100000);
  expect(placeBet).not.toHaveBeenCalled();
});

test("a rejected stake surfaces the dealer's error", () => {
  const err: CommandError = { BetAboveMaximum: { max: 5000, got: 100000 } };
  const store = createGameStore(fakeSession({ ok: false, error: err }));
  store.getState().selectChip(100000);
  store.getState().stake({ Main: "Player" });
  expect(store.getState().lastError).toEqual(err);
});

test("clearBets clears the felt via the session", () => {
  const clearBets = vi.fn((): CommandResult => ({ ok: true, snapshot: snapshotWith() }));
  const store = createGameStore({ ...fakeSession({ ok: true, snapshot: snapshotWith() }), clearBets });
  store.getState().clearBets();
  expect(clearBets).toHaveBeenCalledOnce();
});

test("a settle records the delta and bumps the popup sequence", () => {
  const won = snapshotWith({
    phase: "Settled",
    bankroll: 1_002_500,
    payouts: [{ bet: { kind: { Main: "Player" }, amount: 2500 }, net: 2500 }],
  });
  const store = createGameStore({
    ...fakeSession({ ok: true, snapshot: snapshotWith() }),
    settle: () => ({ ok: true, snapshot: won }),
  });
  store.getState().settle();
  expect(store.getState().lastDelta).toBe(2500);
  expect(store.getState().settleSeq).toBe(1);
});

test("a losing settle records a negative delta", () => {
  const lost = snapshotWith({
    phase: "Settled",
    bankroll: 997_500,
    payouts: [{ bet: { kind: { Main: "Player" }, amount: 2500 }, net: -2500 }],
  });
  const store = createGameStore({
    ...fakeSession({ ok: true, snapshot: snapshotWith() }),
    settle: () => ({ ok: true, snapshot: lost }),
  });
  store.getState().settle();
  expect(store.getState().lastDelta).toBe(-2500);
});

test("a failed settle leaves the counters untouched", () => {
  const err: CommandError = { WrongPhase: { expected: "Dealing", found: "Settled" } };
  const store = createGameStore(fakeSession({ ok: false, error: err }));
  store.getState().settle();
  expect(store.getState().lastDelta).toBeNull();
  expect(store.getState().settleSeq).toBe(0);
});

test("newHand refreshes to the session's betting snapshot and clears the delta", () => {
  const betting = snapshotWith({ phase: "Betting", bankroll: 1_000_000 });
  const settled = snapshotWith({
    phase: "Settled",
    bankroll: 1_002_500,
    payouts: [{ bet: { kind: { Main: "Player" }, amount: 2500 }, net: 2500 }],
  });
  const session: GameSession = {
    ...fakeSession({ ok: true, snapshot: settled }, betting),
    settle: () => ({ ok: true, snapshot: settled }),
  };
  const store = createGameStore(session);
  store.getState().settle();
  expect(store.getState().snapshot.phase).toBe("Settled");
  store.getState().newHand();
  expect(store.getState().snapshot.phase).toBe("Betting");
  expect(store.getState().lastDelta).toBeNull();
});

test("staking after a settled round opens the next hand", () => {
  const betting = snapshotWith({ phase: "Betting", bankroll: 1_000_000 });
  const settled = snapshotWith({
    phase: "Settled",
    bankroll: 997_500,
    payouts: [{ bet: { kind: { Main: "Player" }, amount: 2500 }, net: -2500 }],
  });
  const session: GameSession = {
    ...fakeSession({ ok: true, snapshot: betting }, betting),
    settle: () => ({ ok: true, snapshot: settled }),
  };
  const store = createGameStore(session);
  store.getState().settle();
  expect(store.getState().snapshot.phase).toBe("Settled");
  store.getState().stake({ Main: "Player" }, 500);
  expect(store.getState().snapshot.phase).toBe("Betting");
});

test("explain mode is off by default and toggles", () => {
  const store = createGameStore(fakeSession({ ok: true, snapshot: snapshotWith() }));
  expect(store.getState().explainOn).toBe(false);
  store.getState().toggleExplain();
  expect(store.getState().explainOn).toBe(true);
  store.getState().toggleExplain();
  expect(store.getState().explainOn).toBe(false);
});

test("starting a new hand clears the prior round's explain trace", () => {
  // After settle the engine view carries the round's trace (so it shows on the
  // settled felt); sweeping to a fresh hand must not leak it onto empty felt.
  const settled = snapshotWith({
    explain: ["Player has 5 — draws a third card (0): players draw on 0–5."],
  });
  const store = createGameStore(fakeSession({ ok: true, snapshot: settled }, settled));
  store.getState().newHand();
  expect(store.getState().snapshot.phase).toBe("Betting");
  expect(store.getState().snapshot.explain).toEqual([]);
});

test("a coaching table starts with explain mode already on", () => {
  const store = createGameStore(
    fakeSession({ ok: true, snapshot: snapshotWith() }),
    undefined,
    null,
    true,
  );
  expect(store.getState().explainOn).toBe(true);
  // still a toggle — the learner can dismiss the coaching
  store.getState().toggleExplain();
  expect(store.getState().explainOn).toBe(false);
});

test("crossing the table goal during a settle triggers the celebration once", () => {
  const before = snapshotWith({ phase: "Dealing", bankroll: 990_000 });
  const after = snapshotWith({
    phase: "Settled",
    bankroll: 1_010_000,
    payouts: [{ bet: { kind: { Main: "Player" }, amount: 20000 }, net: 20000 }],
  });
  const session: GameSession = {
    ...fakeSession({ ok: true, snapshot: after }, before),
    settle: () => ({ ok: true, snapshot: after }),
  };
  const store = createGameStore(session, undefined, 1_000_000);
  expect(store.getState().goalReached).toBe(false);
  store.getState().settle();
  expect(store.getState().goalReached).toBe(true);
  store.getState().dismissGoal();
  expect(store.getState().goalReached).toBe(false);
});

test("a settle that stays above (or below) the goal does not re-trigger", () => {
  const before = snapshotWith({ phase: "Dealing", bankroll: 1_010_000 });
  const after = snapshotWith({
    phase: "Settled",
    bankroll: 1_020_000,
    payouts: [{ bet: { kind: { Main: "Player" }, amount: 10000 }, net: 10000 }],
  });
  const session: GameSession = {
    ...fakeSession({ ok: true, snapshot: after }, before),
    settle: () => ({ ok: true, snapshot: after }),
  };
  const store = createGameStore(session, undefined, 1_000_000);
  store.getState().settle();
  expect(store.getState().goalReached).toBe(false); // started above; no crossing
});

test("a settle that leaves the roll under the table minimum busts the run", () => {
  // table_min is 500 in snapshotWith(); a settle down to 300 can't post it.
  const broke = snapshotWith({ phase: "Settled", bankroll: 300, payouts: [] });
  const store = createGameStore(fakeSession({ ok: true, snapshot: broke }));
  expect(store.getState().busted).toBe(false);
  store.getState().settle();
  expect(store.getState().busted).toBe(true);
});

test("watching a hand sits out and deals, with nothing staked", () => {
  const dealt = snapshotWith({ phase: "Dealing" });
  const sitOut = vi.fn(() => ({ ok: true as const, snapshot: snapshotWith() }));
  const deal = vi.fn(() => ({ ok: true as const, snapshot: dealt }));
  const store = createGameStore({ ...fakeSession({ ok: true, snapshot: dealt }), sitOut, deal });

  store.getState().watchHand();

  // skip the coup, then let the dealer run it — in that order
  expect(sitOut).toHaveBeenCalledOnce();
  expect(deal).toHaveBeenCalledOnce();
  expect(sitOut.mock.invocationCallOrder[0]).toBeLessThan(deal.mock.invocationCallOrder[0]);
  expect(store.getState().snapshot.phase).toBe("Dealing");
  expect(store.getState().snapshot.bets).toEqual([]);
});

test("a refused sit-out doesn't go on to deal", () => {
  const sitOut = vi.fn(() => ({ ok: false as const, error: "NoBetsPlaced" as const }));
  const deal = vi.fn(() => ({ ok: true as const, snapshot: snapshotWith() }));
  const store = createGameStore({
    ...fakeSession({ ok: true, snapshot: snapshotWith() }),
    sitOut,
    deal,
  });
  store.getState().watchHand();
  expect(deal).not.toHaveBeenCalled();
});

test("re-buying clears the bust and sweeps the felt without a new shoe", () => {
  const broke = snapshotWith({ phase: "Settled", bankroll: 300, payouts: [] });
  const toppedUp = snapshotWith({ phase: "Settled", bankroll: 50_300, payouts: [] });
  const rebuy = vi.fn(() => ({ ok: true as const, snapshot: toppedUp }));
  const newShoe = vi.fn(() => ({ ok: true as const, snapshot: broke }));
  const store = createGameStore({
    ...fakeSession({ ok: true, snapshot: broke }),
    newShoe,
    rebuy,
  });
  store.getState().settle();
  expect(store.getState().busted).toBe(true);

  store.getState().rebuy(50_000);
  expect(rebuy).toHaveBeenCalledWith(50_000);
  expect(store.getState().busted).toBe(false);
  expect(store.getState().snapshot.bankroll).toBe(50_300);
  // back to a clean betting felt...
  expect(store.getState().snapshot.phase).toBe("Betting");
  expect(store.getState().snapshot.payouts).toBeNull();
  // ...and emphatically NOT by reshuffling: handing over cash keeps the shoe.
  expect(newShoe).not.toHaveBeenCalled();
});

test("a settle that keeps the roll at or above the minimum does not bust", () => {
  const alive = snapshotWith({ phase: "Settled", bankroll: 500, payouts: [] });
  const store = createGameStore(fakeSession({ ok: true, snapshot: alive }));
  store.getState().settle();
  expect(store.getState().busted).toBe(false);
});
