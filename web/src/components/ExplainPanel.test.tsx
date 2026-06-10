import { render, screen, within } from "@testing-library/react";
import { ExplainPanel } from "./ExplainPanel";
import type { RoundSnapshot } from "../engine/types";

function snap(over: Partial<RoundSnapshot> = {}): RoundSnapshot {
  return {
    phase: "Settled",
    player: { cards: [], total: null },
    banker: { cards: [], total: null },
    bets: [],
    bankroll: 0,
    table_min: 0,
    table_max: 0,
    outcome: null,
    payouts: null,
    events: [],
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

test("lists the engine's explain trace", () => {
  render(<ExplainPanel snapshot={snap({ explain: ["Player drew on 4", "Banker stood on 7"] })} />);
  const panel = screen.getByLabelText("Explain");
  expect(within(panel).getByText("Player drew on 4")).toBeInTheDocument();
  expect(within(panel).getByText("Banker stood on 7")).toBeInTheDocument();
});

test("shows a neutral hint when there is no trace", () => {
  render(<ExplainPanel snapshot={snap({ explain: [] })} />);
  expect(screen.getByText(/see the rules in action/i)).toBeInTheDocument();
});

test("shows house edge only for placed main bets, de-duplicated", () => {
  render(
    <ExplainPanel
      snapshot={snap({
        bets: [
          { kind: { Main: "Banker" }, amount: 500 },
          { kind: { Main: "Banker" }, amount: 200 },
          { kind: { Side: "PlayerPair" }, amount: 100 },
        ],
      })}
    />,
  );
  expect(screen.getByText(/Banker/)).toBeInTheDocument();
  expect(screen.getByText(/1\.06%/)).toBeInTheDocument();
  // only one Banker edge row despite two Banker bets
  expect(screen.getAllByText(/1\.06%/)).toHaveLength(1);
});
