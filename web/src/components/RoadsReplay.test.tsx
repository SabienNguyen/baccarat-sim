import { afterEach, expect, test } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { RoadsReplay } from "./RoadsReplay";

afterEach(() => {
  history.replaceState({}, "", "/");
});

test("renders nothing when ?roads is absent", () => {
  history.replaceState({}, "", "/");
  render(<RoadsReplay />);
  expect(screen.queryByRole("dialog", { name: "All roads" })).toBeNull();
});

test("?roads=<sequence> opens the full board for that shoe", () => {
  // B B P B P P P: four Big Road columns (BB | P | B | PPP).
  history.replaceState({}, "", "/?roads=BBPBPPP");
  render(<RoadsReplay />);
  const dialog = screen.getByRole("dialog", { name: "All roads" });
  const bigRoad = screen.getByLabelText("Big Road");
  expect(bigRoad.querySelectorAll(".road-grid > ul")).toHaveLength(4);
  expect(dialog).toBeInTheDocument();
});

test("closing the replay removes the roads param from the URL", () => {
  history.replaceState({}, "", "/?roads=BP");
  render(<RoadsReplay />);
  fireEvent.click(screen.getByRole("button", { name: "Close roads" }));
  expect(new URLSearchParams(location.search).get("roads")).toBeNull();
  expect(screen.queryByRole("dialog", { name: "All roads" })).toBeNull();
});
