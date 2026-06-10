// The multiplayer table store: the same GameState shape the components
// already render, but commands go over the socket and snapshots arrive as
// pushes. The chip rack stays a client-side view of YOUR money; it
// reconciles against every push and re-racks itself if it ever drifts.

import { createStore, type StoreApi } from "zustand/vanilla";
import type { RoundSnapshot } from "../engine/types";
import type { GameState } from "../store/gameStore";
import {
  addChips,
  breakChip,
  acquire,
  buyIn,
  colorUp,
  mintChange,
  rackTotal,
  removeChips,
  toChips,
} from "../chips";
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

  // Chips we've wagered but the server hasn't confirmed yet, in send order.
  let pending: number[][] = [];

  const initialSnapshot = stripView(opts.view);
  const staked = initialSnapshot.bets.reduce((s, b) => s + b.amount, 0);
  const initial = buyIn(initialSnapshot.bankroll - staked, denoms);

  const store = createStore<GameState>((set, get) => ({
    snapshot: initialSnapshot,
    lastError: null,
    seats: opts.view.seats,
    squeezers: squeezersOf(opts.view),
    lastFlip: null,
    announcement: null,
    sitOut: () => {
      get().returnHand();
      send({ type: "sit_out" });
    },
    lastDelta: null,
    settleSeq: 0,
    explainOn: false,
    goal: null,
    goalReached: false,
    dismissGoal: () => set({ goalReached: false }),
    // the server has no re-buy concept; remote play never busts locally
    busted: false,
    denoms,
    rack: initial.rack,
    change: initial.change,
    hand: [],
    stagedChips: initialSnapshot.bets.map((b) => toChips(b.amount, denoms).chips),

    toggleExplain: () => set({ explainOn: !get().explainOn }),

    pickChip: (denom) => {
      if (get().snapshot.phase === "Settled") get().newHand();
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
      if (get().snapshot.phase === "Settled") get().newHand();
      const hand = get().hand;
      if (hand.length === 0) return;
      const amount = hand.reduce((a, b) => a + b, 0);
      pending.push(hand);
      set({ hand: [] });
      send({ type: "bet", kind, amount });
    },

    placeChip: (kind, denom) => {
      if (get().snapshot.phase === "Settled") get().newHand();
      const taken = removeChips(get().rack, [denom]);
      if (taken === null) return;
      const chips = [...get().hand, denom];
      const amount = chips.reduce((a, b) => a + b, 0);
      pending.push(chips);
      set({ rack: taken, hand: [] });
      send({ type: "bet", kind, amount });
    },

    exchangeBreak: (denom) => {
      const next = breakChip(get().rack, denom, denoms);
      if (next !== null) set({ rack: next });
    },

    exchangeColorUp: (denom) => {
      const next = colorUp(get().rack, denom, denoms);
      if (next !== null) set({ rack: next });
    },

    exchangeAcquire: (denom) => {
      const next = acquire(get().rack, denom, denoms);
      if (next !== null) set({ rack: next.rack, change: get().change + next.loose });
    },

    clearBets: () => send({ type: "clear_bets" }),
    deal: () => {
      get().returnHand();
      send({ type: "deal" });
    },
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
      // The wager came back: whatever was in flight returns to the rack.
      if (pending.length > 0) {
        set({ rack: addChips(get().rack, pending.flat()) });
        pending = [];
      }
      set({ lastError: { Message: msg.message } });
      return;
    }
    if (msg.type !== "state" && msg.type !== "joined") return;

    const view = msg.type === "state" ? msg.view : msg.view;
    const prev = get().snapshot;
    const next = stripView(view);
    let { rack, change, hand, stagedChips } = get();
    let { lastDelta, settleSeq } = get();

    // Our accepted bets: move pending chips onto the felt, oldest first.
    if (next.bets.length > prev.bets.length) {
      const grew = next.bets.length - prev.bets.length;
      for (let i = 0; i < grew; i++) {
        const chips = pending.shift() ?? toChips(next.bets[prev.bets.length + i].amount, denoms).chips;
        stagedChips = [...stagedChips, chips];
      }
    }

    // The felt cleared: either a settle (pay/sweep) or a clear (return).
    if (next.bets.length === 0 && prev.bets.length > 0) {
      if (next.phase === "Settled" && next.payouts) {
        next.payouts.forEach((p, i) => {
          const chips = stagedChips[i] ?? toChips(p.bet.amount, denoms).chips;
          if (p.net >= 0) {
            rack = addChips(rack, chips);
            if (p.net > 0) {
              const paid = toChips(p.net, denoms);
              rack = addChips(rack, paid.chips);
              change += paid.remainder;
            }
          }
        });
        const minted = mintChange(change, denoms);
        rack = addChips(rack, minted.chips);
        change = minted.change;
        lastDelta = next.bankroll - prev.bankroll;
        settleSeq += 1;
      } else {
        rack = addChips(rack, stagedChips.flat());
      }
      stagedChips = [];
    }

    // Cards came out: nothing stays in your hand at a live table.
    if (next.phase === "Dealing" && prev.phase !== "Dealing") {
      if (hand.length > 0) {
        rack = addChips(rack, hand);
        hand = [];
      }
    }

    // Drift guard: chips must always equal your bankroll. If anything ever
    // disagrees (missed push, reconnect), the cage re-racks you.
    const stakedNow = next.bets.reduce((s, b) => s + b.amount, 0);
    const held =
      rackTotal(rack) +
      change +
      hand.reduce((a, b) => a + b, 0) +
      pending.flat().reduce((a, b) => a + b, 0) +
      stagedChips.flat().reduce((a, b) => a + b, 0);
    if (held !== next.bankroll) {
      const fresh = buyIn(next.bankroll - stakedNow, denoms);
      rack = fresh.rack;
      change = fresh.change;
      hand = [];
      pending = [];
      stagedChips = next.bets.map((b) => toChips(b.amount, denoms).chips);
    }

    const flip = lastFlipBetween(prev, next);
    set({
      snapshot: next,
      seats: view.seats,
      squeezers: squeezersOf(view),
      ...(flip ? { lastFlip: flip } : next.phase === "Betting" ? { lastFlip: null } : {}),
      rack,
      change,
      hand,
      stagedChips,
      lastDelta,
      settleSeq,
      lastError: null,
      announcement: null,
    });
  };

  return Object.assign(store, { handle });
}
