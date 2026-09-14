import { render, screen, within } from "@testing-library/react";
import { BeadPlateView, BigRoadView, DerivedRoadView } from "./roads";
import { RoadsModal } from "./RoadsModal";
import { scoredSnapshot } from "../test/fixtures";
import type { BeadCell, BigRoad, BigRoadCell, DerivedRoad } from "../engine/types";

function cell(): BigRoadCell {
  return { side: "Banker", ties: 0, player_pair: false, banker_pair: false, dragon7: false, panda8: false, tiger: false, natural: false };
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
  expect(plain.querySelectorAll(".pair-dot, .bonus-token, .natural-dot")).toHaveLength(0);
});

test("a natural cell gets the gold dot; a non-natural cell does not", () => {
  const columns: BigRoadCell[][] = [
    [{ ...cell(), side: "Player", natural: true }],
    [cell()], // not a natural: no dot
  ];
  const { container } = render(<BigRoadView road={{ columns }} />);
  const lists = container.querySelectorAll(".road-grid ul");
  expect(lists[0].querySelectorAll(".natural-dot")).toHaveLength(1);
  expect(lists[1].querySelectorAll(".natural-dot")).toHaveLength(0);
});

test("the big road follows the latest column when it outgrows the window", () => {
  const { container, rerender } = render(<BigRoadView road={road(20)} />);
  const grid = container.querySelector<HTMLElement>(".road-grid")!;
  // jsdom has no layout: fake the overflow the pit display would have
  Object.defineProperty(grid, "scrollWidth", { value: 900, configurable: true });
  rerender(<BigRoadView road={road(21)} />);
  expect(grid.scrollLeft).toBe(900);
});

test("the grid is sized to a whole number of column-pitches that fit its panel", () => {
  const { container } = render(<BigRoadView road={road(20)} />);
  const grid = container.querySelector<HTMLElement>(".road-grid")!;
  const parent = grid.parentElement!;
  Object.defineProperty(parent, "clientWidth", { value: 400, configurable: true });

  const real = window.getComputedStyle;
  const spy = vi.spyOn(window, "getComputedStyle").mockImplementation((el, pseudo) => {
    const style = real.call(window, el as Element, pseudo ?? undefined);
    if (el !== grid) return style;
    return new Proxy(style, {
      get(target, prop, receiver) {
        if (prop === "getPropertyValue") {
          return (name: string) => {
            if (name === "--road-cell") return "27px";
            if (name === "--road-gap") return "3px";
            return target.getPropertyValue(name);
          };
        }
        return Reflect.get(target, prop, receiver);
      },
    });
  });

  // the sizing effect samples layout on mount, when jsdom reports 0 for
  // everything; re-run it the same way a real resize would.
  window.dispatchEvent(new Event("resize"));

  expect(grid.style.width).toBe("387px"); // 13 columns: 13*27 + 12*3

  spy.mockRestore();
});

test("a plain mouse wheel pans an overflowing road grid horizontally", () => {
  const { container } = render(<BigRoadView road={road(20)} />);
  const grid = container.querySelector<HTMLElement>(".road-grid")!;
  Object.defineProperty(grid, "scrollWidth", { value: 900, configurable: true });
  Object.defineProperty(grid, "clientWidth", { value: 400, configurable: true });
  grid.scrollLeft = 100;

  const wheel = new WheelEvent("wheel", { deltaY: 60, deltaX: 0, cancelable: true });
  grid.dispatchEvent(wheel);

  expect(grid.scrollLeft).toBe(160);
});

// --- food roads + Chinatown bead plate (presentation only) ---

const derived: DerivedRoad = { columns: [["Red", "Blue"], ["Red"]] };

test.each([
  ["donut", "Big Eye Boy", "DONUTS"],
  ["burger", "Small Road", "HAMBURGERS"],
  ["fries", "Cockroach Pig", "FRENCH FRIES"],
] as const)("the %s road draws a pixel icon per mark under its fun title", (glyph, label, title) => {
  const { container } = render(<DerivedRoadView label={label} glyph={glyph} road={derived} />);
  // accessible name stays the traditional one; the fun name is the visible title
  const road = screen.getByLabelText(label);
  expect(within(road).getByText(title)).toBeInTheDocument();
  expect(within(road).getByText(label)).toBeInTheDocument();
  // one icon per mark, in this road's food, named for what the colour means
  expect(container.querySelectorAll(`svg[data-glyph="${glyph}"]`)).toHaveLength(3);
  expect(within(road).getAllByRole("img", { name: "Banker" })).toHaveLength(2);
  expect(within(road).getAllByRole("img", { name: "Player" })).toHaveLength(1);
  // the colour meaning survives on the cell, and the old text glyph is gone
  expect(container.querySelectorAll('li[data-mark="Red"]')).toHaveLength(2);
  expect(container.textContent).not.toMatch(/[●○]/);
  // grid geometry is untouched: still one <ul> per column inside .road-grid
  expect(container.querySelectorAll(".road-grid > ul")).toHaveLength(2);
});

