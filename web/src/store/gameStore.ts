import { createStore, type StoreApi } from "zustand/vanilla";
import type { RoundSnapshot, BetKind, CommandError, Side } from "../engine/types";
import type { GameSession, CommandResult } from "../engine/adapter";

/** Chip denominations in cents: $25 / $100 / $500 / $1,000. */
export const CHIP_DENOMINATIONS = [2500, 10000, 50000, 100000];

export interface GameState {
  snapshot: RoundSnapshot;
  selectedChip: number;
  lastError: CommandError | null;
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
      setSelectedChip: (cents) => set({ selectedChip: cents }),
      placeSelectedBet: (kind) => apply(session.placeBet(kind, get().selectedChip)),
      clearBets: () => apply(session.clearBets()),
      deal: () => apply(session.deal()),
      peek: (side, index) => apply(session.peek(side, index)),
      reveal: (side, index) => apply(session.reveal(side, index)),
      settle: () => apply(session.settle()),
      newShoe: () => apply(session.newShoe()),
    };
  });
}
