import { bonusWouldWin } from "./bonusNudge";
import type { RoundSnapshot, CardView } from "./engine/types";

const up = (rank: string, suit = "Hearts"): CardView =>
  ({ FaceUp: { rank, suit } }) as CardView;

function settled(over: Partial<RoundSnapshot>): RoundSnapshot {
  return {
    phase: "Settled",
    player: { cards: [], total: null },
    banker: { cards: [], total: null },
    bets: [],
    bankroll: 100000,
    table_min: 100,
    table_max: 100000,
    outcome: "PlayerWin",
    payouts: [],
    events: [],
    scoreboard: {
      bead_plate: { cells: [] },
      big_road: { columns: [] },
      big_eye_boy: { columns: [] },
      small_road: { columns: [] },
      cockroach_pig: { columns: [] },
    },
    explain: [],
    ...over,
  };
}

test("a player pair would win", () => {
  const s = settled({
    player: { cards: [up("Nine", "Hearts"), up("Nine", "Spades")], total: 8 },
    banker: { cards: [up("Two"), up("Three")], total: 5 },
    outcome: "PlayerWin",
  });
  expect(bonusWouldWin(s, [])).toMatchObject({ kind: { Side: "PlayerPair" }, payout: "11:1" });
});

test("a banker pair would win", () => {
  const s = settled({
    banker: { cards: [up("King"), up("King")], total: 0 },
    player: { cards: [up("Two"), up("Three")], total: 5 },
    outcome: "BankerWin",
  });
  expect(bonusWouldWin(s, [])?.kind).toEqual({ Side: "BankerPair" });
});

test("panda 8: player wins with a three-card total of 8", () => {
  const s = settled({
    player: { cards: [up("Two"), up("Three"), up("Three")], total: 8 },
    banker: { cards: [up("Five"), up("Ace")], total: 6 },
    outcome: "PlayerWin",
  });
  expect(bonusWouldWin(s, [])?.kind).toEqual({ Side: "Panda8" });
});

test("dragon 7: banker wins with a three-card total of 7", () => {
  const s = settled({
    banker: { cards: [up("Two"), up("Two"), up("Three")], total: 7 },
    player: { cards: [up("Five"), up("Ace")], total: 6 },
    outcome: "BankerWin",
  });
  expect(bonusWouldWin(s, [])?.kind).toEqual({ Side: "Dragon7" });
});

test("tiger: banker wins on a total of 6", () => {
  const s = settled({
    banker: { cards: [up("Two"), up("Four")], total: 6 },
    player: { cards: [up("Two"), up("Three")], total: 5 },
    outcome: "BankerWin",
  });
  expect(bonusWouldWin(s, [])?.kind).toEqual({ Side: "Tiger" });
});

test("when several bonuses hit, the highest-paying one is nudged", () => {
  // banker wins on 6 with a pair: Tiger (up to 20:1) outranks the 11:1 pair
  const s = settled({
    banker: { cards: [up("Three"), up("Three")], total: 6 },
    player: { cards: [up("Two"), up("Five")], total: 7 },
    outcome: "BankerWin",
  });
  expect(bonusWouldWin(s, [])?.kind).toEqual({ Side: "Tiger" });
});

test("a bonus the player already staked is not nudged", () => {
  const s = settled({
    player: { cards: [up("Nine"), up("Nine")], total: 8 },
    banker: { cards: [up("Two"), up("Three")], total: 5 },
    outcome: "PlayerWin",
    bets: [{ kind: { Side: "PlayerPair" }, amount: 500 }],
  });
  expect(bonusWouldWin(s, [{ Side: "PlayerPair" }])).toBeNull();
});

test("a plain hand nudges nothing", () => {
  const s = settled({
    player: { cards: [up("Nine"), up("Two")], total: 1 },
    banker: { cards: [up("Five"), up("Three")], total: 8 },
    outcome: "BankerWin",
  });
  expect(bonusWouldWin(s, [])).toBeNull();
});

test("only fires on a resolved hand", () => {
  expect(bonusWouldWin(settled({ outcome: null }), [])).toBeNull();
});
