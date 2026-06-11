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

test("chips coming back off the felt or out of the hand clatter", () => {
  // returnHand: hand empties, nothing staged
  expect(soundsFor(state({ hand: [100, 500] }), state({ hand: [] }))).toEqual(["chipReturn"]);
  // clearBets: the felt empties outside a settle
  expect(soundsFor(state({ stagedChips: [[100]] }), state({ stagedChips: [] }))).toEqual([
    "chipReturn",
  ]);
});

test("staking the hand is a place, not a return", () => {
  const held = state({ hand: [100] });
  const staked = state({ hand: [], stagedChips: [[100]] });
  expect(soundsFor(held, staked)).toEqual(["chipPlace"]);
});

test("the settle sweep is not a chip return", () => {
  const before = state({ stagedChips: [[100]] });
  const after = state({ stagedChips: [], settleSeq: 1, lastDelta: -100 });
  expect(soundsFor(before, after)).toEqual(["lose"]);
});

test("a dealer refusal buzzes, once per refusal", () => {
  const calm = state();
  const refused = state({ lastError: "NoBetsPlaced" });
  expect(soundsFor(calm, refused)).toEqual(["error"]);
  expect(soundsFor(refused, state({ lastError: refused.lastError }))).toEqual([]);
});
