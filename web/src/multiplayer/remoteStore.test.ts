import { createRemoteStore } from "./remoteStore";
import type { ClientMsg, TableViewMsg } from "./protocol";

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

function setup() {
  const sent: ClientMsg[] = [];
  const store = createRemoteStore({
    tier: "mid",
    view: view(),
    send: (m) => sent.push(m),
  });
  return { store, sent };
}

test("mirrors the joined view: bankroll, seats, smallest chip armed, no win-con", () => {
  const { store } = setup();
  expect(store.getState().snapshot.bankroll).toBe(1_000_000);
  expect(store.getState().seats).toHaveLength(1);
  expect(store.getState().selectedChip).toBe(store.getState().denoms[0]); // smallest denom armed
  expect(store.getState().goal).toBeNull();
});

test("staking the armed chip sends a bet over the wire", () => {
  const { store, sent } = setup();
  store.getState().selectChip(10000);
  store.getState().stake({ Main: "Player" });
  expect(sent).toEqual([{ type: "bet", kind: { Main: "Player" }, amount: 10000 }]);
});

test("a dragged denomination overrides the armed chip", () => {
  const { store, sent } = setup();
  store.getState().stake({ Main: "Banker" }, 50000);
  expect(sent).toEqual([{ type: "bet", kind: { Main: "Banker" }, amount: 50000 }]);
});

test("stake refuses a chip the balance can't cover", () => {
  const { store, sent } = setup();
  // already fully staked per the snapshot → nothing free to bet
  store.handle({ type: "state", view: view({ bets: [{ kind: { Main: "Player" }, amount: 1_000_000 }] }) });
  store.getState().stake({ Main: "Tie" }, 50000);
  expect(sent).toEqual([]);
});

test("an error push surfaces the dealer's words", () => {
  const { store } = setup();
  store.handle({ type: "error", message: "Too rich for this table." });
  expect(store.getState().lastError).toEqual({ Message: "Too rich for this table." });
});

test("a settle push records the round's delta and fires the win pop-up", () => {
  const { store } = setup();
  store.handle({ type: "state", view: view({ phase: "Dealing", bets: [{ kind: { Main: "Player" }, amount: 10000 }] }) });
  store.handle({
    type: "state",
    view: view({
      phase: "Settled",
      bankroll: 1_010_000,
      payouts: [{ bet: { kind: { Main: "Player" }, amount: 10000 }, net: 10000 }],
      seats: [{ id: 0, name: "me", bankroll: 1_010_000, staked: 0, sitting_out: false, decided: false }],
    }),
  });
  expect(store.getState().snapshot.bankroll).toBe(1_010_000);
  expect(store.getState().lastDelta).toBe(10000);
  expect(store.getState().settleSeq).toBe(1);
});

test("a re-broadcast of the still-Settled view does not re-fire the win pop-up", () => {
  const { store } = setup();
  store.handle({ type: "state", view: view({ phase: "Dealing", bets: [{ kind: { Main: "Player" }, amount: 10000 }] }) });
  const settled = view({
    phase: "Settled",
    bankroll: 1_010_000,
    payouts: [{ bet: { kind: { Main: "Player" }, amount: 10000 }, net: 10000 }],
  });
  store.handle({ type: "state", view: settled });
  expect(store.getState().settleSeq).toBe(1);

  // Player taps a spot to bet the next coup: the store sweeps the felt to
  // Betting locally, ahead of the server (which still shows Settled).
  store.getState().newHand();
  expect(store.getState().snapshot.phase).toBe("Betting");

  // Another seat acts during the inter-coup window → the server re-broadcasts
  // the SAME settled view. This must NOT count as a fresh settle: no seq bump,
  // no $0 "push" popup/sound.
  store.handle({ type: "state", view: settled });
  expect(store.getState().settleSeq).toBe(1);
});

test("other players' actions arrive as seat updates", () => {
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
});

test("sitting out sends the choice", () => {
  const { store, sent } = setup();
  store.getState().sitOut();
  expect(sent.at(-1)).toEqual({ type: "sit_out" });
});

test("the dealer's announcement speaks until the next push arrives", () => {
  const { store } = setup();
  store.handle({ type: "announce", message: "Turning the Banker hand…" });
  expect(store.getState().announcement).toBe("Turning the Banker hand…");
  store.handle({ type: "state", view: view() });
  expect(store.getState().announcement).toBeNull();
});
