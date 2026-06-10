import { render, screen, fireEvent } from "@testing-library/react";
import { GlossaryTerm } from "./GlossaryTerm";
import type { GlossaryEntry } from "../engine/types";

const entry: GlossaryEntry = {
  term: "monkey",
  label: "Monkey",
  short: "A 10 or face card, worth zero.",
  long: "...",
};

test("renders the label and reveals the definition on focus", () => {
  render(<GlossaryTerm term="monkey" label="Monkey" entry={entry} />);
  expect(screen.queryByRole("tooltip")).toBeNull();
  fireEvent.focus(screen.getByRole("button", { name: "Monkey" }));
  expect(screen.getByRole("tooltip")).toHaveTextContent("A 10 or face card, worth zero.");
});

test("hides the definition again on blur", () => {
  render(<GlossaryTerm term="monkey" label="Monkey" entry={entry} />);
  const btn = screen.getByRole("button", { name: "Monkey" });
  fireEvent.focus(btn);
  fireEvent.blur(btn);
  expect(screen.queryByRole("tooltip")).toBeNull();
});

test("with no entry it is plain text and not interactive", () => {
  render(<GlossaryTerm term="whatever" label="Whatever" entry={undefined} />);
  expect(screen.queryByRole("button")).toBeNull();
  expect(screen.getByText("Whatever")).toBeInTheDocument();
});
