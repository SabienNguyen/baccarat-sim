import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { BustModal } from "./BustModal";

function renderModal(over: Partial<Parameters<typeof BustModal>[0]> = {}) {
  const onRebuy = vi.fn();
  const onLeave = vi.fn();
  render(
    <BustModal bankroll={37} tableMin={100} onRebuy={onRebuy} onLeave={onLeave} {...over} />,
  );
  return { onRebuy, onLeave };
}

test("shows the dead roll and the minimum it can no longer post", () => {
  renderModal();
  expect(screen.getByRole("dialog", { name: "Busted" })).toBeInTheDocument();
  expect(screen.getByText("BUSTED")).toBeInTheDocument();
  expect(screen.getByText("$0.37")).toBeInTheDocument();
  expect(screen.getByText(/\$1\.00/)).toBeInTheDocument();
});

test("re-buy and leave fire their callbacks", async () => {
  const user = userEvent.setup();
  const { onRebuy, onLeave } = renderModal();
  await user.click(screen.getByRole("button", { name: "Re-buy" }));
  expect(onRebuy).toHaveBeenCalledOnce();
  await user.click(screen.getByRole("button", { name: "Leave table" }));
  expect(onLeave).toHaveBeenCalledOnce();
});
