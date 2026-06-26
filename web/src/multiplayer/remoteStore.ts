// The multiplayer table store: the same GameState shape the components
// already render, but commands go over the socket and snapshots arrive as
// pushes. Money is the engine bankroll the server reports; this store just
// mirrors each push and notes the round's delta for the win popup.

import { createStore, type StoreApi } from "zustand/vanilla";
import type { RoundSnapshot } from "../engine/types";
import type { GameState } from "../store/gameStore";
import { tableSpec, type TableTier } from "../tables";
import { lastFlipBetween } from "../cards";
import type { ClientMsg, ServerMsg, TableViewMsg } from "./protocol";

export interface RemoteStore extends StoreApi<GameState> {
  /** Route a server push into the store. */
  handle: (msg: ServerMsg) => void;
}

function stripView(view: TableViewMsg): RoundSnapshot {
  const { seats: _s, player_squeezer: _p, banker_squeezer: _b, ...snapshot } = view;
  return snapshot;
}

function squeezersOf(view: TableViewMsg): { player: number | null; banker: number | null } {
  return { player: view.player_squeezer, banker: view.banker_squeezer };
}

export function createRemoteStore(opts: {
  tier: TableTier;
  view: TableViewMsg;
  send: (msg: ClientMsg) => void;
}): RemoteStore {
  const { tier, send } = opts;
  const denoms = tableSpec(tier).denoms;

  const initialSnapshot = stripView(opts.view);

  const store = createStore<GameState>((set, get) => ({
    snapshot: initialSnapshot,
    lastError: null,
    seats: opts.view.seats,
    squeezers: squeezersOf(opts.view),
    lastFlip: null,
    announcement: null,
    sitOut: () => send({ type: "sit_out" }),
    lastDelta: null,
    settleSeq: 0,
    explainOn: false,
    goal: null,
    goalReached: false,
    dismissGoal: () => set({ goalReached: false }),
    // the server has no re-buy concept; remote play never busts locally
    busted: false,
    denoms,
    selectedChip: denoms[0],

    toggleExplain: () => set({ explainOn: !get().explainOn }),

    selectChip: (denom) => set({ selectedChip: denom }),

    stake: (kind, denom) => {
      if (get().snapshot.phase === "Settled") get().newHand();
      const amount = denom ?? get().selectedChip;
      const staked = get().snapshot.bets.reduce((a, b) => a + b.amount, 0);
      if (amount <= 0 || amount > get().snapshot.bankroll - staked) return;
      send({ type: "bet", kind, amount });
    },

    clearBets: () => send({ type: "clear_bets" }),
    deal: () => send({ type: "deal" }),
    peek: (side, index) => send({ type: "peek", hand: side, index }),
    reveal: (side, index) => send({ type: "reveal", hand: side, index }),
    settle: () => send({ type: "settle" }),

    // Cosmetic: flip the local view back to Betting with a swept table; the
    // server's table is already open for the next coup's bets.
    newHand: () =>
      set({
        snapshot: {
          ...get().snapshot,
          phase: "Betting",
          payouts: null,
          outcome: null,
          events: [],
          player: { cards: [], total: null },
          banker: { cards: [], total: null },
        },
        lastDelta: null,
        lastFlip: null,
      }),

    newShoe: () => send({ type: "new_shoe" }),
  }));

  const handle = (msg: ServerMsg) => {
    const set = store.setState.bind(store);
    const get = store.getState.bind(store);

    if (msg.type === "announce") {
      set({ announcement: msg.message });
      return;
    }
    if (msg.type === "error") {
      set({ lastError: { Message: msg.message } });
      return;
    }
    if (msg.type !== "state" && msg.type !== "joined") return;

    const view = msg.view;
    const prev = get().snapshot;
    const next = stripView(view);

    // A settle push (Dealing→Settled) carries the round's bankroll change.
    let { lastDelta, settleSeq } = get();
    if (next.phase === "Settled" && prev.phase !== "Settled") {
      lastDelta = next.bankroll - prev.bankroll;
      settleSeq += 1;
    }

    const flip = lastFlipBetween(prev, next);
    set({
      snapshot: next,
      seats: view.seats,
      squeezers: squeezersOf(view),
      ...(flip ? { lastFlip: flip } : next.phase === "Betting" ? { lastFlip: null } : {}),
      lastDelta,
      settleSeq,
      lastError: null,
      announcement: null,
    });
  };

  return Object.assign(store, { handle });
}
