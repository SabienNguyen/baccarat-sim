import { createRemoteStore } from "./remoteStore";
import type { ClientMsg, TableViewMsg } from "./protocol";
import { rackTotal } from "../chips";

function view(over: Partial<TableViewMsg> = {}): TableViewMsg {
  return {
    phase: "Betting",
    player: { cards: [], total: null },
    banker: { cards: [], total: null },
    bets: [],
    bankroll: 1_000_000,
    table_min: 2500,
    table_max: 500_000,
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
    seats: [{ id: 0, name: "me", bankroll: 1_000_000, staked: 0, sitting_out: false, decided: false }],
    player_squeezer: null,
    banker_squeezer: null,
    ...over,
  };
}

function held(store: ReturnType<typeof createRemoteStore>): number {
  const s = store.getState();
  return (
    rackTotal(s.rack) +
    s.change +
    s.hand.reduce((a, b) => a + b, 0) +
    s.stagedChips.flat().reduce((a, b) => a + b, 0)
  );
}

function setup() {
  const sent: ClientMsg[] = [];
  const store = createRemoteStore({
    tier: "mid",
    view: view(),
    send: (m) => sent.push(m),
  });
  return { store, sent };
}

test("buys in from the joined view and exposes the seats", () => {
  const { store } = setup();
  expect(held(store)).toBe(1_000_000);
  expect(store.getState().seats).toHaveLength(1);
  expect(store.getState().goal).toBeNull(); // no win-con at a live table
});

test("a bet goes over the wire and lands on the felt when the push confirms it", () => {
  const { store, sent } = setup();
  store.getState().pickChip(10000);
  store.getState().placeHand({ Main: "Player" });
  expect(sent).toEqual([{ type: "bet", kind: { Main: "Player" }, amount: 10000 }]);
  // not staged yet — in flight
  expect(store.getState().stagedChips).toEqual([]);

  store.handle({
    type: "state",
    view: view({ bets: [{ kind: { Main: "Player" }, amount: 10000 }] }),
  });
  expect(store.getState().stagedChips).toEqual([[10000]]);
  expect(held(store)).toBe(1_000_000);
});

test("a refused bet returns the chips and the dealer speaks", () => {
  const { store } = setup();
  store.getState().placeChip({ Main: "Player" }, 10000);
  store.handle({ type: "error", message: "Too rich for this table." });
  expect(held(store)).toBe(1_000_000);
  expect(store.getState().lastError).toEqual({ Message: "Too rich for this table." });
});

test("a settle push pays the rack and fires the win pop-up", () => {
  const { store } = setup();
  store.getState().placeChip({ Main: "Player" }, 10000);
  store.handle({
    type: "state",
    view: view({ bets: [{ kind: { Main: "Player" }, amount: 10000 }] }),
  });
  store.handle({
    type: "state",
    view: view({
      phase: "Settled",
      bankroll: 1_010_000,
      payouts: [{ bet: { kind: { Main: "Player" }, amount: 10000 }, net: 10000 }],
      seats: [{ id: 0, name: "me", bankroll: 1_010_000, staked: 0, sitting_out: false, decided: false }],
    }),
  });
  expect(held(store)).toBe(1_010_000);
  expect(store.getState().lastDelta).toBe(10000);
  expect(store.getState().settleSeq).toBe(1);
});

test("the drift guard re-racks if the client ever disagrees with the server", () => {
  const { store } = setup();
  // server says we suddenly have a different bankroll (e.g. missed pushes)
  store.handle({
    type: "state",
    view: view({ bankroll: 750_000, seats: [{ id: 0, name: "me", bankroll: 750_000, staked: 0, sitting_out: false, decided: false }] }),
  });
  expect(held(store)).toBe(750_000);
});

test("other players' actions arrive as seat updates without touching my chips", () => {
  const { store } = setup();
  store.handle({
    type: "state",
    view: view({
      seats: [
        { id: 0, name: "me", bankroll: 1_000_000, staked: 0, sitting_out: false, decided: false },
        { id: 1, name: "friend", bankroll: 1_000_000, staked: 50_000, sitting_out: false, decided: true },
      ],
    }),
  });
  expect(store.getState().seats).toHaveLength(2);
  expect(held(store)).toBe(1_000_000);
});

test("sitting out sends the choice and returns any held chips", () => {
  const { store, sent } = setup();
  store.getState().pickChip(10000);
  store.getState().sitOut();
  expect(store.getState().hand).toEqual([]);
  expect(held(store)).toBe(1_000_000);
  expect(sent.at(-1)).toEqual({ type: "sit_out" });
});
