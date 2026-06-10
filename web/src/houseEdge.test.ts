import { mainBetEdge } from "./houseEdge";

test("returns the cited edge for each main bet", () => {
  expect(mainBetEdge({ Main: "Player" })).toEqual({
    label: "Player",
    edge: "1.24%",
    basis: "pays 1:1",
  });
  expect(mainBetEdge({ Main: "Banker" })?.edge).toBe("1.06%");
  expect(mainBetEdge({ Main: "Tie" })?.edge).toBe("14.36%");
});

test("side bets have no main-bet edge entry", () => {
  expect(mainBetEdge({ Side: "PlayerPair" })).toBeUndefined();
});
