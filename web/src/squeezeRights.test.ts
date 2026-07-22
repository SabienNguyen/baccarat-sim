import { canSqueeze } from "./squeezeRights";

const sq = (player: number | null, banker: number | null) => ({ player, banker });

test("single-player: you may squeeze only the hand you hold (local id 0)", () => {
  expect(canSqueeze("Player", null, sq(0, null))).toBe(true);
  expect(canSqueeze("Banker", null, sq(0, null))).toBe(false); // the dealer's hand
  expect(canSqueeze("Banker", null, sq(null, 0))).toBe(true);
  expect(canSqueeze("Player", null, sq(null, 0))).toBe(false);
});

test("single-player: a hand nobody bet belongs to the dealer's pacer, not you", () => {
  expect(canSqueeze("Player", null, sq(null, null))).toBe(false);
  expect(canSqueeze("Banker", null, sq(null, null))).toBe(false);
});

test("single-player: bet both sides → both hands are yours to squeeze", () => {
  expect(canSqueeze("Player", null, sq(0, 0))).toBe(true);
  expect(canSqueeze("Banker", null, sq(0, 0))).toBe(true);
});

test("multiplayer: stay interactive — the server enforces squeeze rights", () => {
  expect(canSqueeze("Player", [], sq(null, null))).toBe(true);
  expect(canSqueeze("Banker", [{}, {}], sq(5, 5))).toBe(true);
});

test("no squeeze info (a plain session) stays interactive", () => {
  expect(canSqueeze("Player", null, null)).toBe(true);
});
