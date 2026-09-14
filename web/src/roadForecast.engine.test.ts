// @vitest-environment node
// roadForecast.ts is a hand port of engine/src/scoreboard.rs::derived_road.
// This pins the port to the Rust: play a real shoe through the wasm engine
// with a fixed seed and check, after every hand, that the port rebuilds each
// derived road from the Big Road exactly as the engine did.

import { expect, test } from "vitest";
import { createSession } from "./engine/adapter";
import { derivedRoad, nextMarks } from "./roadForecast";
import type { RoundSnapshot, ScoreboardSnapshot, Side } from "./engine/types";

const HANDS = 60;

/** Play one coup end to end and return the settled snapshot. */
function playHand(session: ReturnType<typeof createSession>): RoundSnapshot {
  const staked = session.placeBet({ Main: "Player" }, 100);
  if (!staked.ok) throw new Error(`placeBet refused: ${JSON.stringify(staked.error)}`);
  const dealt = session.deal();
  if (!dealt.ok) throw new Error(`deal refused: ${JSON.stringify(dealt.error)}`);
  for (const side of ["Player", "Banker"] as const) {
    const hand = side === "Player" ? dealt.snapshot.player : dealt.snapshot.banker;
    hand.cards.forEach((_, i) => session.reveal(side, i));
  }
  const settled = session.settle();
  if (!settled.ok) throw new Error(`settle refused: ${JSON.stringify(settled.error)}`);
  return settled.snapshot;
}

function roadsOf(board: ScoreboardSnapshot) {
  return [board.big_eye_boy.columns, board.small_road.columns, board.cockroach_pig.columns] as const;
}

test(`derivedRoad matches the engine's roads after each of ${HANDS} real hands`, () => {
  const session = createSession({
    starting_bankroll: 1_000_000,
    table_min: 100,
    table_max: 500_000,
    ruleset: "Commission",
    seed: 42,
  });
  session.cutShoe(500);
  let last: ScoreboardSnapshot | null = null;
  for (let hand = 0; hand < HANDS; hand++) {
    const board = playHand(session).scoreboard;
    const engine = roadsOf(board);
    for (const k of [1, 2, 3] as const) {
      expect(derivedRoad(board.big_road, k), `hand ${hand + 1}, offset ${k}`).toEqual(engine[k - 1]);
    }
    // and the forecast for the side that actually won is the mark the engine added
    if (last) {
      const winner = board.bead_plate.cells[board.bead_plate.cells.length - 1];
      if (winner.outcome !== "Tie") {
        const side: Side = winner.outcome === "BankerWin" ? "Banker" : "Player";
        const forecast = nextMarks(last.big_road, side);
        const before = roadsOf(last);
        engine.forEach((road, i) => {
          const tail = road.length ? road[road.length - 1].slice(-1)[0] : null;
          const grew = road.flat().length > before[i].flat().length;
          expect(forecast[i], `hand ${hand + 1}, road ${i + 1}`).toBe(grew ? tail : null);
        });
      }
    }
    last = board;
  }
  // the fixture did exercise every road: each has real columns by the end
  expect(last).not.toBeNull();
  for (const road of roadsOf(last!)) expect(road.length).toBeGreaterThan(3);
  expect(last!.big_road.columns.length).toBeGreaterThan(10);
});
