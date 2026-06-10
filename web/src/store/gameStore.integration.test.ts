// @vitest-environment node
// Full rounds against the real wasm engine, exercising the exact reported
// flow: chips placed during the Settled phase, before "Next hand".

import { createGameStore } from "./gameStore";
import { createSession } from "../engine/adapter";
import { rackTotal } from "../chips";

function held(store: ReturnType<typeof createGameStore>): number {
  const s = store.getState();
  return (
    rackTotal(s.rack) +
    s.change +
    s.hand.reduce((a, b) => a + b, 0) +
    s.stagedChips.flat().reduce((a, b) => a + b, 0)
  );
}

test("betting straight out of a settled round stays consistent for many rounds", () => {
  const session = createSession({
    starting_bankroll: 1_000_000,
    table_min: 100,
    table_max: 500_000,
    ruleset: "Commission",
    seed: 7,
  });
  const store = createGameStore(session);

  for (let round = 0; round < 30; round++) {
    const s = store.getState();
    // the reported flow: drop chips WITHOUT pressing Next hand first
    s.placeChip({ Main: "Player" }, 10000);
    expect(store.getState().lastError).toBeNull();
    expect(store.getState().snapshot.phase).toBe("Betting");
    expect(store.getState().snapshot.bets).toHaveLength(1);
    expect(store.getState().stagedChips).toHaveLength(1);

    store.getState().deal();
    expect(store.getState().lastError).toBeNull();
    // reveal everything, settle
    for (const side of ["Player", "Banker"] as const) {
      const hand = side === "Player" ? store.getState().snapshot.player : store.getState().snapshot.banker;
      hand.cards.forEach((_, i) => store.getState().reveal(side, i));
    }
    store.getState().settle();
    expect(store.getState().lastError).toBeNull();
    expect(store.getState().snapshot.phase).toBe("Settled");
    // chips must equal the bankroll after every settle
    expect(held(store)).toBe(store.getState().snapshot.bankroll);
  }
});
