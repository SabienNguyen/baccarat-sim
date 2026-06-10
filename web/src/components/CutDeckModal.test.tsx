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

test("dropping the cut card onto a slot arms the cut", () => {
  const onCut = vi.fn();
  render(<CutDeckModal onCut={onCut} onCancel={vi.fn()} />);
  const slot = screen.getByLabelText("Shoe").firstChild as Element;
  fireEvent.drop(slot, { dataTransfer: { getData: () => "cut" } });
  expect(screen.getByRole("button", { name: /Cut & shuffle/ })).toBeEnabled();
});
