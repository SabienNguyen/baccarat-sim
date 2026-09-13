import { expect, test } from "vitest";
import { boardTally } from "./roadTally";
import type { BeadCell, ScoreboardSnapshot } from "./engine/types";

const bead = (outcome: BeadCell["outcome"], pp = false, bp = false): BeadCell => ({
  outcome,
  player_pair: pp,
  banker_pair: bp,
});

const plate = (cells: BeadCell[]): ScoreboardSnapshot => ({
  bead_plate: { cells },
  big_road: { columns: [] },
  big_eye_boy: { columns: [] },
  small_road: { columns: [] },
  cockroach_pig: { columns: [] },
});

test("counts wins, ties, pairs and the hand number off the bead plate", () => {
  const t = boardTally(
    plate([bead("BankerWin", false, true), bead("PlayerWin", true), bead("Tie", true, true), bead("BankerWin")]),
  );
  expect(t).toEqual({ banker: 2, player: 1, tie: 1, bankerPair: 2, playerPair: 2, games: 4 });
});

test("an empty plate is all zeros", () => {
  expect(boardTally(plate([]))).toEqual({ banker: 0, player: 0, tie: 0, bankerPair: 0, playerPair: 0, games: 0 });
});
