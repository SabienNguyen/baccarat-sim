import { render, screen, within } from "@testing-library/react";
import { RoadsModal } from "./RoadsModal";
import { scoredSnapshot } from "../test/fixtures";
import type { BeadCell, BigRoadCell, ScoreboardSnapshot, Side } from "../engine/types";

function bead(outcome: BeadCell["outcome"], pp = false, bp = false): BeadCell {
  return { outcome, player_pair: pp, banker_pair: bp };
}
function win(side: Side): BigRoadCell {
  return { side, ties: 0, player_pair: false, banker_pair: false, dragon7: false, panda8: false, tiger: false };
}

/** B B P P P B P B B — the engine's worked example, with a few pairs and a tie. */
function board(): ScoreboardSnapshot {
  return {
    bead_plate: {
      cells: [
        bead("BankerWin", false, true),
        bead("BankerWin"),
        bead("PlayerWin", true),
        bead("PlayerWin"),
        bead("Tie"),
        bead("PlayerWin", true, true),
        bead("BankerWin"),
        bead("PlayerWin"),
        bead("BankerWin"),
        bead("BankerWin"),
      ],
    },
    big_road: {
      columns: [
        [win("Banker"), win("Banker")],
        [win("Player"), win("Player"), win("Player")],
        [win("Banker")],
        [win("Player")],
        [win("Banker"), win("Banker")],
      ],
    },
    big_eye_boy: { columns: [["Red"], ["Blue", "Blue", "Blue"], ["Red"], ["Blue"]] },
    small_road: { columns: [["Blue", "Blue", "Blue"]] },
    cockroach_pig: { columns: [["Blue"], ["Red"]] },
  };
}

const row = (panel: HTMLElement, name: string) => within(panel).getByRole("row", { name });

test("the tally panel counts wins, pairs and the game number off the bead plate", () => {
  render(<RoadsModal scoreboard={board()} onClose={() => {}} />);
  const tally = screen.getByRole("table", { name: "Tally" });
  expect(row(tally, "Banker")).toHaveTextContent("5");
  expect(row(tally, "Player")).toHaveTextContent("4");
  expect(row(tally, "Tie")).toHaveTextContent("1");
  expect(row(tally, "Banker pair")).toHaveTextContent("2");
  expect(row(tally, "Player pair")).toHaveTextContent("2");
  expect(row(tally, "Game number")).toHaveTextContent("10");
});

test("the tally panel reads zero on a fresh shoe", () => {
  const empty: ScoreboardSnapshot = {
    bead_plate: { cells: [] },
    big_road: { columns: [] },
    big_eye_boy: { columns: [] },
    small_road: { columns: [] },
    cockroach_pig: { columns: [] },
  };
  render(<RoadsModal scoreboard={empty} onClose={() => {}} />);
  const tally = screen.getByRole("table", { name: "Tally" });
  expect(row(tally, "Banker")).toHaveTextContent("0");
  expect(row(tally, "Game number")).toHaveTextContent("0");
});

test("the limits panel posts the table's min and max for every spot", () => {
  render(<RoadsModal scoreboard={board()} tableMin={2500} tableMax={500000} onClose={() => {}} />);
  const limits = screen.getByRole("table", { name: "Table limits" });
  expect(row(limits, "Min")).toHaveTextContent("$25.00");
  expect(row(limits, "Max")).toHaveTextContent("$5,000.00");
  expect(row(limits, "Tie min")).toHaveTextContent("$25.00");
  expect(row(limits, "Tie max")).toHaveTextContent("$5,000.00");
  expect(row(limits, "Pairs min")).toHaveTextContent("$25.00");
  expect(row(limits, "Pairs max")).toHaveTextContent("$5,000.00");
});

test("the limits panel is left off when the board has no table to quote", () => {
  render(<RoadsModal scoreboard={scoredSnapshot().scoreboard} onClose={() => {}} />);
  expect(screen.queryByRole("table", { name: "Table limits" })).toBeNull();
});

test("the next-hand key forecasts each derived road for a Banker or Player result", () => {
  render(<RoadsModal scoreboard={board()} onClose={() => {}} />);
  const key = screen.getByRole("table", { name: "Next hand" });
  // heights [2,3,1,1,2]: Banker extends the last column (row 2), Player opens a sixth
  const donut = row(key, "Donuts");
  const burger = row(key, "Hamburgers");
  const fries = row(key, "French fries");
  const marks = (r: HTMLElement) => [...r.querySelectorAll("svg[data-glyph]")].map((s) => s.getAttribute("aria-label"));
  expect(marks(donut)).toEqual(["Player", "Player"]); // Blue, Blue
  expect(marks(burger)).toEqual(["Player", "Player"]); // Blue, Blue
  expect(marks(fries)).toEqual(["Banker", "Player"]); // Red, Blue
  expect(donut.querySelectorAll('[data-glyph="donut"]')).toHaveLength(2);
  expect(burger.querySelectorAll('[data-glyph="burger"]')).toHaveLength(2);
  expect(fries.querySelectorAll('[data-glyph="fries"]')).toHaveLength(2);
});

test("the next-hand key shows an empty cell where a road has not started", () => {
  render(<RoadsModal scoreboard={scoredSnapshot().scoreboard} onClose={() => {}} />);
  const key = screen.getByRole("table", { name: "Next hand" });
  // scoredSnapshot's big road is [P],[B]: no road can mark a third column yet
  expect(row(key, "French fries").querySelectorAll("svg[data-glyph]")).toHaveLength(0);
});

test("the board locks page scroll while it is open and releases it on close", () => {
  const { unmount } = render(<RoadsModal scoreboard={board()} onClose={() => {}} />);
  expect(document.body.style.overflow).toBe("hidden");
  unmount();
  expect(document.body.style.overflow).toBe("");
});
