import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SeatsStrip } from "./SeatsStrip";
import type { SeatView } from "./protocol";

const seat = (id: number, name: string): SeatView => ({
  id,
  name,
  bankroll: 1_000_000,
  staked: 0,
  sitting_out: false,
  decided: false,
});

const seats = [seat(0, "alice"), seat(1, "bob")];

test("only our own chip is a rename control", () => {
  render(<SeatsStrip seats={seats} me={1} squeezers={null} betting onRename={() => {}} />);
  expect(screen.getByRole("button", { name: /bob — change your name/ })).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /alice/ })).not.toBeInTheDocument();
  expect(screen.getByText("alice")).toBeInTheDocument();
});

test("clicking our name opens a box; Enter commits the trimmed name", async () => {
  const onRename = vi.fn();
  render(<SeatsStrip seats={seats} me={1} squeezers={null} betting onRename={onRename} />);
  await userEvent.click(screen.getByRole("button", { name: /bob/ }));
  const box = screen.getByRole("textbox", { name: "Your name" });
  expect(box).toHaveValue("bob");
  await userEvent.clear(box);
  await userEvent.type(box, "  robert {Enter}");
  expect(onRename).toHaveBeenCalledWith("robert");
  // back to the label, which still shows the table's name until a push lands
  expect(screen.getByRole("button", { name: /bob/ })).toBeInTheDocument();
});

test("Escape puts the old name back without sending; an unchanged or blank name is not sent", async () => {
  const onRename = vi.fn();
  render(<SeatsStrip seats={seats} me={1} squeezers={null} betting onRename={onRename} />);
  await userEvent.click(screen.getByRole("button", { name: /bob/ }));
  await userEvent.type(screen.getByRole("textbox"), "zzz{Escape}");
  expect(onRename).not.toHaveBeenCalled();

  await userEvent.click(screen.getByRole("button", { name: /bob/ }));
  await userEvent.type(screen.getByRole("textbox"), "{Enter}"); // unchanged
  expect(onRename).not.toHaveBeenCalled();

  await userEvent.click(screen.getByRole("button", { name: /bob/ }));
  await userEvent.clear(screen.getByRole("textbox"));
  await userEvent.tab(); // blur with an empty box
  expect(onRename).not.toHaveBeenCalled();
});

test("without a seat id (single player) nobody gets a rename control", () => {
  render(<SeatsStrip seats={seats} squeezers={null} betting />);
  expect(screen.queryByRole("button")).not.toBeInTheDocument();
});

test("the rail shows as one more chip, only when someone is standing at it", () => {
  const { rerender } = render(<SeatsStrip seats={seats} squeezers={null} betting watchers={3} />);
  const rail = screen.getByLabelText("Watching");
  expect(rail).toHaveTextContent("3");
  expect(rail).toHaveTextContent("watching");
  rerender(<SeatsStrip seats={seats} squeezers={null} betting watchers={0} />);
  expect(screen.queryByLabelText("Watching")).not.toBeInTheDocument();
  rerender(<SeatsStrip seats={seats} squeezers={null} betting />);
  expect(screen.queryByLabelText("Watching")).not.toBeInTheDocument();
});
