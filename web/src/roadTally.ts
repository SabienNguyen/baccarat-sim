// Running counts read off the bead plate: the pit-display footer under the
// Big Road and the tally card on the full board both quote these, so there is
// one implementation and Scoreboard computes it once per snapshot.

import type { ScoreboardSnapshot } from "./engine/types";

export interface BoardTally {
  banker: number;
  player: number;
  tie: number;
  bankerPair: number;
  playerPair: number;
  /** Win cells whose two-card total was a natural 8 or 9 (Big Road only —
   *  the bead plate has no natural flag, so a natural on a tie isn't counted
   *  here). */
  natural: number;
  /** Hands on the plate, ties included. */
  games: number;
  /** The shoe this board belongs to — 0 until the first cut. */
  shoe: number;
}

export function boardTally(scoreboard: ScoreboardSnapshot, shoeNumber = 0): BoardTally {
  const t: BoardTally = {
    banker: 0,
    player: 0,
    tie: 0,
    bankerPair: 0,
    playerPair: 0,
    natural: 0,
    games: 0,
    shoe: shoeNumber,
  };
  for (const cell of scoreboard.bead_plate.cells) {
    t.games += 1;
    if (cell.outcome === "BankerWin") t.banker += 1;
    else if (cell.outcome === "PlayerWin") t.player += 1;
    else t.tie += 1;
    if (cell.banker_pair) t.bankerPair += 1;
    if (cell.player_pair) t.playerPair += 1;
  }
  for (const column of scoreboard.big_road.columns) {
    for (const cell of column) {
      if (cell.natural) t.natural += 1;
    }
  }
  return t;
}
