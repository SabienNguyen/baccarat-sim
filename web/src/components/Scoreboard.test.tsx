import { render, screen, within, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Scoreboard } from "./Scoreboard";
import { scoredSnapshot, bettingSnapshot } from "../test/fixtures";

test("shows the Big Road inline", () => {
  render(<Scoreboard scoreboard={scoredSnapshot().scoreboard} />);
  const road = screen.getByLabelText("Big Road");
  expect(within(road).getAllByRole("list")).toHaveLength(2);
});

test("the full roads window is closed until requested", () => {
  render(<Scoreboard scoreboard={scoredSnapshot().scoreboard} />);
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(screen.queryByLabelText("Bead Plate")).toBeNull();
});

test("opening full roads reveals every road", async () => {
  render(<Scoreboard scoreboard={scoredSnapshot().scoreboard} />);
  await userEvent.click(screen.getByRole("button", { name: "Full roads" }));
  const dialog = screen.getByRole("dialog", { name: "All roads" });
  expect(within(dialog).getByLabelText("Bead Plate")).toBeInTheDocument();
  expect(within(dialog).getByLabelText("Big Eye Boy")).toBeInTheDocument();
  expect(within(dialog).getByLabelText("Small Road")).toBeInTheDocument();
  expect(within(dialog).getByLabelText("Cockroach Pig")).toBeInTheDocument();
});

test("the full roads window closes with its close button", async () => {
  render(<Scoreboard scoreboard={scoredSnapshot().scoreboard} />);
  await userEvent.click(screen.getByRole("button", { name: "Full roads" }));
  await userEvent.click(screen.getByRole("button", { name: "Close roads" }));
  expect(screen.queryByRole("dialog")).toBeNull();
});

test("the full roads window closes on Escape", async () => {
  render(<Scoreboard scoreboard={scoredSnapshot().scoreboard} />);
  await userEvent.click(screen.getByRole("button", { name: "Full roads" }));
  fireEvent.keyDown(window, { key: "Escape" });
  expect(screen.queryByRole("dialog")).toBeNull();
});

test("renders empty roads without crashing", () => {
  render(<Scoreboard scoreboard={bettingSnapshot().scoreboard} />);
  expect(screen.getByLabelText("Big Road")).toBeInTheDocument();
});

test("each road heading explains itself via an info tip", async () => {
  render(<Scoreboard scoreboard={scoredSnapshot().scoreboard} />);
  const info = screen.getByRole("button", { name: "What is the Big Road?" });
  fireEvent.focus(info);
  expect(screen.getByRole("tooltip")).toHaveTextContent(/Big Road is the primary grid/);
  fireEvent.blur(info);
  // the full-roads window carries tips for every road
  await userEvent.click(screen.getByRole("button", { name: "Full roads" }));
  expect(screen.getByRole("button", { name: "What is the Bead Plate?" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "What is the Big Eye Boy?" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "What is the Small Road?" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "What is the Cockroach Pig?" })).toBeInTheDocument();
});
