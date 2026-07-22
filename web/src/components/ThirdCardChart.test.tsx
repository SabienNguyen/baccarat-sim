import { render, screen } from "@testing-library/react";
import { ThirdCardChart } from "./ThirdCardChart";

test("states the player's rule and the player-stood banker rule", () => {
  render(<ThirdCardChart />);
  expect(screen.getByText(/Player draws on 0–5, stands on 6–7/i)).toBeInTheDocument();
  expect(screen.getByText(/If the Player stands.*Banker draws on 0–5/i)).toBeInTheDocument();
});

test("encodes the banker tableau faithfully to the engine rule", () => {
  render(<ThirdCardChart />);
  // banker 3 draws on any player third card except an 8
  expect(screen.getByText(/unless it's an 8/i)).toBeInTheDocument();
  // the classic draw ranges
  expect(screen.getByRole("row", { name: /3.*unless it's an 8/i })).toBeInTheDocument();
  expect(screen.getByRole("row", { name: /4.*2–7/ })).toBeInTheDocument();
  expect(screen.getByRole("row", { name: /5.*4–7/ })).toBeInTheDocument();
  expect(screen.getByRole("row", { name: /6.*6–7/ })).toBeInTheDocument();
  // banker 7 always stands
  expect(screen.getByRole("row", { name: /7.*(stands|never)/i })).toBeInTheDocument();
});
