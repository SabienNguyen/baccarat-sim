import { render } from "@testing-library/react";
import { BigRoadView } from "./roads";
import type { BigRoad, BigRoadCell } from "../engine/types";

function cell(): BigRoadCell {
  return { side: "Banker", ties: 0, player_pair: false, banker_pair: false, dragon7: false, panda8: false, tiger: false };
}

function road(columns: number): BigRoad {
  return { columns: Array.from({ length: columns }, () => [cell()]) };
}

test("a win cell carries its pair dots and animal bonus token", () => {
  const columns: BigRoadCell[][] = [
    [{ ...cell(), side: "Player", player_pair: true }],
    [{ ...cell(), banker_pair: true, dragon7: true }],
    [{ ...cell(), side: "Player", panda8: true }],
    [{ ...cell(), tiger: true }],
    [cell()], // a plain win carries no marks at all
  ];
  const { container } = render(<BigRoadView road={{ columns }} />);

  // traditional pair dots, one of each
  expect(container.querySelectorAll(".pair-dot--player")).toHaveLength(1);
  expect(container.querySelectorAll(".pair-dot--banker")).toHaveLength(1);

  // one animal token per bonus, each labelled for screen readers
  const labels = [...container.querySelectorAll(".bonus-token")].map((t) =>
    t.getAttribute("aria-label"),
  );
  expect(labels).toEqual(["Dragon 7", "Panda 8", "Tiger"]);

  // the plain cell (last column) is unmarked
  const plain = container.querySelectorAll(".road-grid ul")[4];
  expect(plain.querySelectorAll(".pair-dot, .bonus-token")).toHaveLength(0);
});

test("the big road follows the latest column when it outgrows the window", () => {
  const { container, rerender } = render(<BigRoadView road={road(20)} />);
  const grid = container.querySelector<HTMLElement>(".road-grid")!;
  // jsdom has no layout: fake the overflow the pit display would have
  Object.defineProperty(grid, "scrollWidth", { value: 900, configurable: true });
  rerender(<BigRoadView road={road(21)} />);
  expect(grid.scrollLeft).toBe(900);
});
