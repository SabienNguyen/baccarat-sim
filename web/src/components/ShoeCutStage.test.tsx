import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ShoeCutStage } from "./ShoeCutStage";
import type { ShoeView } from "../engine/types";

function shoe(overrides: Partial<ShoeView> = {}): ShoeView {
  return {
    number: 0,
    cut_card_out: false,
    cut_reason: "NewTable",
    cutter: null,
    last_cut: null,
    vote: null,
    ...overrides,
  };
}

test("renders nothing unless the phase is ShoeCut", () => {
  const { container } = render(
    <ShoeCutStage shoe={shoe()} phase="Betting" canCut onCut={vi.fn()} cutterName={null} />,
  );
  expect(container).toBeEmptyDOMElement();
});

test("the cutter sees the cut card and Cut here is disabled until placed", () => {
  render(
    <ShoeCutStage shoe={shoe()} phase="ShoeCut" canCut onCut={vi.fn()} cutterName={null} />,
  );
  expect(screen.getByLabelText("Cut card")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Cut here" })).toBeDisabled();
});

test("a pointer drag to 60% of the stack then Cut here calls onCut(600)", async () => {
  const onCut = vi.fn();
  render(
    <ShoeCutStage shoe={shoe()} phase="ShoeCut" canCut onCut={onCut} cutterName={null} />,
  );
  const stack = screen.getByLabelText("Shoe");
  vi.spyOn(stack, "getBoundingClientRect").mockReturnValue({
    left: 0,
    right: 1000,
    top: 0,
    bottom: 96,
    width: 1000,
    height: 96,
    x: 0,
    y: 0,
    toJSON: () => {},
  });
  Object.defineProperty(stack, "setPointerCapture", {
    value: vi.fn(),
    writable: true,
  });
  fireEvent.pointerDown(stack, { clientX: 600, pointerId: 1 });
  fireEvent.pointerMove(stack, { clientX: 600, pointerId: 1 });
  fireEvent.pointerUp(stack, { clientX: 600, pointerId: 1 });
  const confirm = screen.getByRole("button", { name: "Cut here" });
  expect(confirm).toBeEnabled();
  await userEvent.click(confirm);
  expect(onCut).toHaveBeenCalledWith(600);
});

test("keyboard End then Enter calls onCut(950)", async () => {
  const onCut = vi.fn();
  render(
    <ShoeCutStage shoe={shoe()} phase="ShoeCut" canCut onCut={onCut} cutterName={null} />,
  );
  const cutCard = screen.getByLabelText("Cut card");
  cutCard.focus();
  await userEvent.keyboard("{End}");
  await userEvent.keyboard("{Enter}");
  expect(onCut).toHaveBeenCalledWith(950);
});

test("a non-cutter sees the waiting copy and no cut card", () => {
  render(
    <ShoeCutStage
      shoe={shoe()}
      phase="ShoeCut"
      canCut={false}
      onCut={vi.fn()}
      cutterName="Alice"
    />,
  );
  expect(screen.getByText("Waiting for Alice to cut the shoe")).toBeInTheDocument();
  expect(screen.queryByLabelText("Cut card")).toBeNull();
  expect(screen.queryByRole("button", { name: "Cut here" })).toBeNull();
});

test("the reason copy follows shoe.cut_reason", () => {
  render(
    <ShoeCutStage
      shoe={shoe({ cut_reason: "Vote" })}
      phase="ShoeCut"
      canCut
      onCut={vi.fn()}
      cutterName={null}
    />,
  );
  expect(screen.getByText("The table voted for a new shoe.")).toBeInTheDocument();
});
