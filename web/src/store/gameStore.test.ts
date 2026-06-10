import { createGameStore, CHIP_DENOMINATIONS } from "./gameStore";
import type { GameSession, CommandResult } from "../engine/adapter";
import type { RoundSnapshot, CommandError } from "../engine/types";

function snapshotWith(overrides: Partial<RoundSnapshot> = {}): RoundSnapshot {
  return {
    phase: "Betting",
    player: { cards: [], total: null },
    banker: { cards: [], total: null },
    bets: [],
    bankroll: 100000,
    table_min: 100,
    table_max: 10000,
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

test("starts from the session's initial snapshot and first chip", () => {
  const store = createGameStore(fakeSession({ ok: true, snapshot: snapshotWith() }));
  expect(store.getState().snapshot.phase).toBe("Betting");
  expect(store.getState().selectedChip).toBe(CHIP_DENOMINATIONS[0]);
  expect(store.getState().lastError).toBeNull();
});

test("a successful command replaces the snapshot and clears lastError", () => {
  const dealt = snapshotWith({ phase: "Dealing" });
  const store = createGameStore(fakeSession({ ok: true, snapshot: dealt }));
  store.getState().deal();
  expect(store.getState().snapshot.phase).toBe("Dealing");
  expect(store.getState().lastError).toBeNull();
});

test("a rejected command sets lastError and leaves the snapshot unchanged", () => {
  const error: CommandError = { WrongPhase: { expected: "Dealing", found: "Betting" } };
  const store = createGameStore(fakeSession({ ok: false, error }));
  const before = store.getState().snapshot;
  store.getState().settle();
  expect(store.getState().lastError).toEqual(error);
  expect(store.getState().snapshot).toBe(before);
});

test("setSelectedChip updates the active denomination", () => {
  const store = createGameStore(fakeSession({ ok: true, snapshot: snapshotWith() }));
  store.getState().setSelectedChip(50000);
  expect(store.getState().selectedChip).toBe(50000);
});

test("settle records the positive bankroll delta as lastDelta and bumps settleSeq", () => {
  const before = snapshotWith({ phase: "Dealing", bankroll: 100000 });
  const after = snapshotWith({ phase: "Settled", bankroll: 109500 });
  const store = createGameStore(fakeSession({ ok: true, snapshot: after }, before));
  expect(store.getState().lastDelta).toBeNull();
  expect(store.getState().settleSeq).toBe(0);
  store.getState().settle();
  expect(store.getState().lastDelta).toBe(9500);
  expect(store.getState().settleSeq).toBe(1);
});

test("settle records a negative delta on a loss", () => {
  const before = snapshotWith({ phase: "Dealing", bankroll: 100000 });
  const after = snapshotWith({ phase: "Settled", bankroll: 99500 });
  const store = createGameStore(fakeSession({ ok: true, snapshot: after }, before));
  store.getState().settle();
  expect(store.getState().lastDelta).toBe(-500);
});

test("deal and clearBets reset lastDelta to null", () => {
  const before = snapshotWith({ phase: "Dealing", bankroll: 100000 });
  const after = snapshotWith({ phase: "Settled", bankroll: 109500 });
  const store = createGameStore(fakeSession({ ok: true, snapshot: after }, before));
  store.getState().settle();
  expect(store.getState().lastDelta).toBe(9500);
  store.getState().deal();
  expect(store.getState().lastDelta).toBeNull();
  store.getState().settle();
  expect(store.getState().lastDelta).toBe(9500);
  store.getState().clearBets();
  expect(store.getState().lastDelta).toBeNull();
});

test("a failed settle leaves lastDelta untouched", () => {
  const before = snapshotWith({ phase: "Dealing", bankroll: 100000 });
  const err: CommandError = { WrongPhase: { expected: "Dealing", found: "Settled" } };
  const store = createGameStore(fakeSession({ ok: false, error: err }, before));
  store.getState().settle();
  expect(store.getState().lastDelta).toBeNull();
  expect(store.getState().settleSeq).toBe(0);
});

test("explain mode is off by default and toggles", () => {
  const store = createGameStore(fakeSession({ ok: true, snapshot: snapshotWith() }));
  expect(store.getState().explainOn).toBe(false);
  store.getState().toggleExplain();
  expect(store.getState().explainOn).toBe(true);
  store.getState().toggleExplain();
  expect(store.getState().explainOn).toBe(false);
});

test("newHand refreshes to the session's betting snapshot and clears the delta", () => {
  const betting = snapshotWith({ phase: "Betting", bankroll: 100000 });
  const settled = snapshotWith({ phase: "Settled", bankroll: 109500 });
  const store = createGameStore(fakeSession({ ok: true, snapshot: settled }, betting));
  store.getState().settle();
  expect(store.getState().snapshot.phase).toBe("Settled");
  expect(store.getState().lastDelta).toBe(9500);
  store.getState().newHand();
  expect(store.getState().snapshot.phase).toBe("Betting");
  expect(store.getState().lastDelta).toBeNull();
});

test("placeChip places the given amount on a spot", () => {
  const placed = snapshotWith({ bets: [{ kind: { Main: "Player" }, amount: 50000 }] });
  const placeBet = vi.fn(() => ({ ok: true, snapshot: placed }) as CommandResult);
  const session: GameSession = { ...fakeSession({ ok: true, snapshot: placed }), placeBet };
  const store = createGameStore(session);
  store.getState().placeChip({ Main: "Player" }, 50000);
  expect(placeBet).toHaveBeenCalledWith({ Main: "Player" }, 50000);
  expect(store.getState().snapshot.bets).toHaveLength(1);
});
