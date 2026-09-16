import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Controls } from "./Controls";
import { bettingSnapshot, dealingSnapshot, settledSnapshot, shoeCutSnapshot } from "../test/fixtures";

test("Deal is enabled in Betting with at least one bet", async () => {
  const onDeal = vi.fn();
  const snap = bettingSnapshot({ bets: [{ kind: { Main: "Player" }, amount: 500 }] });
  render(
    <Controls
      snapshot={snap}
      onDeal={onDeal}
      onRevealAll={vi.fn()}
      onSettle={vi.fn()}
      onNewShoe={vi.fn()}
    />,
  );
  const deal = screen.getByRole("button", { name: "Deal" });
  expect(deal).toBeEnabled();
  await userEvent.click(deal);
  expect(onDeal).toHaveBeenCalledOnce();
});

test("Deal is disabled in Betting with no bets", () => {
  render(
    <Controls
      snapshot={bettingSnapshot()}
      onDeal={vi.fn()}
      onRevealAll={vi.fn()}
      onSettle={vi.fn()}
      onNewShoe={vi.fn()}
    />,
  );
  expect(screen.getByRole("button", { name: "Deal" })).toBeDisabled();
});

test("Reveal all is disabled outside Dealing and enabled (and fires) in Dealing", async () => {
  const onRevealAll = vi.fn();
  const { rerender } = render(
    <Controls
      snapshot={bettingSnapshot()}
      onDeal={vi.fn()}
      onRevealAll={onRevealAll}
      onSettle={vi.fn()}
      onNewShoe={vi.fn()}
    />,
  );
  expect(screen.getByRole("button", { name: "Reveal all" })).toBeDisabled();

  rerender(
    <Controls
      snapshot={dealingSnapshot()}
      onDeal={vi.fn()}
      onRevealAll={onRevealAll}
      onSettle={vi.fn()}
      onNewShoe={vi.fn()}
    />,
  );
  const revealAll = screen.getByRole("button", { name: "Reveal all" });
  expect(revealAll).toBeEnabled();
  await userEvent.click(revealAll);
  expect(onRevealAll).toHaveBeenCalledOnce();
});

