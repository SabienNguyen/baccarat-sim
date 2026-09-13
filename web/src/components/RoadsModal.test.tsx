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

const cells = (r: HTMLElement) => [...r.querySelectorAll<HTMLElement>("td.board-key-cell")];
const forecasts = (r: HTMLElement) => cells(r).map((c) => c.dataset.forecast);
const blank = (r: HTMLElement) => cells(r).map((c) => c.classList.contains("board-key-cell--blank"));
const colours = (r: HTMLElement) =>
  [...r.querySelectorAll("svg[data-glyph]")].map((s) => s.getAttribute("aria-label"));

test("on an empty shoe the key has its rows and headers but every cell is blank", () => {
  const empty: ScoreboardSnapshot = {
    bead_plate: { cells: [] },
    big_road: { columns: [] },
    big_eye_boy: { columns: [] },
    small_road: { columns: [] },
    cockroach_pig: { columns: [] },
  };
  render(<RoadsModal scoreboard={empty} onClose={() => {}} />);
  const key = screen.getByRole("table", { name: "Key · Next hand" });
  expect(within(key).getByText(/key · next hand/i)).toBeInTheDocument();
  // no mark anywhere: a red donut under 庄 would say "red means Banker"
  expect(key.querySelectorAll("svg[data-glyph]")).toHaveLength(0);
  for (const [label, road] of [
    ["Donuts", "Big Eye Boy"],
    ["Hamburgers", "Small Road"],
    ["French fries", "Cockroach Pig"],
  ] as const) {
    const r = row(key, label);
    expect(within(r).getByText(road)).toBeInTheDocument(); // traditional name subtitle
    expect(forecasts(r)).toEqual(["none", "none"]);
    expect(blank(r)).toEqual([true, true]);
    expect(cells(r)[0].title).toBe(`${road}: not started yet`);
  }
});

test("once a road has started, each cell is painted the colour its side would stamp next", () => {
  render(<RoadsModal scoreboard={board()} onClose={() => {}} />);
  const key = screen.getByRole("table", { name: "Key · Next hand" });
  // heights [2,3,1,1,2]: Banker extends the last column (row 2), Player opens a sixth.
  // Big Eye Boy for that Banker reads column 3 (one cell): the cell beside
  // row 2 and the one above it are both missing → nothing changed → Red.
  const donut = row(key, "Donuts"); // Banker -> Red, Player -> Blue
  expect(forecasts(donut)).toEqual(["red", "blue"]);
  expect(colours(donut)).toEqual(["Banker", "Player"]);
  expect(blank(donut)).toEqual([false, false]);
  const fries = row(key, "French fries"); // Banker -> Red, Player -> Blue
  expect(forecasts(fries)).toEqual(["red", "blue"]);
  expect(colours(fries)).toEqual(["Banker", "Player"]);
  expect(blank(fries)).toEqual([false, false]);
  expect(cells(donut)[0].title).toBe("Big Eye Boy: Banker next → red donut");
  expect(cells(fries)[1].title).toBe("Cockroach Pig: Player next → blue fries");
});

test("crossed forecasts paint the forecast, not the column: 庄 shows blue and 闲 shows red", () => {
  // B B P: heights [2,1]. Banker opens a third column and Big Eye Boy compares
  // heights 1 vs 2 -> Blue; Player extends the second column and finds a cell
  // beside it at row 1 -> Red. The Banker column therefore holds a blue donut.
  const crossed: ScoreboardSnapshot = {
    bead_plate: { cells: [bead("BankerWin"), bead("BankerWin"), bead("PlayerWin")] },
    big_road: { columns: [[win("Banker"), win("Banker")], [win("Player")]] },
    big_eye_boy: { columns: [] },
    small_road: { columns: [] },
    cockroach_pig: { columns: [] },
  };
  render(<RoadsModal scoreboard={crossed} onClose={() => {}} />);
  const key = screen.getByRole("table", { name: "Key · Next hand" });
  const donut = row(key, "Donuts");
  expect(forecasts(donut)).toEqual(["blue", "red"]);
  expect(colours(donut)).toEqual(["Player", "Banker"]); // blue under 庄, red under 闲
  expect(blank(donut)).toEqual([false, false]);
  expect(cells(donut)[0].title).toBe("Big Eye Boy: Banker next → blue donut");
  expect(cells(donut)[1].title).toBe("Big Eye Boy: Player next → red donut");
  // the other two roads have not started: blank cells, no mark at all
  const fries = row(key, "French fries");
  expect(forecasts(fries)).toEqual(["none", "none"]);
  expect(colours(fries)).toEqual([]);
  expect(blank(fries)).toEqual([true, true]);
});

test("a road that has not started shows blank cells, not a legend", () => {
  render(<RoadsModal scoreboard={scoredSnapshot().scoreboard} onClose={() => {}} />);
  const key = screen.getByRole("table", { name: "Key · Next hand" });
  // scoredSnapshot's big road is [P],[B]: no road can mark a third column yet
  const fries = row(key, "French fries");
  expect(fries.querySelectorAll("svg[data-glyph]")).toHaveLength(0);
  expect(forecasts(fries)).toEqual(["none", "none"]);
  expect(blank(fries)).toEqual([true, true]);
  expect(cells(fries)[0].title).toBe("Cockroach Pig: not started yet");
});

test("the board locks page scroll while it is open and releases it on close", () => {
  const { unmount } = render(<RoadsModal scoreboard={board()} onClose={() => {}} />);
  expect(document.body.style.overflow).toBe("hidden");
  unmount();
  expect(document.body.style.overflow).toBe("");
});
