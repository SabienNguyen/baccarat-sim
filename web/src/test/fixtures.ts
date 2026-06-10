import type { RoundSnapshot } from "../engine/types";

export function bettingSnapshot(overrides: Partial<RoundSnapshot> = {}): RoundSnapshot {
  return {
    phase: "Betting",
    player: { cards: [], total: null },
    banker: { cards: [], total: null },
    bets: [],
    bankroll: 100000,
    table_min: 100,
    table_max: 10000,
    outcome: null,
    payouts: null,
    events: [],
    scoreboard: {
      bead_plate: { cells: [] },
      big_road: { columns: [] },
      big_eye_boy: { columns: [] },
      small_road: { columns: [] },
      cockroach_pig: { columns: [] },
    },
    explain: [],
    ...overrides,
  };
}

/** A Dealing snapshot: player has a face-up 9 + a peeked card; banker face-down. */
export function dealingSnapshot(): RoundSnapshot {
  return bettingSnapshot({
    phase: "Dealing",
    player: {
      cards: [
        { FaceUp: { rank: "Nine", suit: "Hearts" } },
        { Peeked: { sliver: { suit: "Spades", rank: "Nine" } } },
      ],
      total: null,
    },
    banker: { cards: ["FaceDown", "FaceDown"], total: null },
    bets: [{ kind: { Main: "Player" }, amount: 500 }],
  });
}

/** A Settled snapshot: player 9 beats banker 5, with a winning Player payout. */
export function settledSnapshot(): RoundSnapshot {
  return bettingSnapshot({
    phase: "Settled",
    player: {
      cards: [
        { FaceUp: { rank: "Four", suit: "Clubs" } },
        { FaceUp: { rank: "Five", suit: "Diamonds" } },
      ],
      total: 9,
    },
    banker: {
      cards: [
        { FaceUp: { rank: "Two", suit: "Spades" } },
        { FaceUp: { rank: "Three", suit: "Hearts" } },
      ],
      total: 5,
    },
    bets: [{ kind: { Main: "Player" }, amount: 500 }],
    outcome: "PlayerWin",
    payouts: [{ bet: { kind: { Main: "Player" }, amount: 500 }, net: 500 }],
    bankroll: 100500,
  });
}

/** A snapshot whose scoreboard has a few rounds of history. */
export function scoredSnapshot(): RoundSnapshot {
  return bettingSnapshot({
    scoreboard: {
      bead_plate: {
        cells: [
          { outcome: "PlayerWin", player_pair: false, banker_pair: false },
          { outcome: "BankerWin", player_pair: false, banker_pair: false },
          { outcome: "Tie", player_pair: false, banker_pair: false },
        ],
      },
      big_road: {
        columns: [
          [{ side: "Player", ties: 0, player_pair: false, banker_pair: false }],
          [{ side: "Banker", ties: 1, player_pair: false, banker_pair: false }],
        ],
      },
      big_eye_boy: { columns: [["Red", "Blue"]] },
      small_road: { columns: [["Blue"]] },
      cockroach_pig: { columns: [["Red"]] },
    },
  });
}
