import { createStore, type StoreApi } from "zustand/vanilla";
import type { RoundSnapshot, BetKind, CommandError, Side } from "../engine/types";
import type { GameSession, CommandResult } from "../engine/adapter";
import {
  CHIP_DENOMINATIONS,
  type Rack,
  buyIn,
  toChips,
  addChips,
  removeChips,
  breakChip,
  colorUp,
  mintChange,
} from "../chips";

export { CHIP_DENOMINATIONS };

export interface GameState {
  snapshot: RoundSnapshot;
  lastError: CommandError | null;
  /** Bankroll change across the last settle, in cents; null until/after a settle. */
  lastDelta: number | null;
  /** Increments on each settle so the win pop-up can remount via React key. */
  settleSeq: number;
  /** Whether explain-the-rule mode is showing. UI-only. */
  explainOn: boolean;

  /** Your chips, by denomination. rack + change + hand + staged === bankroll. */
  rack: Rack;
  /** Loose cents that don't make a whole chip yet (commission change). */
  change: number;
  /** Chips currently picked up, ready to drop on a spot. */
  hand: number[];
  /** The chips sitting on the felt, parallel to snapshot.bets. */
  stagedChips: number[][];

  toggleExplain: () => void;
  /** Pick one chip of `denom` up from the rack into your hand. */
  pickChip: (denom: number) => void;
  /** Put everything in your hand back in the rack. */
  returnHand: () => void;
  /** Drop the whole hand on a spot as a single bet. */
  placeHand: (kind: BetKind) => void;
  /** Place one chip on a spot (drag-and-drop path). */
  placeChip: (kind: BetKind, denom: number) => void;
  /** Ask the dealer to break one chip into smaller ones. */
  exchangeBreak: (denom: number) => void;
  /** Ask the dealer to color up smaller chips into this denomination. */
  exchangeColorUp: (denom: number) => void;
  clearBets: () => void;
  deal: () => void;
  peek: (side: Side, index: number) => void;
  reveal: (side: Side, index: number) => void;
  settle: () => void;
  /** Start the next hand from the same shoe after a settled round. */
  newHand: () => void;
  newShoe: () => void;
}

export function createGameStore(session: GameSession): StoreApi<GameState> {
  return createStore<GameState>((set, get) => {
    const apply = (result: CommandResult) => {
      if (result.ok) set({ snapshot: result.snapshot, lastError: null });
      else set({ lastError: result.error });
    };

    const initial = buyIn(session.snapshot().bankroll);

    return {
      snapshot: session.snapshot(),
      lastError: null,
      lastDelta: null,
      settleSeq: 0,
      explainOn: false,
      rack: initial.rack,
      change: initial.change,
      hand: [],
      stagedChips: [],

      toggleExplain: () => set({ explainOn: !get().explainOn }),

      pickChip: (denom) => {
        const taken = removeChips(get().rack, [denom]);
        if (taken === null) return;
        set({ rack: taken, hand: [...get().hand, denom] });
      },

      returnHand: () => {
        const { rack, hand } = get();
        if (hand.length === 0) return;
        set({ rack: addChips(rack, hand), hand: [] });
      },

      placeHand: (kind) => {
        const hand = get().hand;
        if (hand.length === 0) return;
        const amount = hand.reduce((a, b) => a + b, 0);
        const result = session.placeBet(kind, amount);
        if (result.ok) {
          set({ stagedChips: [...get().stagedChips, hand], hand: [] });
        }
        apply(result);
      },

      placeChip: (kind, denom) => {
        const taken = removeChips(get().rack, [denom]);
        if (taken === null) return;
        // A dragged chip brings the picked-up hand along with it, so "grab a
        // stack, drag one on top" stakes everything you're holding.
        const hand = get().hand;
        const chips = [...hand, denom];
        const amount = chips.reduce((a, b) => a + b, 0);
        const result = session.placeBet(kind, amount);
        if (result.ok) {
          set({
            rack: taken,
            hand: [],
            stagedChips: [...get().stagedChips, chips],
          });
        }
        apply(result);
      },

      exchangeBreak: (denom) => {
        const next = breakChip(get().rack, denom);
        if (next !== null) set({ rack: next });
      },

      exchangeColorUp: (denom) => {
        const next = colorUp(get().rack, denom);
        if (next !== null) set({ rack: next });
      },

      clearBets: () => {
        const result = session.clearBets();
        if (result.ok) {
          const returned = get().stagedChips.flat();
          set({
            rack: addChips(get().rack, returned),
            stagedChips: [],
            lastDelta: null,
          });
        }
        apply(result);
      },

      deal: () => {
        // Chips can't stay in your hand once the cards come out.
        get().returnHand();
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
          // Resolve the felt like a dealer: losses are swept, pushes and wins
          // come back, winnings are paid in chips largest-first.
          const staged = get().stagedChips;
          const payouts = result.snapshot.payouts ?? [];
          let rack = get().rack;
          let change = get().change;
          payouts.forEach((p, i) => {
            const chips = staged[i] ?? toChips(p.bet.amount).chips;
            if (p.net >= 0) {
              rack = addChips(rack, chips);
              if (p.net > 0) {
                const paid = toChips(p.net);
                rack = addChips(rack, paid.chips);
                change += paid.remainder;
              }
            }
            // net < 0: the dealer sweeps those chips.
          });
          const minted = mintChange(change);
          rack = addChips(rack, minted.chips);
          set({
            rack,
            change: minted.change,
            stagedChips: [],
            lastDelta: result.snapshot.bankroll - before,
            settleSeq: get().settleSeq + 1,
          });
        }
        apply(result);
      },

      // After a settled round the engine is already back in Betting; refresh the
      // snapshot to a clean Betting view so the player can bet and deal the next
      // hand from the SAME shoe (no reshuffle).
      newHand: () => set({ snapshot: session.snapshot(), lastError: null, lastDelta: null }),

      newShoe: () => {
        get().returnHand();
        apply(session.newShoe());
      },
    };
  });
}
