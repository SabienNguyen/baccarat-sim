import { render, screen, within } from "@testing-library/react";
import { Scoreboard } from "./Scoreboard";
import { scoredSnapshot, bettingSnapshot } from "../test/fixtures";

test("renders one bead per round in the bead plate", () => {
  render(<Scoreboard scoreboard={scoredSnapshot().scoreboard} />);
  const plate = screen.getByLabelText("Bead Plate");
  expect(within(plate).getAllByRole("listitem")).toHaveLength(3);
});

test("renders the Big Road columns", () => {
  render(<Scoreboard scoreboard={scoredSnapshot().scoreboard} />);
  const road = screen.getByLabelText("Big Road");
  expect(within(road).getAllByRole("list")).toHaveLength(2);
});

test("renders all three derived roads by name", () => {
  render(<Scoreboard scoreboard={scoredSnapshot().scoreboard} />);
  expect(screen.getByLabelText("Big Eye Boy")).toBeInTheDocument();
  expect(screen.getByLabelText("Small Road")).toBeInTheDocument();
  expect(screen.getByLabelText("Cockroach Pig")).toBeInTheDocument();
});

test("renders empty roads without crashing", () => {
  render(<Scoreboard scoreboard={bettingSnapshot().scoreboard} />);
  expect(screen.getByLabelText("Bead Plate")).toBeInTheDocument();
});
