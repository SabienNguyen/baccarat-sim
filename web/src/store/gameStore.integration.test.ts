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
