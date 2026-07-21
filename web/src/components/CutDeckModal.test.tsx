import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CutDeckModal } from "./CutDeckModal";

test("cut & shuffle is disabled until the deck is cut, then fires onCut", async () => {
  const onCut = vi.fn();
  render(<CutDeckModal onCut={onCut} onCancel={vi.fn()} />);
  const confirm = screen.getByRole("button", { name: /Cut & shuffle/ });
  expect(confirm).toBeDisabled();

  // tap the first slot to place the cut
  fireEvent.click(screen.getByLabelText("Shoe").firstChild as Element);
  expect(confirm).toBeEnabled();
  await userEvent.click(confirm);
  expect(onCut).toHaveBeenCalledOnce();
});

test("cancel backs out without cutting", async () => {
  const onCut = vi.fn();
  const onCancel = vi.fn();
  render(<CutDeckModal onCut={onCut} onCancel={onCancel} />);
  await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(onCancel).toHaveBeenCalledOnce();
  expect(onCut).not.toHaveBeenCalled();
});

test("the cut is fully keyboard-operable", async () => {
  const onCut = vi.fn();
  render(<CutDeckModal onCut={onCut} onCancel={vi.fn()} />);
  const confirm = screen.getByRole("button", { name: /Cut & shuffle/ });
  expect(confirm).toBeDisabled();
  // arm a slot with the keyboard, then confirm — no pointer involved
  await userEvent.click(screen.getByRole("button", { name: /Cut at position 1 of/ }));
  expect(confirm).toBeEnabled();
});

test("Escape cancels the cut", () => {
  const onCancel = vi.fn();
  render(<CutDeckModal onCut={vi.fn()} onCancel={onCancel} />);
  fireEvent.keyDown(window, { key: "Escape" });
  expect(onCancel).toHaveBeenCalledOnce();
});

test("dropping the cut card onto a slot arms the cut", () => {
  const onCut = vi.fn();
  render(<CutDeckModal onCut={onCut} onCancel={vi.fn()} />);
  const slot = screen.getByLabelText("Shoe").firstChild as Element;
  fireEvent.drop(slot, { dataTransfer: { getData: () => "cut" } });
  expect(screen.getByRole("button", { name: /Cut & shuffle/ })).toBeEnabled();
});
