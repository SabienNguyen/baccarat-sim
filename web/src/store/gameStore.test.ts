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
