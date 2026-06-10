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

test("picking up and placing chips click", () => {
  const before = state();
  expect(soundsFor(before, state({ hand: [100] }))).toEqual(["chipPick"]);
  expect(soundsFor(before, state({ stagedChips: [[100, 100]] }))).toEqual(["chipPlace"]);
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
