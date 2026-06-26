import { createGameStore, type GameState } from "../store/gameStore";
import { soundsFor } from "./useGameSounds";
import type { GameSession, CommandResult } from "../engine/adapter";
import { bettingSnapshot } from "../test/fixtures";

function okSession(): GameSession {
  const snap = bettingSnapshot();
  const ok: CommandResult = { ok: true, snapshot: snap };
  return {
    snapshot: () => snap,
    placeBet: () => ok,
    clearBets: () => ok,
    deal: () => ok,
    peek: () => ok,
    reveal: () => ok,
    settle: () => ok,
    newShoe: () => ok,
  };
}

function state(over: Partial<GameState> = {}): GameState {
  return { ...createGameStore(okSession()).getState(), ...over };
}

function withBets(amount: number, over: Partial<GameState> = {}): GameState {
  const base = state(over);
  return { ...base, snapshot: { ...base.snapshot, bets: [{ kind: { Main: "Player" }, amount }] } };
}

test("arming a chip clicks; staking one drops it on the felt", () => {
  const before = state();
  expect(soundsFor(before, state({ selectedChip: 2500 }))).toEqual(["chipPick"]);
  expect(soundsFor(before, withBets(200))).toEqual(["chipPlace"]);
});

test("the deal swishes and a flip snaps", () => {
  const betting = state();
  const dealing = state({ snapshot: { ...betting.snapshot, phase: "Dealing" } });
  expect(soundsFor(betting, dealing)).toEqual(["deal"]);
  const flipped = state({
    snapshot: dealing.snapshot,
    lastFlip: { side: "Player", card: { rank: "Nine", suit: "Hearts" } },
  });
  expect(soundsFor(dealing, flipped)).toEqual(["flip"]);
});

test("settles ring by outcome: win, lose, push", () => {
  const before = state();
  expect(soundsFor(before, state({ settleSeq: 1, lastDelta: 500 }))).toEqual(["win"]);
  expect(soundsFor(before, state({ settleSeq: 1, lastDelta: -500 }))).toEqual(["lose"]);
  expect(soundsFor(before, state({ settleSeq: 1, lastDelta: 0 }))).toEqual(["push"]);
});

test("victory and bust replace the plain settle sound", () => {
  const before = state();
  expect(
    soundsFor(before, state({ settleSeq: 1, lastDelta: 9000, goalReached: true })),
  ).toEqual(["victory"]);
  expect(
    soundsFor(before, state({ settleSeq: 1, lastDelta: -9000, busted: true })),
  ).toEqual(["bust"]);
});

test("an unchanged state is silent", () => {
  const s = state();
  expect(soundsFor(s, s)).toEqual([]);
});

test("bending a card up rustles", () => {
  const down = state({
    snapshot: {
      ...bettingSnapshot(),
      phase: "Dealing",
      player: { cards: ["FaceDown", "FaceDown"], total: null },
      banker: { cards: ["FaceDown", "FaceDown"], total: null },
    },
  });
  const peeked = state({
    snapshot: {
      ...down.snapshot,
      player: {
        cards: [{ Peeked: { sliver: { suit: "Spades", rank: "Nine" } } }, "FaceDown"],
        total: null,
      },
    },
  });
  expect(soundsFor(down, peeked)).toEqual(["squeeze"]);
  // holding the bend (no new peek) stays quiet
  expect(soundsFor(peeked, state({ snapshot: peeked.snapshot }))).toEqual([]);
});

test("clearing bets off the felt clatters", () => {
  // clearBets in Betting: the felt empties outside a settle
  expect(soundsFor(withBets(100), state())).toEqual(["chipReturn"]);
});

test("the settle sweep is not a chip return", () => {
  const before = withBets(100); // bets on the felt
  const after = state({ settleSeq: 1, lastDelta: -100 }); // swept and resolved
  expect(soundsFor(before, after)).toEqual(["lose"]);
});

test("a dealer refusal buzzes, once per refusal", () => {
  const calm = state();
  const refused = state({ lastError: "NoBetsPlaced" });
  expect(soundsFor(calm, refused)).toEqual(["error"]);
  expect(soundsFor(refused, state({ lastError: refused.lastError }))).toEqual([]);
});
