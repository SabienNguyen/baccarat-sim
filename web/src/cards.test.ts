import { isFaceUp, hiddenIndices } from "./cards";
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
