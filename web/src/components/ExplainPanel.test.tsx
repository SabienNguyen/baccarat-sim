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

test("always carries the third-card tableau reference", () => {
  render(<ExplainPanel snapshot={snap({ explain: [] })} />);
  const panel = screen.getByLabelText("Explain");
  expect(within(panel).getByText(/Player draws on 0–5, stands on 6–7/i)).toBeInTheDocument();
});

test("explains the 5% commission on a settled Banker win", () => {
  render(
    <ExplainPanel
      snapshot={snap({
        payouts: [{ bet: { kind: { Main: "Banker" }, amount: 10_000 }, net: 9_500 }],
      })}
    />,
  );
  const panel = screen.getByLabelText("Explain");
  expect(within(panel).getByText(/5% commission/i)).toBeInTheDocument();
  expect(within(panel).getByText(/\$95\.00/)).toBeInTheDocument();
});

test("no commission note on a Player win", () => {
  render(
    <ExplainPanel
      snapshot={snap({
        payouts: [{ bet: { kind: { Main: "Player" }, amount: 10_000 }, net: 10_000 }],
      })}
    />,
  );
  expect(screen.queryByText(/commission/i)).toBeNull();
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
  // the house-edge row itself (the static tableau below also names "Banker")
  expect(screen.getByText(/Banker: 1\.06%/)).toBeInTheDocument();
  // only one Banker edge row despite two Banker bets
  expect(screen.getAllByText(/1\.06%/)).toHaveLength(1);
});
