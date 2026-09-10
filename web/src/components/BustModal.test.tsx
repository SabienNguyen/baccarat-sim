import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { BustModal } from "./BustModal";
import { nullAdapter } from "../portal/nullAdapter";
import type { PortalAdapter } from "../portal/types";

function fakePortal(over: Partial<PortalAdapter>): PortalAdapter {
  return { ...nullAdapter, name: "fake", canShowRewardedAd: () => true, ...over };
}

test("without a portal the modal is unchanged: no ad button", () => {
  renderModal({ portal: nullAdapter });
  expect(screen.queryByRole("button", { name: /watch an ad/i })).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Re-buy" })).toHaveClass("btn--gold");
});

test("with a rewarded ad on offer, watching it through performs the rebuy", async () => {
  const user = userEvent.setup();
  const requestRewardedAd = vi.fn(async () => true);
  const { onRebuy } = renderModal({ portal: fakePortal({ requestRewardedAd }) });
  const ad = screen.getByRole("button", { name: "Watch an ad for a fresh buy-in" });
  expect(ad).toHaveClass("btn--gold");
  // the free rebuy is still there, demoted to a secondary action
  expect(screen.getByRole("button", { name: "Re-buy" })).not.toHaveClass("btn--gold");
  await user.click(ad);
  expect(requestRewardedAd).toHaveBeenCalledOnce();
  expect(onRebuy).toHaveBeenCalledOnce();
});

test("when no ad is available it says so and leaves the free rebuy in reach", async () => {
  const user = userEvent.setup();
  const requestRewardedAd = vi.fn(async () => false);
  const { onRebuy } = renderModal({ portal: fakePortal({ requestRewardedAd }) });
  await user.click(screen.getByRole("button", { name: "Watch an ad for a fresh buy-in" }));
  expect(onRebuy).not.toHaveBeenCalled();
  expect(await screen.findByText("No ad available right now")).toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Re-buy" }));
  expect(onRebuy).toHaveBeenCalledOnce();
});

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
