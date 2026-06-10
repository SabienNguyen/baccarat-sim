import { visibleCardCount } from "./squeezeOrder";
import type { CardView } from "./engine/types";

const down: CardView = "FaceDown";
const up = (rank: string): CardView =>
  ({ FaceUp: { rank, suit: "Clubs" } }) as CardView;

test("two-card hands never hide a card", () => {
  const player = [up("Nine"), up("Two")];
  const banker = [up("Three"), down];
  expect(visibleCardCount("Player", player, banker)).toBe(2);
  expect(visibleCardCount("Banker", player, banker)).toBe(2);
});

test("a third card stays hidden until the four initial cards are face up", () => {
  // Player drew a third, but banker[1] is still down.
  const player = [up("Two"), up("Three"), up("King")];
  const banker = [up("Four"), down];
  expect(visibleCardCount("Player", player, banker)).toBe(2);
  expect(visibleCardCount("Banker", player, banker)).toBe(2);
});

test("after the initial four, the Player's third shows but the Banker's waits for it", () => {
  // All four initial up; both hands have a (still face-down) third.
  const player = [up("Two"), up("Three"), down];
  const banker = [up("Four"), up("Five"), down];
  expect(visibleCardCount("Player", player, banker)).toBe(3); // player's third leads
  expect(visibleCardCount("Banker", player, banker)).toBe(2); // banker waits on player's third
});

test("the Banker's third shows once the Player's third is face up", () => {
  const player = [up("Two"), up("Three"), up("King")];
  const banker = [up("Four"), up("Five"), down];
  expect(visibleCardCount("Banker", player, banker)).toBe(3);
});

test("when the Player stood (no third), the Banker's third shows after the initial four", () => {
  const player = [up("Two"), up("Three")]; // player stood on two cards
  const banker = [up("Four"), up("Five"), down];
  expect(visibleCardCount("Banker", player, banker)).toBe(3);
});
