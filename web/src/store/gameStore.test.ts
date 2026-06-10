import { createGameStore } from "./gameStore";
import type { GameSession, CommandResult } from "../engine/adapter";
import type { RoundSnapshot, CommandError } from "../engine/types";
import { rackTotal } from "../chips";

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

/** rack + change + hand + felt must always equal the engine bankroll. */
function chipsTotal(store: ReturnType<typeof createGameStore>): number {
  const s = store.getState();
  return (
    rackTotal(s.rack) +
    s.change +
    s.hand.reduce((a, b) => a + b, 0) +
    s.stagedChips.flat().reduce((a, b) => a + b, 0)
  );
}

test("buys in the full bankroll as chips on creation", () => {
  const store = createGameStore(fakeSession({ ok: true, snapshot: snapshotWith() }));
  expect(chipsTotal(store)).toBe(1_000_000);
  expect(store.getState().hand).toEqual([]);
  expect(store.getState().lastError).toBeNull();
});

test("pickChip moves a chip from the rack to the hand; returnHand puts it back", () => {
  const store = createGameStore(fakeSession({ ok: true, snapshot: snapshotWith() }));
  const before = store.getState().rack[2500];
  store.getState().pickChip(2500);
  store.getState().pickChip(2500);
  store.getState().pickChip(100000);
  expect(store.getState().hand).toEqual([2500, 2500, 100000]);
  expect(store.getState().rack[2500]).toBe(before - 2);
  expect(chipsTotal(store)).toBe(1_000_000);
  store.getState().returnHand();
  expect(store.getState().hand).toEqual([]);
  expect(store.getState().rack[2500]).toBe(before);
});

test("pickChip refuses a denomination you have none of", () => {
  const store = createGameStore(fakeSession({ ok: true, snapshot: snapshotWith() }));
  const state = store.getState();
  const rack = { ...state.rack, 100000: 0 };
  store.setState({ rack });
  store.getState().pickChip(100000);
  expect(store.getState().hand).toEqual([]);
});

test("placeHand stakes the whole hand as one bet", () => {
  const placeBet = vi.fn(
    (): CommandResult => ({ ok: true, snapshot: snapshotWith() }),
  );
  const session = { ...fakeSession({ ok: true, snapshot: snapshotWith() }), placeBet };
  const store = createGameStore(session);
  store.getState().pickChip(10000);
  store.getState().pickChip(2500);
  store.getState().placeHand({ Main: "Player" });
  expect(placeBet).toHaveBeenCalledWith({ Main: "Player" }, 12500);
  expect(store.getState().hand).toEqual([]);
  expect(store.getState().stagedChips).toEqual([[10000, 2500]]);
  expect(chipsTotal(store)).toBe(1_000_000);
});

test("a rejected placeHand keeps the chips in hand", () => {
  const err: CommandError = { BetAboveMaximum: { max: 5000, got: 12500 } };
  const store = createGameStore(fakeSession({ ok: false, error: err }));
  store.getState().pickChip(10000);
  store.getState().pickChip(2500);
  store.getState().placeHand({ Main: "Player" });
  expect(store.getState().hand).toEqual([10000, 2500]);
  expect(store.getState().stagedChips).toEqual([]);
  expect(store.getState().lastError).toEqual(err);
});

test("placeChip stakes a single chip straight from the rack (drag-and-drop)", () => {
  const store = createGameStore(fakeSession({ ok: true, snapshot: snapshotWith() }));
  const before = store.getState().rack[50000];
  store.getState().placeChip({ Main: "Banker" }, 50000);
  expect(store.getState().rack[50000]).toBe(before - 1);
  expect(store.getState().stagedChips).toEqual([[50000]]);
  expect(chipsTotal(store)).toBe(1_000_000);
});

test("a dragged chip brings the picked-up hand along (the whole $300 rides)", () => {
  const placeBet = vi.fn(
    (): CommandResult => ({ ok: true, snapshot: snapshotWith() }),
  );
  const session = { ...fakeSession({ ok: true, snapshot: snapshotWith() }), placeBet };
  const store = createGameStore(session);
  store.getState().pickChip(10000);
  store.getState().pickChip(10000);
  store.getState().placeChip({ Main: "Player" }, 10000); // drag a third $100 on top
  expect(placeBet).toHaveBeenCalledWith({ Main: "Player" }, 30000);
  expect(store.getState().hand).toEqual([]);
  expect(store.getState().stagedChips).toEqual([[10000, 10000, 10000]]);
  expect(chipsTotal(store)).toBe(1_000_000);
});

