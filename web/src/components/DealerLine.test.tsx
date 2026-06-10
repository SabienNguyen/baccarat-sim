import { render, screen, fireEvent } from "@testing-library/react";
import { DealerLine } from "./DealerLine";
import type { RoundSnapshot, GlossaryEntry } from "../engine/types";

function snap(over: Partial<RoundSnapshot> = {}): RoundSnapshot {
  return {
    phase: "Dealing",
    player: { cards: [], total: null },
    banker: { cards: [], total: null },
    bets: [],
    bankroll: 0,
    table_min: 0,
    table_max: 0,
    outcome: null,
    payouts: null,
    events: [{ Monkey: { hand: "Player", index: 0 } }],
    scoreboard: {
      bead_plate: { cells: [] },
      big_road: { columns: [] },
      big_eye_boy: { columns: [] },
      small_road: { columns: [] },
      cockroach_pig: { columns: [] },
    },
    explain: [],
    ...over,
  };
}

const lookup = (term: string): GlossaryEntry | undefined =>
  term === "monkey"
    ? { term: "monkey", label: "Monkey", short: "A zero-value card.", long: "..." }
    : undefined;

test("renders the dealer line in a live region with an interactive term", () => {
  render(<DealerLine snapshot={snap()} lookup={lookup} />);
  const region = screen.getByLabelText("Dealer");
  expect(region).toBeInTheDocument();
  expect(screen.getByText(/for the Player!/)).toBeInTheDocument();
  fireEvent.focus(screen.getByRole("button", { name: "Monkey" }));
  expect(screen.getByRole("tooltip")).toHaveTextContent("A zero-value card.");
});

test("plain (non-term) phases render without a button", () => {
  render(<DealerLine snapshot={snap({ phase: "Betting", events: [] })} lookup={lookup} />);
  expect(screen.getByText("Place your bets.")).toBeInTheDocument();
  expect(screen.queryByRole("button")).toBeNull();
});

test("a refused bet overrides the narration with the dealer's explanation", () => {
  render(
    <DealerLine
      snapshot={snap({ phase: "Betting", events: [] })}
      lastError={{ BetAboveMaximum: { max: 500_000, got: 600_000 } }}
      lookup={lookup}
    />,
  );
  expect(screen.getByLabelText("Dealer")).toHaveTextContent(
    "Too rich for this table — the max is $5,000.00.",
  );
});

test("multi-segment lines flow as one sentence, not stacked rows", () => {
  const { container } = render(
    <DealerLine snapshot={snap()} lookup={lookup} />,
  );
  // all segments live inside a single inline run
  const runs = container.querySelectorAll(".dealer-text");
  expect(runs).toHaveLength(1);
  expect(runs[0]).toHaveTextContent("Monkey for the Player! Counts for nothing.");
});
