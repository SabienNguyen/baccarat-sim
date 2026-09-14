// @vitest-environment node
// Full rounds against the real wasm engine, exercising the exact reported
// flow: chips staked during the Settled phase, with no manual "Next hand".

import { createGameStore } from "./gameStore";
import { createSession } from "../engine/adapter";

test("betting straight out of a settled round stays consistent for many rounds", () => {
  const session = createSession({
    starting_bankroll: 1_000_000,
    table_min: 100,
    table_max: 500_000,
    ruleset: "Commission",
    seed: 7,
  });
  const store = createGameStore(session);
  store.getState().cutShoe(500);
  store.getState().selectChip(10000);

  for (let round = 0; round < 30; round++) {
    // the reported flow: stake WITHOUT advancing the hand first
    store.getState().stake({ Main: "Player" });
    expect(store.getState().lastError).toBeNull();
    expect(store.getState().snapshot.phase).toBe("Betting");
    expect(store.getState().snapshot.bets).toHaveLength(1);

    store.getState().deal();
    expect(store.getState().lastError).toBeNull();
    // reveal everything, then settle
    for (const side of ["Player", "Banker"] as const) {
      const hand = side === "Player" ? store.getState().snapshot.player : store.getState().snapshot.banker;
      hand.cards.forEach((_, i) => store.getState().reveal(side, i));
    }
    store.getState().settle();
    expect(store.getState().lastError).toBeNull();
    expect(store.getState().snapshot.phase).toBe("Settled");
    // the roll stays a positive balance round after round
    expect(store.getState().snapshot.bankroll).toBeGreaterThan(0);
  }
});

test("the hand after a tie deals a full set of cards and settles like any other", () => {
  // Reported as "cards vanish after a tie". Play the real engine until a coup
  // ties, then play straight through it: the next deal must put four cards on
  // the felt and the round must run to Settled — no stuck phase, no empty hands.
  const session = createSession({
    starting_bankroll: 1_000_000,
    table_min: 100,
    table_max: 500_000,
    ruleset: "Commission",
    seed: 11,
  });
  const store = createGameStore(session);
  store.getState().cutShoe(500);
  store.getState().selectChip(10000);

  const playOne = () => {
    store.getState().stake({ Main: "Player" });
    store.getState().deal();
    expect(store.getState().lastError).toBeNull();
    expect(store.getState().snapshot.phase).toBe("Dealing");
    expect(store.getState().snapshot.player.cards.length).toBeGreaterThanOrEqual(2);
    expect(store.getState().snapshot.banker.cards.length).toBeGreaterThanOrEqual(2);
    for (const side of ["Player", "Banker"] as const) {
      const hand = side === "Player" ? store.getState().snapshot.player : store.getState().snapshot.banker;
      hand.cards.forEach((_, i) => store.getState().reveal(side, i));
    }
    store.getState().settle();
    expect(store.getState().lastError).toBeNull();
    expect(store.getState().snapshot.phase).toBe("Settled");
    return store.getState().snapshot.outcome;
  };

  let ties = 0;
  for (let round = 0; round < 200 && ties < 3; round++) {
    if (playOne() !== "Tie") continue;
    ties++;
    // a push: the roll is unchanged and the settled felt still shows the tie
    expect(store.getState().lastDelta).toBe(0);
    expect(store.getState().snapshot.player.cards.length).toBeGreaterThanOrEqual(2);
    // the very next hand, both ways a player opens it: re-bet straight away...
    expect(playOne()).not.toBeNull();
    // ...or sweep the felt first, then bet
    store.getState().newHand();
    expect(store.getState().snapshot.phase).toBe("Betting");
    expect(store.getState().snapshot.player.cards).toHaveLength(0);
    expect(playOne()).not.toBeNull();
  }
  expect(ties).toBe(3); // the seed must actually have produced ties to test
});