test("Settle renders only when its handler is given, and Next hand never does", () => {
  const { rerender } = render(
    <Controls
      snapshot={dealingSnapshot()}
      onDeal={vi.fn()}
      onRevealAll={vi.fn()}
      onSettle={vi.fn()}
      onNewShoe={vi.fn()}
    />,
  );
  expect(screen.getByRole("button", { name: "Settle" })).toBeEnabled();
  // single-player wiring passes neither handler → neither button exists
  rerender(
    <Controls snapshot={dealingSnapshot()} onDeal={vi.fn()} onRevealAll={vi.fn()} onNewShoe={vi.fn()} />,
  );
  expect(screen.queryByRole("button", { name: "Settle" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Next hand" })).toBeNull();
  expect(screen.queryByRole("button", { name: /^Reveal (Player|Banker) / })).toBeNull();
});

test("the Explain button reflects and toggles explain mode", async () => {
  const onToggleExplain = vi.fn();
  render(
    <Controls
      snapshot={bettingSnapshot()}
      onDeal={vi.fn()}
      onRevealAll={vi.fn()}
      onSettle={vi.fn()}
      onNewShoe={vi.fn()}
      explainOn={true}
      onToggleExplain={onToggleExplain}
    />,
  );
  const btn = screen.getByRole("button", { name: "Explain" });
  expect(btn).toHaveAttribute("aria-pressed", "true");
  await userEvent.click(btn);
  expect(onToggleExplain).toHaveBeenCalledOnce();
});

test("multiplayer shows Ready instead of Deal, disabled with no bets", () => {
  render(
    <Controls
      snapshot={bettingSnapshot()}
      onDeal={vi.fn()}
      onNewShoe={vi.fn()}
      onSitOut={vi.fn()}
      onReady={vi.fn()}
      onUnready={vi.fn()}
      myReady={false}
    />,
  );
  expect(screen.queryByRole("button", { name: "Deal" })).toBeNull();
  const ready = screen.getByRole("button", { name: "Ready" });
  expect(ready).toBeDisabled();
});

test("Ready is enabled with a bet down and fires onReady", async () => {
  const onReady = vi.fn();
  render(
    <Controls
      snapshot={bettingSnapshot({ bets: [{ kind: { Main: "Player" }, amount: 500 }] })}
      onDeal={vi.fn()}
      onNewShoe={vi.fn()}
      onSitOut={vi.fn()}
      onReady={onReady}
      onUnready={vi.fn()}
      myReady={false}
    />,
  );
  const ready = screen.getByRole("button", { name: "Ready" });
  expect(ready).toBeEnabled();
  await userEvent.click(ready);
  expect(onReady).toHaveBeenCalledOnce();
});

test("once ready, the button reads Unready and fires onUnready", async () => {
  const onUnready = vi.fn();
  render(
    <Controls
      snapshot={bettingSnapshot({ bets: [{ kind: { Main: "Player" }, amount: 500 }] })}
      onDeal={vi.fn()}
      onNewShoe={vi.fn()}
      onSitOut={vi.fn()}
      onReady={vi.fn()}
      onUnready={onUnready}
      myReady={true}
    />,
  );
  const unready = screen.getByRole("button", { name: "Unready" });
  expect(unready).toBeEnabled();
  await userEvent.click(unready);
  expect(onUnready).toHaveBeenCalledOnce();
});

test("New shoe is disabled while a vote is open", () => {
  const voteOpen = bettingSnapshot({
    shoe: {
      number: 1,
      cut_card_out: false,
      cut_reason: null,
      cutter: null,
      last_cut: null,
      vote: { proposer: 0, yes: [0], no: [], needed: 2 },
    },
  });
  const { rerender } = render(<Controls snapshot={voteOpen} onDeal={vi.fn()} onNewShoe={vi.fn()} />);
  expect(screen.getByRole("button", { name: "New shoe" })).toBeDisabled();

  // no open vote, but not Betting either — still disabled
  rerender(<Controls snapshot={dealingSnapshot()} onDeal={vi.fn()} onNewShoe={vi.fn()} />);
  expect(screen.getByRole("button", { name: "New shoe" })).toBeDisabled();

  // Betting, no vote — enabled
  rerender(<Controls snapshot={bettingSnapshot()} onDeal={vi.fn()} onNewShoe={vi.fn()} />);
  expect(screen.getByRole("button", { name: "New shoe" })).toBeEnabled();
});

test("everything but explain and audio is disabled in ShoeCut", () => {
  render(
    <Controls
      snapshot={shoeCutSnapshot()}
      onDeal={vi.fn()}
      onRevealAll={vi.fn()}
      onSettle={vi.fn()}
      onNewShoe={vi.fn()}
      onSitOut={vi.fn()}
      onReady={vi.fn()}
      onUnready={vi.fn()}
      onWatch={vi.fn()}
      explainOn={false}
      onToggleExplain={vi.fn()}
    />,
  );
  for (const name of ["Ready", "Sit out", "Watch hand", "Reveal all", "Settle", "New shoe"]) {
    expect(screen.getByRole("button", { name })).toBeDisabled();
  }
  expect(screen.getByRole("button", { name: "Explain" })).toBeEnabled();
});

test("at the rail only Explain is offered — nothing there moves the game", () => {
  render(
    <Controls
      snapshot={bettingSnapshot({ bets: [{ kind: { Main: "Player" }, amount: 500 }] })}
      onDeal={vi.fn()}
      onSettle={vi.fn()}
      onNewShoe={vi.fn()}
      onSitOut={vi.fn()}
      onToggleExplain={vi.fn()}
      spectating
    />,
  );
  expect(screen.getByRole("button", { name: "Explain" })).toBeInTheDocument();
  expect(screen.getAllByRole("button")).toHaveLength(1);
});

test("at a live table the between-coups actions work straight from Settled — no Next hand", async () => {
  const onSitOut = vi.fn();
  const onNewShoe = vi.fn();
  const onReady = vi.fn();
  // a real settle clears the seat's bets; the fixture keeps them for the HUD
  render(
    <Controls
      snapshot={{ ...settledSnapshot(), bets: [] }}
      onDeal={vi.fn()}
      onSettle={vi.fn()}
      onNewShoe={onNewShoe}
      onSitOut={onSitOut}
      onReady={onReady}
      onUnready={vi.fn()}
    />,
  );
  expect(screen.queryByRole("button", { name: /Next/ })).toBeNull();
  await userEvent.click(screen.getByRole("button", { name: "Sit out" }));
  expect(onSitOut).toHaveBeenCalledOnce();
  await userEvent.click(screen.getByRole("button", { name: "New shoe" }));
  expect(onNewShoe).toHaveBeenCalledOnce();
  // Ready still needs chips down — the settle cleared them
  expect(screen.getByRole("button", { name: "Ready" })).toBeDisabled();
});

test("a solo table's Settled still waits for the auto-advance: Deal and New shoe stay off", () => {
  render(<Controls snapshot={settledSnapshot()} onDeal={vi.fn()} onRevealAll={vi.fn()} onNewShoe={vi.fn()} />);
  expect(screen.getByRole("button", { name: "Deal" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "New shoe" })).toBeDisabled();
});