test("the Chinatown bead plate draws each outcome as a pixel character", () => {
  const cells: BeadCell[] = [
    { outcome: "BankerWin", player_pair: false, banker_pair: true },
    { outcome: "PlayerWin", player_pair: true, banker_pair: false },
    { outcome: "Tie", player_pair: false, banker_pair: false },
  ];
  const { container } = render(<BeadPlateView plate={{ cells }} />);
  const board = screen.getByLabelText("Bead Plate");
  expect(within(board).getByText("CHINATOWN")).toBeInTheDocument();
  expect(within(board).getByText("Bead Plate")).toBeInTheDocument();
  // one pixel character per bead, named for the outcome
  expect(within(board).getByRole("img", { name: "Banker" })).toBeInTheDocument();
  expect(within(board).getByRole("img", { name: "Player" })).toBeInTheDocument();
  expect(within(board).getByRole("img", { name: "Tie" })).toBeInTheDocument();
  expect(container.querySelectorAll(".bead-grid li[data-outcome] svg.han-glyph")).toHaveLength(3);
  // no Latin P/B/T fallback text left in the beads (only the svg <title>s)
  for (const li of container.querySelectorAll(".bead-grid li")) {
    const ownText = [...li.childNodes].filter((n) => n.nodeType === Node.TEXT_NODE);
    expect(ownText).toHaveLength(0);
  }
  // pairs still show, as the corner pixel dots
  expect(container.querySelectorAll(".bead-grid .pair-dot--banker")).toHaveLength(1);
  expect(container.querySelectorAll(".bead-grid .pair-dot--player")).toHaveLength(1);
});

test("the bead plate follows its newest column like the other roads", () => {
  const bead = (): BeadCell => ({ outcome: "BankerWin", player_pair: false, banker_pair: false });
  const plate = (n: number) => ({ cells: Array.from({ length: n }, bead) });
  const { container, rerender } = render(<BeadPlateView plate={plate(60)} />);
  const grid = container.querySelector<HTMLElement>(".bead-grid")!;
  Object.defineProperty(grid, "scrollWidth", { value: 700, configurable: true });
  rerender(<BeadPlateView plate={plate(61)} />); // starts an eleventh column
  expect(grid.scrollLeft).toBe(700);
});

test("the full roads window hands each derived road its food", () => {
  render(<RoadsModal scoreboard={scoredSnapshot().scoreboard} onClose={() => {}} />);
  const dialog = screen.getByRole("dialog", { name: "All roads" });
  expect(within(dialog).getByLabelText("Big Eye Boy").querySelector('[data-glyph="donut"]')).not.toBeNull();
  expect(within(dialog).getByLabelText("Small Road").querySelector('[data-glyph="burger"]')).not.toBeNull();
  expect(within(dialog).getByLabelText("Cockroach Pig").querySelector('[data-glyph="fries"]')).not.toBeNull();
  // the Big Road is not part of the reskin: no food, no characters
  const big = within(dialog).getByLabelText("Big Road");
  expect(big.querySelectorAll("[data-glyph], .han-glyph")).toHaveLength(0);
});

test("a run longer than six bends right along the bottom row (dragon tail)", () => {
  const eight: BigRoadCell[][] = [Array.from({ length: 8 }, () => cell()), [{ ...cell(), side: "Player" }]];
  const { container } = render(<BigRoadView road={{ columns: eight }} />);
  const cells = [...container.querySelectorAll<HTMLElement>(".road-grid li")];
  const at = (i: number) => [cells[i].style.gridColumn, cells[i].style.gridRow];
  expect(at(5)).toEqual(["1", "6"]); // sixth cell: bottom of column 1
  expect(at(6)).toEqual(["2", "6"]); // seventh: bent right along row 6
  expect(at(7)).toEqual(["3", "6"]);
  expect(at(8)).toEqual(["2", "1"]); // next run heads the column right of the run's START
  // the same fold applies to the derived roads
  const long: DerivedRoad = { columns: [Array.from({ length: 7 }, () => "Red" as const)] };
  const d = render(<DerivedRoadView label="Small Road" glyph="burger" road={long} />);
  const last = [...d.container.querySelectorAll<HTMLElement>(".road-grid li")].pop()!;
  expect([last.style.gridColumn, last.style.gridRow]).toEqual(["2", "6"]);
});

