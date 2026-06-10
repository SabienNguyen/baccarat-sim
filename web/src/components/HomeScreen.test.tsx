import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HomeScreen } from "./HomeScreen";

test("offers single player and multiplayer", () => {
  render(<HomeScreen onPlay={vi.fn()} />);
  expect(screen.getByRole("button", { name: /Single Player/ })).toBeInTheDocument();
  const multi = screen.getByRole("button", { name: /Multiplayer/ });
  expect(multi).toHaveTextContent(/Coming soon/);
});

test("single player offers the three tables and starts the chosen one", async () => {
  const onPlay = vi.fn();
  render(<HomeScreen onPlay={onPlay} />);
  await userEvent.click(screen.getByRole("button", { name: /Single Player/ }));
  expect(screen.getByRole("button", { name: /Low Stakes/ })).toHaveTextContent("$1.00 – $500.00");
  expect(screen.getByRole("button", { name: /Mid Roller/ })).toHaveTextContent("Buy-in $10,000.00");
  await userEvent.click(screen.getByRole("button", { name: /High Roller/ }));
  expect(onPlay).toHaveBeenCalledWith("high");
});

test("multiplayer shows the table preview and a way back", async () => {
  render(<HomeScreen onPlay={vi.fn()} />);
  await userEvent.click(screen.getByRole("button", { name: /Multiplayer/ }));
  expect(screen.getByText("Public Tables")).toBeInTheDocument();
  expect(screen.getByText("Private Table")).toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "Back" }));
  expect(screen.getByRole("button", { name: /Single Player/ })).toBeInTheDocument();
});
