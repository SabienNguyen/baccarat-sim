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
  /** Hands on the plate, ties included. */
  games: number;
}

export function boardTally(scoreboard: ScoreboardSnapshot): BoardTally {
  const t: BoardTally = { banker: 0, player: 0, tie: 0, bankerPair: 0, playerPair: 0, games: 0 };
  for (const cell of scoreboard.bead_plate.cells) {
    t.games += 1;
    if (cell.outcome === "BankerWin") t.banker += 1;
    else if (cell.outcome === "PlayerWin") t.player += 1;
    else t.tie += 1;
    if (cell.banker_pair) t.bankerPair += 1;
    if (cell.player_pair) t.playerPair += 1;
  }
  return t;
}
