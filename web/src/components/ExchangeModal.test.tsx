import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ExchangeModal } from "./ExchangeModal";
import { addChips, emptyRack, CHIP_DENOMINATIONS } from "../chips";

test("break is offered only when you hold a breakable chip", async () => {
  const onBreak = vi.fn();
  const rack = addChips(emptyRack(), [10000]); // one $100, nothing else
  render(
    <ExchangeModal denoms={CHIP_DENOMINATIONS} rack={rack} change={0} onBreak={onBreak} onAcquire={vi.fn()} onClose={vi.fn()} />,
  );
  const rows = screen.getAllByRole("listitem");
  // rows are largest-first: $1k, $500, $100, $25, $5, $1
  const hundred = rows[2];
  const breakBtn = within(hundred).getByRole("button", { name: "Break" });
  expect(breakBtn).toBeEnabled();
  await userEvent.click(breakBtn);
  expect(onBreak).toHaveBeenCalledWith(10000);
  // the $1k row has nothing to break
  expect(within(rows[0]).getByRole("button", { name: "Break" })).toBeDisabled();
});

test("any chip is gettable when the rack covers it", async () => {
  const onAcquire = vi.fn();
  const rack = addChips(emptyRack(), [2500, 2500, 2500, 2500]); // 4x$25 = $100
  render(
    <ExchangeModal denoms={CHIP_DENOMINATIONS} rack={rack} change={0} onBreak={vi.fn()} onAcquire={onAcquire} onClose={vi.fn()} />,
  );
  const rows = screen.getAllByRole("listitem");
  const hundred = within(rows[2]).getByRole("button", { name: "Get" });
  expect(hundred).toBeEnabled(); // $100: affordable
  expect(within(rows[1]).getByRole("button", { name: "Get" })).toBeDisabled(); // $500: not
  await userEvent.click(hundred);
  expect(onAcquire).toHaveBeenCalledWith(10000);
});

test("shows loose change and closes", async () => {
  const onClose = vi.fn();
  render(
    <ExchangeModal
      denoms={CHIP_DENOMINATIONS}
      rack={emptyRack()}
      change={75}
      onBreak={vi.fn()}
      onAcquire={vi.fn()}
      onClose={onClose}
    />,
  );
  expect(screen.getByText(/Loose change: \$0\.75/)).toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "Close exchange" }));
  expect(onClose).toHaveBeenCalledOnce();
});
