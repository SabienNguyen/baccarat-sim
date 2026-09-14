import { describe, expect, test } from "vitest";
import { derivedRoad, nextMarks } from "./roadForecast";
import type { BigRoad, BigRoadCell, Side } from "./engine/types";

function cell(side: Side): BigRoadCell {
  return { side, ties: 0, player_pair: false, banker_pair: false, dragon7: false, panda8: false, tiger: false, natural: false };
}

/** Build a Big Road from a win sequence the way the engine does (ties aside). */
function bigRoad(seq: string): BigRoad {
  const columns: BigRoadCell[][] = [];
  for (const ch of seq) {
    const side: Side = ch === "B" ? "Banker" : "Player";
    const last = columns[columns.length - 1];
    if (last && last[0].side === side) last.push(cell(side));
    else columns.push([cell(side)]);
  }
  return { columns };
}

// the engine's worked example (engine/src/scoreboard.rs): B B P P P B P B B
const WORKED = "BBPPPBPBB";

describe("derivedRoad mirrors the engine", () => {
  test("big eye boy", () => {
    expect(derivedRoad(bigRoad(WORKED), 1)).toEqual([["Red"], ["Blue", "Blue", "Blue"], ["Red"], ["Blue"]]);
  });
  test("small road", () => {
    expect(derivedRoad(bigRoad(WORKED), 2)).toEqual([["Blue", "Blue", "Blue"]]);
  });
  test("cockroach pig", () => {
    expect(derivedRoad(bigRoad(WORKED), 3)).toEqual([["Blue"], ["Red"]]);
  });
  test("a deep run beside a short column breaks once, then holds red", () => {
    // [B],[P,P,P,P]: row 1 Blue (reference column just ended), rows 2-3 Red
    expect(derivedRoad(bigRoad("BPPPP"), 1)).toEqual([["Blue"], ["Red", "Red"]]);
    expect(derivedRoad(bigRoad("BBPBBBB"), 2)).toEqual([["Red"], ["Blue"], ["Red"]]);
  });
  test("nothing before the start cell", () => {
    expect(derivedRoad(bigRoad("BP"), 1)).toEqual([]);
    expect(derivedRoad(bigRoad(""), 1)).toEqual([]);
  });
});

describe("nextMarks forecasts what each road would add", () => {
  test("agrees with recomputing the road after the hypothetical win", () => {
    for (const seq of [WORKED, "BBBBPPBPPPBBPB", "PBPBPBPB", "BBBBBBB", "B", "BP", "BBP", "BPPP", "BPPPP", "BBPBBB"]) {
      for (const side of ["Banker", "Player"] as const) {
        const forecast = nextMarks(bigRoad(seq), side);
        const after = bigRoad(seq + (side === "Banker" ? "B" : "P"));
        for (const [i, offset] of [1, 2, 3].entries()) {
          const road = derivedRoad(after, offset);
          const last = road.length ? road[road.length - 1].slice(-1)[0] : null;
          expect(forecast[i], `${seq}+${side} offset ${offset}`).toBe(last);
        }
      }
    }
  });
  test("is null for every road on an empty shoe", () => {
    expect(nextMarks({ columns: [] }, "Banker")).toEqual([null, null, null]);
  });
});
