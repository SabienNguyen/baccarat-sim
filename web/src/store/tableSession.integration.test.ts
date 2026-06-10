// @vitest-environment node
// Single player runs the SAME table rules as multiplayer, one seat: you
// squeeze the sides you bet, and the house dealer turns the rest, one card
// per beat, with an announcement.

import { vi } from "vitest";
import { createGameStore } from "./gameStore";
import { createTableSession } from "../engine/adapter";
import { isFaceUp } from "../cards";
import type { CardView } from "../engine/types";

const CONFIG = {
  starting_bankroll: 1_000_000,
  table_min: 100,
  table_max: 500_000,
  ruleset: "Commission" as const,
  seed: 7,
};

function faceUpCount(cards: CardView[]): number {
  return cards.filter(isFaceUp).length;
}

afterEach(() => {
  vi.useRealTimers();
});

test("dealing without a bet gets the dealer's no-bets line, not table jargon", () => {
  const store = createGameStore(createTableSession(CONFIG));
  store.getState().deal();
  expect(store.getState().lastError).toBe("NoBetsPlaced");
});

test("bet Banker only: the dealer announces and turns the Player hand one card per beat", () => {
  vi.useFakeTimers();
  const store = createGameStore(createTableSession(CONFIG));
  store.getState().placeChip({ Main: "Banker" }, 10000);
  store.getState().deal();

  // I hold the Banker cards; the Player hand is the dealer's.
  expect(store.getState().squeezers).toEqual({ player: null, banker: 0 });
  expect(store.getState().announcement).toBe("Turning the Player hand…");
  expect(faceUpCount(store.getState().snapshot.player.cards)).toBe(0);

  // Stage order: my Banker cards stay down until the Player hand is exposed.
  store.getState().reveal("Banker", 0);
  expect(store.getState().lastError).toEqual({
    Message: "Order, order — Player hand first, then Banker.",
  });

  // One card per 1100ms beat, announcement clearing as each card turns.
  vi.advanceTimersByTime(1100);
  expect(faceUpCount(store.getState().snapshot.player.cards.slice(0, 2))).toBe(1);
  vi.advanceTimersByTime(1100);
  expect(faceUpCount(store.getState().snapshot.player.cards.slice(0, 2))).toBe(2);

  // Now the Banker hand is mine to squeeze.
  store.getState().reveal("Banker", 0);
  expect(store.getState().lastError).toBeNull();
  store.getState().reveal("Banker", 1);
  expect(store.getState().lastError).toBeNull();

  // Any third cards: the Player third is the dealer's, the Banker third mine.
  vi.advanceTimersByTime(1100 * 3);
  const snap = store.getState().snapshot;
  if (snap.banker.cards.length === 3 && !isFaceUp(snap.banker.cards[2])) {
    store.getState().reveal("Banker", 2);
  }
  vi.advanceTimersByTime(1100 * 3);

  const done = store.getState().snapshot;
  expect(faceUpCount(done.player.cards)).toBe(done.player.cards.length);
  expect(faceUpCount(done.banker.cards)).toBe(done.banker.cards.length);

  store.getState().settle();
  expect(store.getState().lastError).toBeNull();
  expect(store.getState().snapshot.phase).toBe("Settled");
});

test("bet Player only: I flip my hand first, then the dealer takes the Banker hand", () => {
  vi.useFakeTimers();
  const store = createGameStore(createTableSession(CONFIG));
  store.getState().placeChip({ Main: "Player" }, 10000);
  store.getState().deal();

  expect(store.getState().squeezers).toEqual({ player: 0, banker: null });
  // The dealer has nothing to turn until my hand is exposed.
  expect(store.getState().announcement).toBeNull();

  store.getState().reveal("Player", 0);
  store.getState().reveal("Player", 1);
  expect(store.getState().lastError).toBeNull();

  // Now the Banker hand is his, announced and paced.
  expect(store.getState().announcement).toBe("Turning the Banker hand…");
  vi.advanceTimersByTime(1100);
  expect(faceUpCount(store.getState().snapshot.banker.cards.slice(0, 2))).toBe(1);
  vi.advanceTimersByTime(1100);
  expect(faceUpCount(store.getState().snapshot.banker.cards.slice(0, 2))).toBe(2);
});

test("bet both sides: every card is mine, the dealer never steps in", () => {
  vi.useFakeTimers();
  const store = createGameStore(createTableSession(CONFIG));
  store.getState().placeChip({ Main: "Player" }, 10000);
  store.getState().placeChip({ Main: "Banker" }, 10000);
  store.getState().deal();

  expect(store.getState().squeezers).toEqual({ player: 0, banker: 0 });
  expect(store.getState().announcement).toBeNull();

  vi.advanceTimersByTime(1100 * 6);
  // Still face down — no house flips when both hands have a bettor.
  expect(faceUpCount(store.getState().snapshot.player.cards)).toBe(0);
  expect(faceUpCount(store.getState().snapshot.banker.cards)).toBe(0);
});

test("chips placed straight out of a settled table round stay consistent", () => {
  vi.useFakeTimers();
  const store = createGameStore(createTableSession(CONFIG));
  for (let round = 0; round < 10; round++) {
    store.getState().placeChip({ Main: "Player" }, 10000);
    expect(store.getState().lastError).toBeNull();
    store.getState().placeChip({ Main: "Banker" }, 10000);
    expect(store.getState().snapshot.phase).toBe("Betting");

    store.getState().deal();
    expect(store.getState().lastError).toBeNull();
    for (const side of ["Player", "Banker"] as const) {
      const hand =
        side === "Player"
          ? store.getState().snapshot.player
          : store.getState().snapshot.banker;
      hand.cards.forEach((_, i) => store.getState().reveal(side, i));
    }
    store.getState().settle();
    expect(store.getState().lastError).toBeNull();
    expect(store.getState().snapshot.phase).toBe("Settled");
  }
});