// The reskin leaves the Big Road cell markup alone; the only addition is the
// dragon-tail grid placement (inline grid-column / grid-row) on each cell.
test("the Big Road markup is untouched by the reskin", () => {
  const columns: BigRoadCell[][] = [
    [{ ...cell(), side: "Player", player_pair: true }, { ...cell(), side: "Player", ties: 2 }],
    [{ ...cell(), banker_pair: true, tiger: true }],
  ];
  const { container } = render(<BigRoadView road={{ columns }} />);
  expect(container.innerHTML).toMatchInlineSnapshot(`"<div aria-label="Big Road" class="road big"><h4>Big Road <span class="road-info"><button type="button" class="road-info-btn" aria-label="What is the Big Road?">?</button></span></h4><div class="road-grid"><ul><li data-side="Player" style="grid-column: 1; grid-row: 1;">P<span class="pair-dot pair-dot--player" title="Player pair"></span></li><li data-side="Player" style="grid-column: 1; grid-row: 2;">P/2</li></ul><ul><li data-side="Banker" style="grid-column: 2; grid-row: 1;">B<span class="pair-dot pair-dot--banker" title="Banker pair"></span><svg class="bonus-token bonus-token--tiger" width="11" height="11" viewBox="0 0 8 8" role="img" aria-label="Tiger"><title>Tiger</title><rect x="0" y="0" width="1" height="1" fill="#e08a2e"></rect><rect x="7" y="0" width="1" height="1" fill="#e08a2e"></rect><rect x="0" y="1" width="1" height="1" fill="#e08a2e"></rect><rect x="1" y="1" width="1" height="1" fill="#e08a2e"></rect><rect x="6" y="1" width="1" height="1" fill="#e08a2e"></rect><rect x="7" y="1" width="1" height="1" fill="#e08a2e"></rect><rect x="1" y="2" width="1" height="1" fill="#e08a2e"></rect><rect x="2" y="2" width="1" height="1" fill="#e08a2e"></rect><rect x="3" y="2" width="1" height="1" fill="#e08a2e"></rect><rect x="4" y="2" width="1" height="1" fill="#e08a2e"></rect><rect x="5" y="2" width="1" height="1" fill="#e08a2e"></rect><rect x="6" y="2" width="1" height="1" fill="#e08a2e"></rect><rect x="0" y="3" width="1" height="1" fill="#e08a2e"></rect><rect x="1" y="3" width="1" height="1" fill="#15110f"></rect><rect x="2" y="3" width="1" height="1" fill="#e08a2e"></rect><rect x="3" y="3" width="1" height="1" fill="#e08a2e"></rect><rect x="4" y="3" width="1" height="1" fill="#e08a2e"></rect><rect x="5" y="3" width="1" height="1" fill="#15110f"></rect><rect x="6" y="3" width="1" height="1" fill="#e08a2e"></rect><rect x="7" y="3" width="1" height="1" fill="#e08a2e"></rect><rect x="0" y="4" width="1" height="1" fill="#e08a2e"></rect><rect x="1" y="4" width="1" height="1" fill="#e08a2e"></rect><rect x="2" y="4" width="1" height="1" fill="#e08a2e"></rect><rect x="3" y="4" width="1" height="1" fill="#e08a2e"></rect><rect x="4" y="4" width="1" height="1" fill="#e08a2e"></rect><rect x="5" y="4" width="1" height="1" fill="#e08a2e"></rect><rect x="6" y="4" width="1" height="1" fill="#e08a2e"></rect><rect x="7" y="4" width="1" height="1" fill="#e08a2e"></rect><rect x="0" y="5" width="1" height="1" fill="#e08a2e"></rect><rect x="1" y="5" width="1" height="1" fill="#15110f"></rect><rect x="2" y="5" width="1" height="1" fill="#e08a2e"></rect><rect x="3" y="5" width="1" height="1" fill="#e08a2e"></rect><rect x="4" y="5" width="1" height="1" fill="#e08a2e"></rect><rect x="5" y="5" width="1" height="1" fill="#15110f"></rect><rect x="6" y="5" width="1" height="1" fill="#e08a2e"></rect><rect x="7" y="5" width="1" height="1" fill="#e08a2e"></rect><rect x="1" y="6" width="1" height="1" fill="#e08a2e"></rect><rect x="2" y="6" width="1" height="1" fill="#15110f"></rect><rect x="3" y="6" width="1" height="1" fill="#e08a2e"></rect><rect x="4" y="6" width="1" height="1" fill="#e08a2e"></rect><rect x="5" y="6" width="1" height="1" fill="#15110f"></rect><rect x="6" y="6" width="1" height="1" fill="#e08a2e"></rect><rect x="2" y="7" width="1" height="1" fill="#e08a2e"></rect><rect x="3" y="7" width="1" height="1" fill="#e08a2e"></rect><rect x="4" y="7" width="1" height="1" fill="#e08a2e"></rect><rect x="5" y="7" width="1" height="1" fill="#e08a2e"></rect></svg></li></ul></div></div>"`);
});
