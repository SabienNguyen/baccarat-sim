import { canSqueeze } from "./squeezeRights";

const sq = (player: number | null, banker: number | null) => ({ player, banker });

test("single-player: you may squeeze only the hand you hold (local id 0)", () => {
  expect(canSqueeze("Player", sq(0, null), 0)).toBe(true);
  expect(canSqueeze("Banker", sq(0, null), 0)).toBe(false); // the dealer's hand
  expect(canSqueeze("Banker", sq(null, 0), 0)).toBe(true);
  expect(canSqueeze("Player", sq(null, 0), 0)).toBe(false);
});

test("single-player: a hand nobody bet belongs to the dealer's pacer, not you", () => {
  expect(canSqueeze("Player", sq(null, null), 0)).toBe(false);
  expect(canSqueeze("Banker", sq(null, null), 0)).toBe(false);
});

test("single-player: bet both sides → both hands are yours to squeeze", () => {
  expect(canSqueeze("Player", sq(0, 0), 0)).toBe(true);
  expect(canSqueeze("Banker", sq(0, 0), 0)).toBe(true);
});

test("multiplayer: only the seat holding a hand gets the squeeze gesture", () => {
  // I'm seat 3; seat 5 holds Player, I hold Banker
  expect(canSqueeze("Player", sq(5, 3), 3)).toBe(false);
  expect(canSqueeze("Banker", sq(5, 3), 3)).toBe(true);
  // the other seat sees the mirror image
  expect(canSqueeze("Player", sq(5, 3), 5)).toBe(true);
  expect(canSqueeze("Banker", sq(5, 3), 5)).toBe(false);
});

test("multiplayer: a house-held hand is nobody's to grab — the dealer turns it", () => {
  expect(canSqueeze("Player", sq(null, 3), 3)).toBe(false);
  expect(canSqueeze("Banker", sq(null, null), 3)).toBe(false);
});

test("no squeeze info (a plain session) stays interactive", () => {
  expect(canSqueeze("Player", null, 0)).toBe(true);
  expect(canSqueeze("Banker", null, 7)).toBe(true);
});

test("at the rail nothing is yours to squeeze — unless the session has no rights at all", () => {
  expect(canSqueeze("Player", sq(5, 3), null)).toBe(false);
  expect(canSqueeze("Banker", sq(5, 3), null)).toBe(false);
  expect(canSqueeze("Player", sq(null, null), null)).toBe(false);
  expect(canSqueeze("Player", null, null)).toBe(true); // a plain session, as ever
});
