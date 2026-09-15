// The multiplayer table store: the same GameState shape the components
// already render, but commands go over the socket and snapshots arrive as
// pushes. Money is the engine bankroll the server reports; this store just
// mirrors each push and notes the round's delta for the win popup.

import { createStore, type StoreApi } from "zustand/vanilla";
import type { RoundSnapshot } from "../engine/types";
import type { GameState } from "../store/gameStore";
import { tableSpec, defaultChip, type TableTier } from "../tables";
import { lastFlipBetween } from "../cards";
import { trackFirstHand } from "../analytics";
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
  /** This client's own seat id, so pushes can be read from its point of view;
   *  null at the rail, where the view is the public one and nothing is ours. */
  me: number | null;
  /** Spectators at the rail, if the server said. */
  watchers?: number;
  send: (msg: ClientMsg) => void;
}): RemoteStore {
  const { tier, send, me } = opts;
  const denoms = tableSpec(tier).denoms;

  const initialSnapshot = stripView(opts.view);

  const store = createStore<GameState>((set, get) => ({
    snapshot: initialSnapshot,
    lastError: null,
    seats: opts.view.seats,
    me,
    spectating: me === null,
    watchers: opts.watchers ?? null,
    // The server scrubs and caps the name; the client only refuses to send
    // an empty one so a slip of the finger can't turn a seat into "guest".
    rename: (name) => {
      const n = name.trim();
      if (n.length === 0) return;
      send({ type: "rename", name: n });
    },
    squeezers: squeezersOf(opts.view),
    lastFlip: null,
    announcement: null,
    // Between coups the felt may still show our last result; acting on the
    // next coup sweeps it, the same way staking a chip does (see `stake`).
    sitOut: () => {
      if (get().snapshot.phase === "Settled") get().newHand();
      send({ type: "sit_out" });
    },
    ready: () => send({ type: "ready" }),
    unready: () => send({ type: "unready" }),
    myReady: opts.view.seats.find((s) => s.id === me)?.ready ?? false,
    lastDelta: null,
    settleSeq: 0,
    explainOn: false,
    goal: null,
    goalReached: false,
    dismissGoal: () => set({ goalReached: false }),
    // Set from the seat view below: a player whose bankroll can't cover the
    // table minimum is out of chips, and the table now deals past them rather
    // than waiting (F6). The UI uses this to offer a rebuy or a way out.
    busted: false,
    denoms,
    // smallest chip that clears the table minimum — the rack's top-up chip below it would be refused (F18)
    selectedChip: defaultChip(denoms, tableSpec(tier).table_min),

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
    deal: () => {
      trackFirstHand();
      send({ type: "deal" });
    },
    peek: (side, index) => send({ type: "peek", hand: side, index }),
    reveal: (side, index) => send({ type: "reveal", hand: side, index }),
    // Server-authoritative: it checks the squeeze, turns the house card(s)
    // and pushes the new view to every seat, with the dealer's line.
    requestDealerFlip: (count) => send({ type: "dealer_flip", count }),
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
          explain: [],
          player: { cards: [], total: null },
          banker: { cards: [], total: null },
        },
        lastDelta: null,
        lastFlip: null,
      }),

    cutShoe: (position) => send({ type: "cut_shoe", position }),
    requestNewShoe: () => {
      if (get().snapshot.phase === "Settled") get().newHand();
      send({ type: "propose_new_shoe" });
    },
    voteNewShoe: (yes) => send({ type: "vote_new_shoe", yes }),

    // Watching without betting is `sit_out` at a live table; the deal fires
    // once every seat has decided.
    watchHand: () => send({ type: "sit_out" }),

    // A seat's bankroll is the server's to change, and multiplayer bust/rebuy
    // handling isn't built yet (backlog F6/F7) — `busted` is hardcoded false
    // here, so this is never reached. No-op rather than faking money locally.
    rebuy: () => {},
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
    if (msg.type !== "state" && msg.type !== "joined" && msg.type !== "watching") return;

    const view = msg.view;
    const prev = get().snapshot;
    const next = stripView(view);

    // A settle push carries the round's bankroll change. Fire only on the
    // genuine Dealing→Settled edge: after a settle the local `newHand()` sweeps
    // our phase to Betting while the server view stays Settled until the next
    // deal, so any other seat's action re-broadcasts that Settled view. Keying
    // off `prev !== "Settled"` would re-fire the pop-up (with a bogus $0 "push")
    // on every such re-broadcast; a real settle only ever follows Dealing.
    // The rail has no money in the coup, so no popup and no settle sound
    // either — the flips and the dealer's call are the show.
    let { lastDelta, settleSeq } = get();
    if (next.phase === "Settled" && prev.phase === "Dealing" && !get().spectating) {
      lastDelta = next.bankroll - prev.bankroll;
      settleSeq += 1;
    }

    const flip = lastFlipBetween(prev, next);
    const mySeat = view.seats.find((s) => s.id === me);
    set({
      snapshot: next,
      seats: view.seats,
      // `joined` carries no count; the broadcast right behind it does
      watchers: msg.type === "joined" ? get().watchers : (msg.watchers ?? get().watchers),
      busted: mySeat?.broke ?? false,
      myReady: mySeat?.ready ?? false,
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
