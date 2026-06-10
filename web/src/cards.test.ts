import { isFaceUp, hiddenIndices, runningTotal } from "./cards";
import type { CardView } from "./engine/types";

const faceUp: CardView = { FaceUp: { rank: "Nine", suit: "Hearts" } };
const peeked: CardView = { Peeked: { sliver: { suit: "Spades", rank: "Nine" } } };

test("isFaceUp only for FaceUp cards", () => {
  expect(isFaceUp(faceUp)).toBe(true);
  expect(isFaceUp(peeked)).toBe(false);
  expect(isFaceUp("FaceDown")).toBe(false);
});

test("hiddenIndices returns indices of non-face-up cards", () => {
  expect(hiddenIndices([faceUp, peeked, "FaceDown"])).toEqual([1, 2]);
  expect(hiddenIndices([faceUp, faceUp])).toEqual([]);
});

test("runningTotal sums only face-up cards, mod 10", () => {
  const seven: CardView = { FaceUp: { rank: "Seven", suit: "Clubs" } };
  const king: CardView = { FaceUp: { rank: "King", suit: "Spades" } };
  expect(runningTotal([faceUp, seven])).toBe(6); // 9 + 7 = 16 -> 6
  expect(runningTotal([king, faceUp])).toBe(9); // monkey counts zero
  expect(runningTotal([faceUp, peeked, "FaceDown"])).toBe(9); // hidden cards excluded
});

test("runningTotal is null until a card shows", () => {
  expect(runningTotal(["FaceDown", "FaceDown"])).toBeNull();
  expect(runningTotal([peeked])).toBeNull(); // a peek isn't a reveal
  expect(runningTotal([])).toBeNull();
});