test("clearBets returns every staged chip to the rack", () => {
  const store = createGameStore(fakeSession({ ok: true, snapshot: snapshotWith() }));
  store.getState().placeChip({ Main: "Player" }, 10000);
  store.getState().placeChip({ Main: "Tie" }, 2500);
  store.getState().clearBets();
  expect(store.getState().stagedChips).toEqual([]);
  expect(chipsTotal(store)).toBe(1_000_000);
});

test("a win returns the stake and pays winnings in chips", () => {
  const won = snapshotWith({
    phase: "Settled",
    bankroll: 1_002_500,
    payouts: [{ bet: { kind: { Main: "Player" }, amount: 2500 }, net: 2500 }],
  });
  const session: GameSession = {
    ...fakeSession({ ok: true, snapshot: snapshotWith() }),
    settle: () => ({ ok: true, snapshot: won }),
  };
  const store = createGameStore(session);
  store.getState().placeChip({ Main: "Player" }, 2500);
  store.getState().settle();
  expect(chipsTotal(store)).toBe(1_002_500);
  expect(store.getState().lastDelta).toBe(2500);
  expect(store.getState().settleSeq).toBe(1);
});

test("a commission win pays odd cents into change", () => {
  const won = snapshotWith({
    phase: "Settled",
    bankroll: 1_002_375,
    payouts: [{ bet: { kind: { Main: "Banker" }, amount: 2500 }, net: 2375 }],
  });
  const session: GameSession = {
    ...fakeSession({ ok: true, snapshot: snapshotWith() }),
    settle: () => ({ ok: true, snapshot: won }),
  };
  const store = createGameStore(session);
  store.getState().placeChip({ Main: "Banker" }, 2500);
  store.getState().settle();
  expect(chipsTotal(store)).toBe(1_002_375);
  expect(store.getState().change).toBe(75);
});

test("a loss sweeps the staged chips", () => {
  const lost = snapshotWith({
    phase: "Settled",
    bankroll: 997_500,
    payouts: [{ bet: { kind: { Main: "Player" }, amount: 2500 }, net: -2500 }],
  });
  const session: GameSession = {
    ...fakeSession({ ok: true, snapshot: snapshotWith() }),
    settle: () => ({ ok: true, snapshot: lost }),
  };
  const store = createGameStore(session);
  store.getState().placeChip({ Main: "Player" }, 2500);
  store.getState().settle();
  expect(chipsTotal(store)).toBe(997_500);
  expect(store.getState().lastDelta).toBe(-2500);
});

test("a failed settle leaves the chips and counters untouched", () => {
  const err: CommandError = { WrongPhase: { expected: "Dealing", found: "Settled" } };
  const store = createGameStore(fakeSession({ ok: false, error: err }));
  store.getState().settle();
  expect(store.getState().lastDelta).toBeNull();
  expect(store.getState().settleSeq).toBe(0);
  expect(chipsTotal(store)).toBe(1_000_000);
});

test("exchange: break and color up preserve the total", () => {
  const store = createGameStore(fakeSession({ ok: true, snapshot: snapshotWith() }));
  const hundreds = store.getState().rack[10000];
  store.getState().exchangeBreak(10000);
  expect(store.getState().rack[10000]).toBe(hundreds - 1);
  expect(chipsTotal(store)).toBe(1_000_000);
  store.getState().exchangeColorUp(10000);
  expect(store.getState().rack[10000]).toBe(hundreds);
  expect(chipsTotal(store)).toBe(1_000_000);
});

test("deal returns any chips still in hand to the rack", () => {
  const store = createGameStore(fakeSession({ ok: true, snapshot: snapshotWith() }));
  store.getState().pickChip(2500);
  store.getState().deal();
  expect(store.getState().hand).toEqual([]);
  expect(chipsTotal(store)).toBe(1_000_000);
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

test("touching chips after a settled round opens the next hand (no dead rack)", () => {
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
  store.getState().placeChip({ Main: "Player" }, 2500);
  store.getState().settle();
  expect(store.getState().snapshot.phase).toBe("Settled");
  // the bug: chips looked dead here until "Next hand" was pressed
  store.getState().pickChip(500);
  expect(store.getState().snapshot.phase).toBe("Betting");
  expect(store.getState().hand).toEqual([500]);
});

test("explain mode is off by default and toggles", () => {
  const store = createGameStore(fakeSession({ ok: true, snapshot: snapshotWith() }));
  expect(store.getState().explainOn).toBe(false);
  store.getState().toggleExplain();
  expect(store.getState().explainOn).toBe(true);
  store.getState().toggleExplain();
  expect(store.getState().explainOn).toBe(false);
});
