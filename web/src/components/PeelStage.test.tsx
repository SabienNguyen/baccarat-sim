import { render, screen } from "@testing-library/react";
import { PeelStage } from "./PeelStage";
import { dealingSnapshot } from "../test/fixtures";

function stageHands() {
  const snap = dealingSnapshot();
  return {
    snapshot: snap,
    player: {
      hand: snap.player,
      visibleCount: snap.player.cards.length,
      winner: false,
      squeezable: true,
      onPeek: vi.fn(),
      onReveal: vi.fn(),
    },
    banker: {
      hand: snap.banker,
      visibleCount: snap.banker.cards.length,
      winner: false,
      squeezable: false,
      onPeek: vi.fn(),
      onReveal: vi.fn(),
    },
  };
}

test("renders the compact dealer line and both hands", () => {
  const { snapshot, player, banker } = stageHands();
  render(<PeelStage snapshot={snapshot} player={player} banker={banker} />);
  expect(screen.getByLabelText("Dealer")).toHaveClass("dealer-line--compact");
  expect(screen.getByLabelText("Player hand")).toBeInTheDocument();
  expect(screen.getByLabelText("Banker hand")).toBeInTheDocument();
});

test("renders as an overlay: a backdrop is present alongside the hands", () => {
  const { snapshot, player, banker } = stageHands();
  const { container } = render(<PeelStage snapshot={snapshot} player={player} banker={banker} />);
  expect(container.querySelector(".peel-backdrop")).not.toBeNull();
});

test("starts without the visible class, then flips to it (the entrance fade/scale)", async () => {
  const { snapshot, player, banker } = stageHands();
  const { container } = render(<PeelStage snapshot={snapshot} player={player} banker={banker} />);
  const stage = container.querySelector(".peel-stage")!;
  await vi.waitFor(() => expect(stage).toHaveClass("peel-stage--visible"));
});

test("a leaving stage carries the leaving class instead of the visible one", () => {
  const { snapshot, player, banker } = stageHands();
  const { container } = render(
    <PeelStage snapshot={snapshot} player={player} banker={banker} leaving />,
  );
  const stage = container.querySelector(".peel-stage")!;
  expect(stage).toHaveClass("peel-stage--leaving");
  expect(stage).not.toHaveClass("peel-stage--visible");
});

test("locks scroll on body and html while mounted, restores both on unmount", () => {
  const prevBody = document.body.style.overflow;
  const prevHtml = document.documentElement.style.overflow;
  document.body.style.overflow = "auto";
  document.documentElement.style.overflow = "auto";
  const { snapshot, player, banker } = stageHands();
  const { unmount } = render(<PeelStage snapshot={snapshot} player={player} banker={banker} />);
  expect(document.body.style.overflow).toBe("hidden");
  expect(document.documentElement.style.overflow).toBe("hidden");
  unmount();
  expect(document.body.style.overflow).toBe("auto");
  expect(document.documentElement.style.overflow).toBe("auto");
  document.body.style.overflow = prevBody;
  document.documentElement.style.overflow = prevHtml;
});

test("a 2-card hand never triggers the tighter 3-card step", () => {
  const { snapshot, player, banker } = stageHands();
  const { container } = render(<PeelStage snapshot={snapshot} player={player} banker={banker} />);
  expect(container.querySelector(".peel-stage")).toHaveAttribute("data-cards", "2");
});

test("a hand showing three cards switches the stage to the tighter step", () => {
  const { snapshot, player, banker } = stageHands();
  const threeCard = {
    ...player,
    hand: { ...player.hand, cards: [...player.hand.cards, { FaceUp: { rank: "Two", suit: "Clubs" } as const }] },
    visibleCount: 3,
  };
  const { container } = render(
    <PeelStage snapshot={snapshot} player={threeCard} banker={banker} />,
  );
  expect(container.querySelector(".peel-stage")).toHaveAttribute("data-cards", "3");
});
