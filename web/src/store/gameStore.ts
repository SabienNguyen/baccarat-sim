import { createStore, type StoreApi } from "zustand/vanilla";
import type { RoundSnapshot, BetKind, CommandError, Side } from "../engine/types";
import type { SeatView } from "../multiplayer/protocol";
import { lastFlipBetween, type Flip } from "../cards";

/** What the dealer can refuse with: an engine error or server speech. */
export type DealerError = CommandError | { Message: string };
import type { GameSession, CommandResult } from "../engine/adapter";
import { CHIP_DENOMINATIONS } from "../chips";

export { CHIP_DENOMINATIONS };

/** Matches the server's beat between house-dealer card turns. */
const DEALER_FLIP_MS = 1100;

/**
 * Squeeze rights riding along on a table snapshot (single-player tables run
 * the same rules engine as multiplayer). Plain sessions have no such fields.
 */
function squeezersOf(snapshot: RoundSnapshot): GameState["squeezers"] {
  const v = snapshot as RoundSnapshot & {
    player_squeezer?: number | null;
    banker_squeezer?: number | null;
  };
  if (v.player_squeezer === undefined && v.banker_squeezer === undefined) return null;
  return { player: v.player_squeezer ?? null, banker: v.banker_squeezer ?? null };
}


export interface GameState {
  snapshot: RoundSnapshot;
  lastError: DealerError | null;
  /** Everyone at the table (multiplayer); null at a single-player table. */
  seats: SeatView[] | null;
  /** Who holds each hand's cards (multiplayer squeeze rights). */
  squeezers: { player: number | null; banker: number | null } | null;
  /** Skip this coup (multiplayer); no-op alone at a single-player table. */
  sitOut: () => void;
  /** The card that just turned, for the dealer's call. */
  lastFlip: Flip | null;
  /** The dealer's between-flips voice (multiplayer pacing). */
  announcement: string | null;
  /** Bankroll change across the last settle, in cents; null until/after a settle. */
  lastDelta: number | null;
  /** Increments on each settle so the win pop-up can remount via React key. */
  settleSeq: number;
  /** Whether explain-the-rule mode is showing. UI-only. */
  explainOn: boolean;
  /** Beat-the-table target (cents); null when the table has none. */
  goal: number | null;
  /** True right after the bankroll crosses the goal — drives the celebration. */
  goalReached: boolean;
  dismissGoal: () => void;
  /** True when a settle left the roll below the table minimum — the run is lost. */
  busted: boolean;

  /** The chip denominations this table stocks. */
  denoms: number[];
  /** The armed chip denomination (cents) — tap a spot to stake it. */
  selectedChip: number;

  toggleExplain: () => void;
  /** Arm a denomination to bet. */
  selectChip: (denom: number) => void;
  /** Stake a chip on a spot: the armed one, or `denom` (drag-and-drop). */
  stake: (kind: BetKind, denom?: number) => void;
  clearBets: () => void;
  deal: () => void;
  peek: (side: Side, index: number) => void;
  reveal: (side: Side, index: number) => void;
  settle: () => void;
  /** Start the next hand from the same shoe after a settled round. */
  newHand: () => void;
  newShoe: () => void;
}

export function createGameStore(
  session: GameSession,
  denoms: number[] = CHIP_DENOMINATIONS,
  goal: number | null = null,
  explainByDefault = false,
): StoreApi<GameState> {
  return createStore<GameState>((set, get) => {
    const apply = (result: CommandResult) => {
      if (result.ok) {
        const flip = lastFlipBetween(get().snapshot, result.snapshot);
        set({
          snapshot: result.snapshot,
          lastError: null,
          squeezers: squeezersOf(result.snapshot),
          ...(flip ? { lastFlip: flip } : {}),
        });
        pace();
      } else {
        set({ lastError: result.error });
      }
    };

    // The house dealer's hands: when a side has no bettor the engine leaves
    // its cards to the dealer, and this pacer turns them one per beat with an
    // announcement — the same rhythm the multiplayer server uses.
    let pacing = false;
    let announcedFor: Side | null = null;
    const pace = () => {
      if (pacing) return;
      if (!session.dealerFlipPending?.()) {
        announcedFor = null;
        return;
      }
      pacing = true;
      const side = session.dealerNextSide?.() ?? null;
      if (side !== null && side !== announcedFor) {
        announcedFor = side;
        set({ announcement: `Turning the ${side} hand…` });
      }
      setTimeout(() => {
        pacing = false;
        set({ announcement: null });
        if (!session.dealerFlipPending?.() || !session.dealerFlipOne) return;
        apply(session.dealerFlipOne());
      }, DEALER_FLIP_MS);
    };

    return {
      snapshot: session.snapshot(),
      lastError: null,
      seats: null,
      squeezers: null,
      sitOut: () => {},
      lastFlip: null,
      announcement: null,
      lastDelta: null,
      settleSeq: 0,
      explainOn: explainByDefault,
      goal,
      goalReached: false,
      dismissGoal: () => set({ goalReached: false }),
      busted: false,
      denoms,
      selectedChip: denoms[0],

      toggleExplain: () => set({ explainOn: !get().explainOn }),

      selectChip: (denom) => set({ selectedChip: denom }),

      stake: (kind, denom) => {
        // Touching the felt after a settled round opens the next hand.
        if (get().snapshot.phase === "Settled") get().newHand();
        const amount = denom ?? get().selectedChip;
        const bankroll = session.snapshot().bankroll;
        const staked = get().snapshot.bets.reduce((a, b) => a + b.amount, 0);
        if (amount <= 0 || amount > bankroll - staked) return; // can't afford it
        apply(session.placeBet(kind, amount));
      },

      clearBets: () => apply(session.clearBets()),

      deal: () => {
        set({ lastDelta: null, lastFlip: null });
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
            // celebrate the moment the roll crosses the table's goal
            goalReached:
              goal !== null && before < goal && result.snapshot.bankroll >= goal
                ? true
                : get().goalReached,
            // the run dies when the roll can no longer post the minimum
            busted: result.snapshot.bankroll < result.snapshot.table_min,
          });
        }
        apply(result);
      },

      // After a settled round the engine is already back in Betting, but a
      // table view keeps showing Settled (payouts on the felt) until the next
      // wager. Sweep the felt locally — same shoe, no reshuffle.
      newHand: () =>
        set({
          snapshot: {
            ...session.snapshot(),
            phase: "Betting",
            payouts: null,
            outcome: null,
            events: [],
            player: { cards: [], total: null },
            banker: { cards: [], total: null },
          },
          lastError: null,
          lastDelta: null,
          lastFlip: null,
        }),

      newShoe: () => apply(session.newShoe()),
    };
  });
}
