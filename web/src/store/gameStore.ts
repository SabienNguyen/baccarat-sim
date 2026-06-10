import { createStore, type StoreApi } from "zustand/vanilla";
import type { RoundSnapshot, BetKind, CommandError, Side } from "../engine/types";
import type { GameSession, CommandResult } from "../engine/adapter";

/** Chip denominations in cents: $25 / $100 / $500 / $1,000. */
export const CHIP_DENOMINATIONS = [2500, 10000, 50000, 100000];

export interface GameState {
  snapshot: RoundSnapshot;
  selectedChip: number;
  lastError: CommandError | null;
  /** Bankroll change across the last settle, in cents; null until/after a settle. */
  lastDelta: number | null;
  /** Increments on each settle so the win pop-up can remount via React key. */
  settleSeq: number;
  setSelectedChip: (cents: number) => void;
  placeSelectedBet: (kind: BetKind) => void;
  clearBets: () => void;
  deal: () => void;
  peek: (side: Side, index: number) => void;
  reveal: (side: Side, index: number) => void;
  settle: () => void;
  newShoe: () => void;
}

export function createGameStore(session: GameSession): StoreApi<GameState> {
  return createStore<GameState>((set, get) => {
    const apply = (result: CommandResult) => {
      if (result.ok) set({ snapshot: result.snapshot, lastError: null });
      else set({ lastError: result.error });
    };
    return {
      snapshot: session.snapshot(),
      selectedChip: CHIP_DENOMINATIONS[0],
      lastError: null,
      lastDelta: null,
      settleSeq: 0,
      setSelectedChip: (cents) => set({ selectedChip: cents }),
      placeSelectedBet: (kind) => apply(session.placeBet(kind, get().selectedChip)),
      clearBets: () => {
        set({ lastDelta: null });
        apply(session.clearBets());
      },
      deal: () => {
        set({ lastDelta: null });
        apply(session.deal());
      },
      peek: (side, index) => apply(session.peek(side, index)),
      reveal: (side, index) => apply(session.reveal(side, index)),
      settle: () => {
        // Read the pre-settle bankroll straight from the session (the engine's
        // source of truth) rather than the store snapshot, so the delta is correct
        // even if the store snapshot lags. Do not switch to get().snapshot here.
        const before = session.snapshot().bankroll;
        const result = session.settle();
        if (result.ok) {
          set({
            lastDelta: result.snapshot.bankroll - before,
            settleSeq: get().settleSeq + 1,
          });
        }
        apply(result);
      },
      newShoe: () => apply(session.newShoe()),
    };
  });
}
