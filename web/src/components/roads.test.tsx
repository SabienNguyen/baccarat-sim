import { render } from "@testing-library/react";
import { BigRoadView } from "./roads";
import type { BigRoad, BigRoadCell } from "../engine/types";

function cell(): BigRoadCell {
  return { side: "Banker", ties: 0, player_pair: false, banker_pair: false };
}

function road(columns: number): BigRoad {
  return { columns: Array.from({ length: columns }, () => [cell()]) };
}

test("the big road follows the latest column when it outgrows the window", () => {
  const { container, rerender } = render(<BigRoadView road={road(20)} />);
  const grid = container.querySelector<HTMLElement>(".road-grid")!;
  // jsdom has no layout: fake the overflow the pit display would have
  Object.defineProperty(grid, "scrollWidth", { value: 900, configurable: true });
  rerender(<BigRoadView road={road(21)} />);
  expect(grid.scrollLeft).toBe(900);
});
