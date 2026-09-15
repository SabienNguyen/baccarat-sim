import { render, screen, fireEvent, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ShoeCutStage, SHOE_CUT_ANIM_MS } from "./ShoeCutStage";
import type { CutReveal, ShoeView } from "../engine/types";

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

function cutReveal(overrides: Partial<CutReveal> = {}): CutReveal {
  return {
    position: 600,
    turned: { rank: "Nine", suit: "Hearts" },
    burned: 3,
    ...overrides,
  };
}

test("renders nothing unless the phase is ShoeCut", () => {
  const { container } = render(
    <ShoeCutStage
      shoe={shoe()}
      phase="Betting"
      canCut
      onCut={vi.fn()}
      cutterName={null}
      animating={null}
      onAnimationEnd={vi.fn()}
    />,
  );
  expect(container).toBeEmptyDOMElement();
});

test("the cutter sees the cut card and Cut here is disabled until placed", () => {
  render(
    <ShoeCutStage
      shoe={shoe()}
      phase="ShoeCut"
      canCut
      onCut={vi.fn()}
      cutterName={null}
      animating={null}
      onAnimationEnd={vi.fn()}
    />,
  );
  expect(screen.getByLabelText("Cut card")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Cut here" })).toBeDisabled();
});

test("a pointer drag to 60% of the stack then Cut here calls onCut(600)", async () => {
  const onCut = vi.fn();
  render(
    <ShoeCutStage
      shoe={shoe()}
      phase="ShoeCut"
      canCut
      onCut={onCut}
      cutterName={null}
      animating={null}
      onAnimationEnd={vi.fn()}
    />,
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
    <ShoeCutStage
      shoe={shoe()}
      phase="ShoeCut"
      canCut
      onCut={onCut}
      cutterName={null}
      animating={null}
      onAnimationEnd={vi.fn()}
    />,
  );
  const cutCard = screen.getByLabelText("Cut card");
  cutCard.focus();
  await userEvent.keyboard("{End}");
  await userEvent.keyboard("{Enter}");
  expect(onCut).toHaveBeenCalledWith(950);
});

test("the confirm button uses the primary button styling", () => {
  render(
    <ShoeCutStage
      shoe={shoe()}
      phase="ShoeCut"
      canCut
      onCut={vi.fn()}
      cutterName={null}
      animating={null}
      onAnimationEnd={vi.fn()}
    />,
  );
  const confirm = screen.getByRole("button", { name: "Cut here" });
  expect(confirm.className.split(" ")).toEqual(
    expect.arrayContaining(["btn", "btn--primary", "shoe-cut-confirm"]),
  );
});

test("a waiting player can leave the table", async () => {
  const onLeave = vi.fn();
  const { rerender } = render(
    <ShoeCutStage
      shoe={shoe()}
      phase="ShoeCut"
      canCut={false}
      onCut={vi.fn()}
      cutterName="Alice"
      animating={null}
      onAnimationEnd={vi.fn()}
      onLeave={onLeave}
    />,
  );
  const leave = screen.getByRole("button", { name: "Leave table" });
  await userEvent.click(leave);
  expect(onLeave).toHaveBeenCalledOnce();

  rerender(
    <ShoeCutStage
      shoe={shoe()}
      phase="ShoeCut"
      canCut={false}
      onCut={vi.fn()}
      cutterName="Alice"
      animating={null}
      onAnimationEnd={vi.fn()}
    />,
  );
  expect(screen.queryByRole("button", { name: "Leave table" })).toBeNull();
});

test("a non-cutter sees the waiting copy and no cut card", () => {
  render(
    <ShoeCutStage
      shoe={shoe()}
      phase="ShoeCut"
      canCut={false}
      onCut={vi.fn()}
      cutterName="Alice"
      animating={null}
      onAnimationEnd={vi.fn()}
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
      animating={null}
      onAnimationEnd={vi.fn()}
    />,
  );
  expect(screen.getByText("The table voted for a new shoe.")).toBeInTheDocument();
});

describe("the reveal animation", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  test("stays mounted while animating and calls onAnimationEnd after 2600ms", () => {
    const onAnimationEnd = vi.fn();
    render(
      <ShoeCutStage
        shoe={shoe({ number: 3 })}
        phase="Betting"
        canCut={false}
        onCut={vi.fn()}
        cutterName={null}
        animating={cutReveal()}
        onAnimationEnd={onAnimationEnd}
      />,
    );
    expect(screen.getByRole("dialog", { name: "Shoe cut" })).toBeInTheDocument();
    expect(onAnimationEnd).not.toHaveBeenCalled();
    act(() => {
      vi.advanceTimersByTime(SHOE_CUT_ANIM_MS);
    });
    expect(onAnimationEnd).toHaveBeenCalledOnce();
  });

  test("the banner shows the new shoe number", () => {
    render(
      <ShoeCutStage
        shoe={shoe({ number: 7 })}
        phase="Betting"
        canCut={false}
        onCut={vi.fn()}
        cutterName={null}
        animating={cutReveal()}
        onAnimationEnd={vi.fn()}
      />,
    );
    expect(screen.queryByText("SHOE 7")).toBeNull();
    act(() => {
      vi.advanceTimersByTime(2200);
    });
    expect(screen.getByText("SHOE 7")).toBeInTheDocument();
  });

  test("the burn counter reaches the burned count", () => {
    render(
      <ShoeCutStage
        shoe={shoe()}
        phase="Betting"
        canCut={false}
        onCut={vi.fn()}
        cutterName={null}
        animating={cutReveal({ burned: 3 })}
        onAnimationEnd={vi.fn()}
      />,
    );
    act(() => {
      vi.advanceTimersByTime(2200);
    });
    expect(screen.getByText("Burned 3")).toBeInTheDocument();
  });

  test("reduced motion ends the animation immediately", () => {
    vi.spyOn(window, "matchMedia").mockReturnValue({
      matches: true,
      media: "(prefers-reduced-motion: reduce)",
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
      onchange: null,
    } as unknown as MediaQueryList);
    const onAnimationEnd = vi.fn();
    render(
      <ShoeCutStage
        shoe={shoe({ number: 5 })}
        phase="Betting"
        canCut={false}
        onCut={vi.fn()}
        cutterName={null}
        animating={cutReveal()}
        onAnimationEnd={onAnimationEnd}
      />,
    );
    expect(screen.getByText("SHOE 5")).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(0);
    });
    expect(onAnimationEnd).toHaveBeenCalledOnce();
  });

  test("the turned card is rendered face up", () => {
    render(
      <ShoeCutStage
        shoe={shoe()}
        phase="Betting"
        canCut={false}
        onCut={vi.fn()}
        cutterName={null}
        animating={cutReveal({ turned: { rank: "King", suit: "Spades" } })}
        onAnimationEnd={vi.fn()}
      />,
    );
    act(() => {
      vi.advanceTimersByTime(800);
    });
    const turned = screen.getByLabelText("Turned card");
    expect(turned.textContent).toContain("K");
  });
});
