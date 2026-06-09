# Squeeze & Card Rendering Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the foundation's per-card "Reveal" buttons with the signature drag-to-squeeze interaction on real (CSS-drawn) cards — bend the corner to expose the suit sliver (`peek`), drag past a threshold or release to flip (`reveal`).

**Architecture:** A pure `squeeze.ts` threshold helper and a `cards.ts` view helper underpin two new presentational components: `Card` (renders a `CardView` as a real card) and `SqueezeCard` (pointer-drag + click/keyboard fallback dispatching `onPeek`/`onReveal`). `Hand` renders Dealing-phase cards as `SqueezeCard`s wired to the store; `Controls` drops per-card buttons for a single "Reveal all"; `App` wires it. The drag is transient UI state — only `peek`/`reveal` commands cross to the engine.

**Tech Stack:** React 18, TypeScript (strict), Vitest, @testing-library/react, @testing-library/user-event. (Same `web/` workspace as Web Plan 1.)

**Spec:** `docs/superpowers/specs/2026-06-08-squeeze-cards-design.md`

---

## Conventions & gotchas (read once)

- **Absolute paths in shells.** Always `cd /home/sabien/Dev/personal/baccarat-simulator` (or `web/`) first.
- **No wasm in any test here** — all components are presentational/props-driven, tested against fixtures (`web/src/test/fixtures.ts`: `bettingSnapshot`, `dealingSnapshot`, `settledSnapshot`, `scoredSnapshot`).
- **jsdom has no layout.** `getBoundingClientRect()` returns zeros in jsdom, so `SqueezeCard` computes drag progress purely from pointer `clientY` and a constant `DRAG_DISTANCE_PX` — never from element size. Pointer-capture may be absent in jsdom, so call `setPointerCapture` with optional chaining.
- **Engine `peek`/`reveal` are Dealing-only, any index, any order, idempotent, no downgrade.** The UI just paces them; it adds no rules.
- Each task ends green: `npm --workspace web run typecheck` and `npm --workspace web test` pass.
- Run a single test file with: `npm --workspace web test -- <name>` (e.g. `-- squeeze`).

---

## Task 1: `squeeze.ts` — pure threshold helper

**Files:**
- Create: `web/src/squeeze.ts`
- Test: `web/src/squeeze.test.ts`

- [ ] **Step 1: Failing test**

Create `web/src/squeeze.test.ts`:
```ts
import { actionForProgress, PEEK_AT, REVEAL_AT } from "./squeeze";

test("below the peek threshold does nothing", () => {
  expect(actionForProgress(0)).toBe("none");
  expect(actionForProgress(PEEK_AT - 0.01)).toBe("none");
});

test("at or above the peek threshold peeks", () => {
  expect(actionForProgress(PEEK_AT)).toBe("peek");
  expect(actionForProgress(REVEAL_AT - 0.01)).toBe("peek");
});

test("at or above the reveal threshold reveals", () => {
  expect(actionForProgress(REVEAL_AT)).toBe("reveal");
  expect(actionForProgress(1)).toBe("reveal");
});

test("thresholds are ordered sanely", () => {
  expect(PEEK_AT).toBeGreaterThan(0);
  expect(REVEAL_AT).toBeGreaterThan(PEEK_AT);
  expect(REVEAL_AT).toBeLessThanOrEqual(1);
});
```

- [ ] **Step 2: Verify it fails**

Run: `cd /home/sabien/Dev/personal/baccarat-simulator && npm --workspace web test -- squeeze 2>&1 | tail -10`
Expected: FAIL — cannot find `./squeeze`.

- [ ] **Step 3: Implement**

Create `web/src/squeeze.ts`:
```ts
export type SqueezeAction = "none" | "peek" | "reveal";

/** Drag progress (0..1) at which only the suit sliver shows. */
export const PEEK_AT = 0.25;
/** Drag progress (0..1) at which the card flips fully face-up. */
export const REVEAL_AT = 0.7;

/** Map a drag progress (0..1) to the action that should fire at that progress. */
export function actionForProgress(progress: number): SqueezeAction {
  if (progress >= REVEAL_AT) return "reveal";
  if (progress >= PEEK_AT) return "peek";
  return "none";
}
```

- [ ] **Step 4: Verify it passes**

Run: `cd /home/sabien/Dev/personal/baccarat-simulator && npm --workspace web test -- squeeze 2>&1 | tail -10`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
cd /home/sabien/Dev/personal/baccarat-simulator
git add web/src/squeeze.ts web/src/squeeze.test.ts
git commit -m "feat(web): pure squeeze threshold helper

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: `cards.ts` — view helpers (`isFaceUp`, `hiddenIndices`)

Shared helpers so the reveal-all logic is DRY (spec open item 7.3). Replaces the `hiddenIndices` currently inlined in `Controls`.

**Files:**
- Create: `web/src/cards.ts`
- Test: `web/src/cards.test.ts`

- [ ] **Step 1: Failing test**

Create `web/src/cards.test.ts`:
```ts
import { isFaceUp, hiddenIndices } from "./cards";
import type { CardView } from "./engine/types";

const faceUp: CardView = { FaceUp: { rank: "Nine", suit: "Hearts" } };
const peeked: CardView = { Peeked: { sliver: { suit: "Spades" } } };

test("isFaceUp only for FaceUp cards", () => {
  expect(isFaceUp(faceUp)).toBe(true);
  expect(isFaceUp(peeked)).toBe(false);
  expect(isFaceUp("FaceDown")).toBe(false);
});

test("hiddenIndices returns indices of non-face-up cards", () => {
  expect(hiddenIndices([faceUp, peeked, "FaceDown"])).toEqual([1, 2]);
  expect(hiddenIndices([faceUp, faceUp])).toEqual([]);
});
```

- [ ] **Step 2: Verify it fails**

Run: `cd /home/sabien/Dev/personal/baccarat-simulator && npm --workspace web test -- cards 2>&1 | tail -10`
Expected: FAIL — cannot find `./cards`.

- [ ] **Step 3: Implement**

Create `web/src/cards.ts`:
```ts
import type { CardView } from "./engine/types";

/** True only when a card is fully revealed (face-up). */
export function isFaceUp(card: CardView): boolean {
  return card !== "FaceDown" && typeof card === "object" && "FaceUp" in card;
}

/** Indices of cards in a hand that are not yet fully face-up (face-down or peeked). */
export function hiddenIndices(cards: CardView[]): number[] {
  const out: number[] = [];
  cards.forEach((card, i) => {
    if (!isFaceUp(card)) out.push(i);
  });
  return out;
}
```

- [ ] **Step 4: Verify it passes**

Run: `cd /home/sabien/Dev/personal/baccarat-simulator && npm --workspace web test -- cards 2>&1 | tail -10`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
cd /home/sabien/Dev/personal/baccarat-simulator
git add web/src/cards.ts web/src/cards.test.ts
git commit -m "feat(web): shared card view helpers (isFaceUp, hiddenIndices)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: `Card` component + minimal card CSS

**Files:**
- Create: `web/src/components/Card.tsx`
- Create: `web/src/components/cards.css`
- Test: `web/src/components/Card.test.tsx`

- [ ] **Step 1: Failing test**

Create `web/src/components/Card.test.tsx`:
```tsx
import { render, screen } from "@testing-library/react";
import { Card } from "./Card";
import type { CardView } from "../engine/types";

test("renders a face-down back", () => {
  render(<Card card="FaceDown" />);
  expect(screen.getByLabelText("face-down card")).toBeInTheDocument();
});

test("renders a peeked card showing only the suit sliver", () => {
  const card: CardView = { Peeked: { sliver: { suit: "Spades" } } };
  render(<Card card={card} />);
  expect(screen.getByLabelText("peeked card, Spades")).toBeInTheDocument();
  expect(screen.getByText("♠")).toBeInTheDocument();
  // the rank is NOT shown while peeked (only the suit sliver)
  expect(screen.queryByText(/^(A|[2-9]|10|J|Q|K)$/)).not.toBeInTheDocument();
});

test("renders a face-up card with rank, suit, and color", () => {
  const card: CardView = { FaceUp: { rank: "Nine", suit: "Hearts" } };
  render(<Card card={card} />);
  const face = screen.getByLabelText("Nine of Hearts");
  expect(face).toBeInTheDocument();
  expect(face).toHaveAttribute("data-color", "red");
  expect(screen.getByText("9")).toBeInTheDocument();
  expect(screen.getByText("♥")).toBeInTheDocument();
});

test("a black suit is colored black", () => {
  const card: CardView = { FaceUp: { rank: "King", suit: "Clubs" } };
  render(<Card card={card} />);
  expect(screen.getByLabelText("King of Clubs")).toHaveAttribute("data-color", "black");
});
```

- [ ] **Step 2: Verify it fails**

Run: `cd /home/sabien/Dev/personal/baccarat-simulator && npm --workspace web test -- Card 2>&1 | tail -10`
Expected: FAIL — cannot find `./Card`.

- [ ] **Step 3: Minimal CSS**

Create `web/src/components/cards.css`:
```css
.card {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 48px;
  height: 72px;
  border: 2px solid #222;
  border-radius: 6px;
  margin: 2px;
  font-weight: bold;
  user-select: none;
  position: relative;
  transition: transform 120ms ease;
}
.card-back {
  background: repeating-linear-gradient(45deg, #334, #334 4px, #445 4px, #445 8px);
}
.card-face {
  background: #fefefe;
  flex-direction: column;
}
.card-face[data-color="red"],
.card-sliver[data-color="red"] {
  color: #c0202a;
}
.card-face[data-color="black"],
.card-sliver[data-color="black"] {
  color: #111;
}
.card-sliver {
  position: absolute;
  top: 2px;
  left: 2px;
  background: #fefefe;
  padding: 1px 3px;
  font-size: 12px;
  line-height: 1;
}
.card-rank {
  font-size: 18px;
}
.card-suit {
  font-size: 16px;
}
```

- [ ] **Step 4: Implement Card**

Create `web/src/components/Card.tsx`:
```tsx
import type { CardView, Rank, Suit } from "../engine/types";
import "./cards.css";

const RANK_SHORT: Record<Rank, string> = {
  Ace: "A",
  Two: "2",
  Three: "3",
  Four: "4",
  Five: "5",
  Six: "6",
  Seven: "7",
  Eight: "8",
  Nine: "9",
  Ten: "10",
  Jack: "J",
  Queen: "Q",
  King: "K",
};

const SUIT_GLYPH: Record<Suit, string> = {
  Clubs: "♣",
  Diamonds: "♦",
  Hearts: "♥",
  Spades: "♠",
};

function suitColor(suit: Suit): "red" | "black" {
  return suit === "Hearts" || suit === "Diamonds" ? "red" : "black";
}

interface CardProps {
  card: CardView;
  /** 0..1 corner-bend progress, used only in the peeked state. */
  bend?: number;
}

export function Card({ card, bend = 0 }: CardProps) {
  if (card === "FaceDown") {
    return <div className="card card-back" aria-label="face-down card" />;
  }

  if ("Peeked" in card) {
    const suit = card.Peeked.sliver.suit;
    const corner = `${Math.round(20 + bend * 60)}%`;
    return (
      <div className="card card-back" aria-label={`peeked card, ${suit}`}>
        <span
          className="card-sliver"
          data-color={suitColor(suit)}
          style={{ clipPath: `polygon(0 0, ${corner} 0, 0 ${corner})` }}
        >
          {SUIT_GLYPH[suit]}
        </span>
      </div>
    );
  }

  const { rank, suit } = card.FaceUp;
  return (
    <div className="card card-face" aria-label={`${rank} of ${suit}`} data-color={suitColor(suit)}>
      <span className="card-rank">{RANK_SHORT[rank]}</span>
      <span className="card-suit">{SUIT_GLYPH[suit]}</span>
    </div>
  );
}
```

- [ ] **Step 5: Verify it passes**

Run: `cd /home/sabien/Dev/personal/baccarat-simulator && npm --workspace web test -- Card 2>&1 | tail -10`
Expected: PASS (4 tests).

- [ ] **Step 6: Commit**

```bash
cd /home/sabien/Dev/personal/baccarat-simulator
git add web/src/components/Card.tsx web/src/components/cards.css web/src/components/Card.test.tsx
git commit -m "feat(web): Card component rendering CardView (back/peeked-sliver/face)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4: `SqueezeCard` component (drag + click fallback)

**Files:**
- Create: `web/src/components/SqueezeCard.tsx`
- Test: `web/src/components/SqueezeCard.test.tsx`

- [ ] **Step 1: Failing test**

Create `web/src/components/SqueezeCard.test.tsx`:
```tsx
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SqueezeCard } from "./SqueezeCard";
import type { CardView } from "../engine/types";

const faceDown: CardView = "FaceDown";
const peeked: CardView = { Peeked: { sliver: { suit: "Spades" } } };
const faceUp: CardView = { FaceUp: { rank: "Nine", suit: "Hearts" } };

test("click fallback: a face-down card peeks", async () => {
  const onPeek = vi.fn();
  const onReveal = vi.fn();
  render(<SqueezeCard card={faceDown} onPeek={onPeek} onReveal={onReveal} />);
  await userEvent.click(screen.getByLabelText("face-down card"));
  expect(onPeek).toHaveBeenCalledOnce();
  expect(onReveal).not.toHaveBeenCalled();
});

test("click fallback: a peeked card reveals", async () => {
  const onPeek = vi.fn();
  const onReveal = vi.fn();
  render(<SqueezeCard card={peeked} onPeek={onPeek} onReveal={onReveal} />);
  await userEvent.click(screen.getByLabelText("peeked card, Spades"));
  expect(onReveal).toHaveBeenCalledOnce();
});

test("drag: crossing the peek threshold peeks, crossing reveal threshold reveals", () => {
  const onPeek = vi.fn();
  const onReveal = vi.fn();
  render(<SqueezeCard card={faceDown} onPeek={onPeek} onReveal={onReveal} />);
  const el = screen.getByRole("button");
  // start at y=300; DRAG_DISTANCE_PX=120. Move up 36px -> progress 0.30 (>=0.25 peek)
  fireEvent.pointerDown(el, { pointerId: 1, clientY: 300 });
  fireEvent.pointerMove(el, { pointerId: 1, clientY: 264 });
  expect(onPeek).toHaveBeenCalledOnce();
  expect(onReveal).not.toHaveBeenCalled();
  // move up 96px from start -> progress 0.80 (>=0.7 reveal)
  fireEvent.pointerMove(el, { pointerId: 1, clientY: 204 });
  expect(onReveal).toHaveBeenCalledOnce();
});

test("drag: releasing after a started peek commits the reveal", () => {
  const onPeek = vi.fn();
  const onReveal = vi.fn();
  render(<SqueezeCard card={faceDown} onPeek={onPeek} onReveal={onReveal} />);
  const el = screen.getByRole("button");
  fireEvent.pointerDown(el, { pointerId: 1, clientY: 300 });
  fireEvent.pointerMove(el, { pointerId: 1, clientY: 264 }); // 0.30 -> peek
  fireEvent.pointerUp(el, { pointerId: 1, clientY: 264 }); // release past peek -> reveal
  expect(onPeek).toHaveBeenCalledOnce();
  expect(onReveal).toHaveBeenCalledOnce();
});

test("a face-up card ignores interaction", async () => {
  const onPeek = vi.fn();
  const onReveal = vi.fn();
  render(<SqueezeCard card={faceUp} onPeek={onPeek} onReveal={onReveal} />);
  await userEvent.click(screen.getByLabelText("Nine of Hearts"));
  expect(onPeek).not.toHaveBeenCalled();
  expect(onReveal).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Verify it fails**

Run: `cd /home/sabien/Dev/personal/baccarat-simulator && npm --workspace web test -- SqueezeCard 2>&1 | tail -12`
Expected: FAIL — cannot find `./SqueezeCard`.

- [ ] **Step 3: Implement SqueezeCard**

Create `web/src/components/SqueezeCard.tsx`:
```tsx
import { useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent, KeyboardEvent as ReactKeyboardEvent } from "react";
import type { CardView } from "../engine/types";
import { Card } from "./Card";
import { isFaceUp } from "../cards";
import { actionForProgress, PEEK_AT } from "../squeeze";

const DRAG_DISTANCE_PX = 120;

interface SqueezeCardProps {
  card: CardView;
  onPeek: () => void;
  onReveal: () => void;
}

function isPeeked(card: CardView): boolean {
  return card !== "FaceDown" && typeof card === "object" && "Peeked" in card;
}

export function SqueezeCard({ card, onPeek, onReveal }: SqueezeCardProps) {
  const [bend, setBend] = useState(0);
  const startY = useRef<number | null>(null);
  const peekedThisGesture = useRef(false);
  const revealedThisGesture = useRef(false);

  const faceUp = isFaceUp(card);

  function progressFrom(clientY: number): number {
    if (startY.current === null) return 0;
    return Math.min(Math.max((startY.current - clientY) / DRAG_DISTANCE_PX, 0), 1);
  }

  function handlePointerDown(e: ReactPointerEvent) {
    if (faceUp) return;
    startY.current = e.clientY;
    peekedThisGesture.current = false;
    revealedThisGesture.current = false;
    e.currentTarget.setPointerCapture?.(e.pointerId);
  }

  function handlePointerMove(e: ReactPointerEvent) {
    if (faceUp || startY.current === null) return;
    const progress = progressFrom(e.clientY);
    setBend(progress);
    const action = actionForProgress(progress);
    if (action === "peek" && !peekedThisGesture.current) {
      peekedThisGesture.current = true;
      if (!isPeeked(card)) onPeek();
    }
    if (action === "reveal" && !revealedThisGesture.current) {
      revealedThisGesture.current = true;
      onReveal();
    }
  }

  function handlePointerUp(e: ReactPointerEvent) {
    if (faceUp || startY.current === null) return;
    const progress = progressFrom(e.clientY);
    startY.current = null;
    if (!revealedThisGesture.current && progress >= PEEK_AT) {
      revealedThisGesture.current = true;
      onReveal();
    }
    setBend(0);
  }

  function advanceOneStep() {
    if (faceUp) return;
    if (isPeeked(card)) onReveal();
    else onPeek();
  }

  function handleClick() {
    // Only treat as a tap when no drag gesture is in progress.
    if (startY.current !== null) return;
    advanceOneStep();
  }

  function handleKeyDown(e: ReactKeyboardEvent) {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      advanceOneStep();
    }
  }

  return (
    <div
      role="button"
      tabIndex={faceUp ? -1 : 0}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
    >
      <Card card={card} bend={bend} />
    </div>
  );
}
```
NOTE on the click fallback vs. pointer events: a real tap dispatches pointerdown → pointerup → click. `handlePointerUp` sets `startY.current = null` (and, with progress 0 from no movement, does NOT reveal), so by the time `handleClick` runs, `startY.current === null` and `advanceOneStep()` fires the single peek/reveal. The explicit `fireEvent.pointer*` drag tests never dispatch a click, so they exercise only the drag path. This keeps tap = one step and drag = threshold-driven, with no double-firing.

- [ ] **Step 4: Verify it passes**

Run: `cd /home/sabien/Dev/personal/baccarat-simulator && npm --workspace web test -- SqueezeCard 2>&1 | tail -15`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
cd /home/sabien/Dev/personal/baccarat-simulator
git add web/src/components/SqueezeCard.tsx web/src/components/SqueezeCard.test.tsx
git commit -m "feat(web): SqueezeCard — drag-to-reveal with click/keyboard fallback

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 5: Modify `Hand` to render Dealing cards as `SqueezeCard`s

**Files:**
- Modify: `web/src/components/Hand.tsx` (full rewrite below)
- Modify: `web/src/components/Hand.test.tsx` (full rewrite below)

- [ ] **Step 1: Rewrite the Hand test**

Overwrite `web/src/components/Hand.test.tsx`:
```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Hand } from "./Hand";
import { dealingSnapshot, settledSnapshot } from "../test/fixtures";

test("in Dealing, renders cards and a peeked card reveals at its index", async () => {
  const onPeek = vi.fn();
  const onReveal = vi.fn();
  render(
    <Hand
      side="Player"
      hand={dealingSnapshot().player}
      phase="Dealing"
      onPeek={onPeek}
      onReveal={onReveal}
    />,
  );
  // dealing player hand: [FaceUp Nine Hearts, Peeked Spades]
  expect(screen.getByLabelText("Nine of Hearts")).toBeInTheDocument();
  await userEvent.click(screen.getByLabelText("peeked card, Spades"));
  expect(onReveal).toHaveBeenCalledWith(1);
});

test("in Settled, renders static cards and shows the total", () => {
  render(<Hand side="Player" hand={settledSnapshot().player} phase="Settled" />);
  expect(screen.getByLabelText("Four of Clubs")).toBeInTheDocument();
  expect(screen.getByText("Total: 9")).toBeInTheDocument();
});

test("hides the total until every card is face up", () => {
  render(<Hand side="Player" hand={dealingSnapshot().player} phase="Dealing" />);
  expect(screen.queryByText(/Total:/)).not.toBeInTheDocument();
});
```

- [ ] **Step 2: Verify it fails**

Run: `cd /home/sabien/Dev/personal/baccarat-simulator && npm --workspace web test -- Hand 2>&1 | tail -12`
Expected: FAIL — current `Hand` takes only `{ side, hand }`, renders text not cards, and has no `phase`/`onPeek`/`onReveal`; the new assertions (and TS) fail.

- [ ] **Step 3: Rewrite Hand**

Overwrite `web/src/components/Hand.tsx`:
```tsx
import type { Side, HandView, PhaseTag } from "../engine/types";
import { Card } from "./Card";
import { SqueezeCard } from "./SqueezeCard";

interface HandProps {
  side: Side;
  hand: HandView;
  phase: PhaseTag;
  onPeek?: (index: number) => void;
  onReveal?: (index: number) => void;
}

export function Hand({ side, hand, phase, onPeek, onReveal }: HandProps) {
  const dealing = phase === "Dealing";
  return (
    <div aria-label={`${side} hand`}>
      <h3>{side}</h3>
      <ul>
        {hand.cards.map((card, i) => (
          <li key={i}>
            {dealing ? (
              <SqueezeCard
                card={card}
                onPeek={() => onPeek?.(i)}
                onReveal={() => onReveal?.(i)}
              />
            ) : (
              <Card card={card} />
            )}
          </li>
        ))}
      </ul>
      {hand.total !== null && <p>Total: {hand.total}</p>}
    </div>
  );
}
```

- [ ] **Step 4: Verify it passes**

Run: `cd /home/sabien/Dev/personal/baccarat-simulator && npm --workspace web test -- Hand 2>&1 | tail -12`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
cd /home/sabien/Dev/personal/baccarat-simulator
git add web/src/components/Hand.tsx web/src/components/Hand.test.tsx
git commit -m "feat(web): Hand renders Dealing cards as SqueezeCards

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 6: Modify `Controls` — drop per-card buttons, add "Reveal all"

**Files:**
- Modify: `web/src/components/Controls.tsx` (full rewrite below)
- Modify: `web/src/components/Controls.test.tsx` (full rewrite below)

- [ ] **Step 1: Rewrite the Controls test**

Overwrite `web/src/components/Controls.test.tsx`:
```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Controls } from "./Controls";
import { bettingSnapshot, dealingSnapshot } from "../test/fixtures";

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

test("Settle is enabled in Dealing; no per-card Reveal buttons exist", () => {
  render(
    <Controls
      snapshot={dealingSnapshot()}
      onDeal={vi.fn()}
      onRevealAll={vi.fn()}
      onSettle={vi.fn()}
      onNewShoe={vi.fn()}
    />,
  );
  expect(screen.getByRole("button", { name: "Settle" })).toBeEnabled();
  expect(screen.queryByRole("button", { name: /^Reveal (Player|Banker) / })).toBeNull();
});
```

- [ ] **Step 2: Verify it fails**

Run: `cd /home/sabien/Dev/personal/baccarat-simulator && npm --workspace web test -- Controls 2>&1 | tail -12`
Expected: FAIL — current `Controls` has `onReveal` (not `onRevealAll`) and renders per-card buttons; new props/assertions fail.

- [ ] **Step 3: Rewrite Controls**

Overwrite `web/src/components/Controls.tsx`:
```tsx
import type { RoundSnapshot } from "../engine/types";

interface ControlsProps {
  snapshot: RoundSnapshot;
  onDeal: () => void;
  onRevealAll: () => void;
  onSettle: () => void;
  onNewShoe: () => void;
}

export function Controls({
  snapshot,
  onDeal,
  onRevealAll,
  onSettle,
  onNewShoe,
}: ControlsProps) {
  const betting = snapshot.phase === "Betting";
  const dealing = snapshot.phase === "Dealing";
  const hasBets = snapshot.bets.length > 0;

  return (
    <section aria-label="Controls">
      <button type="button" disabled={!betting || !hasBets} onClick={onDeal}>
        Deal
      </button>
      <button type="button" disabled={!dealing} onClick={onRevealAll}>
        Reveal all
      </button>
      <button type="button" disabled={!dealing} onClick={onSettle}>
        Settle
      </button>
      <button type="button" onClick={onNewShoe}>
        New Shoe
      </button>
    </section>
  );
}
```

- [ ] **Step 4: Verify it passes**

Run: `cd /home/sabien/Dev/personal/baccarat-simulator && npm --workspace web test -- Controls 2>&1 | tail -12`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
cd /home/sabien/Dev/personal/baccarat-simulator
git add web/src/components/Controls.tsx web/src/components/Controls.test.tsx
git commit -m "feat(web): Controls drops per-card reveals for a single Reveal all

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 7: Wire `App` (phase + peek/reveal + reveal-all) and verify end-to-end

**Files:**
- Modify: `web/src/App.tsx` (full rewrite below)
- Modify: `web/src/App.test.tsx` (full rewrite below)

- [ ] **Step 1: Rewrite the App test (mount + Dealing wiring)**

Overwrite `web/src/App.test.tsx`:
```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { App } from "./App";
import { createGameStore } from "./store/gameStore";
import type { GameSession, CommandResult } from "./engine/adapter";
import type { RoundSnapshot } from "./engine/types";
import { bettingSnapshot, dealingSnapshot } from "./test/fixtures";

function okResult(snap: RoundSnapshot): CommandResult {
  return { ok: true, snapshot: snap };
}

function fakeSession(initial: RoundSnapshot, spies: Partial<GameSession> = {}): GameSession {
  const ok = okResult(initial);
  return {
    snapshot: () => initial,
    placeBet: () => ok,
    clearBets: () => ok,
    deal: () => ok,
    peek: () => ok,
    reveal: () => ok,
    settle: () => ok,
    newShoe: () => ok,
    ...spies,
  };
}

test("mounts the composed table with its core regions", () => {
  const store = createGameStore(fakeSession(bettingSnapshot()));
  render(<App store={store} />);
  expect(screen.getByRole("heading", { name: "Baccarat Simulator" })).toBeInTheDocument();
  expect(screen.getByLabelText("HUD")).toBeInTheDocument();
  expect(screen.getByLabelText("Bet rail")).toBeInTheDocument();
  expect(screen.getByLabelText("Scoreboard")).toBeInTheDocument();
  expect(screen.getByLabelText("Player hand")).toBeInTheDocument();
  expect(screen.getByLabelText("Banker hand")).toBeInTheDocument();
});

test("in Dealing, clicking a face-down card peeks it at (side, index)", async () => {
  const peek = vi.fn(() => okResult(dealingSnapshot()));
  const store = createGameStore(fakeSession(dealingSnapshot(), { peek }));
  render(<App store={store} />);
  // dealing banker hand: [FaceDown, FaceDown]
  const faceDowns = screen.getAllByLabelText("face-down card");
  await userEvent.click(faceDowns[0]);
  expect(peek).toHaveBeenCalledWith("Banker", 0);
});

test("Reveal all reveals every hidden card in both hands", async () => {
  const reveal = vi.fn(() => okResult(dealingSnapshot()));
  const store = createGameStore(fakeSession(dealingSnapshot(), { reveal }));
  render(<App store={store} />);
  await userEvent.click(screen.getByRole("button", { name: "Reveal all" }));
  // dealing snapshot hidden: Player [1] (peeked) + Banker [0,1] (face-down) = 3
  expect(reveal).toHaveBeenCalledTimes(3);
  expect(reveal).toHaveBeenCalledWith("Player", 1);
  expect(reveal).toHaveBeenCalledWith("Banker", 0);
  expect(reveal).toHaveBeenCalledWith("Banker", 1);
});
```
(Note: `dealingSnapshot()` has Player `[FaceUp Nine, Peeked Spades]` and Banker `[FaceDown, FaceDown]`. The first `face-down card` in document order is Banker index 0, since Player has none face-down — Player's hidden card is the Peeked one. That's why the peek test asserts `("Banker", 0)`.)

- [ ] **Step 2: Verify it fails**

Run: `cd /home/sabien/Dev/personal/baccarat-simulator && npm --workspace web test -- App 2>&1 | tail -15`
Expected: FAIL — current `App` passes `<Hand side hand>` (no phase/peek/reveal) and `Controls onReveal`; the Dealing wiring assertions and TS fail.

- [ ] **Step 3: Rewrite App**

Overwrite `web/src/App.tsx`:
```tsx
import { useStore } from "zustand";
import type { StoreApi } from "zustand/vanilla";
import { type GameState } from "./store/gameStore";
import { defaultStore } from "./store/useGameStore";
import { hiddenIndices } from "./cards";
import { Hud } from "./components/Hud";
import { Hand } from "./components/Hand";
import { BetRail } from "./components/BetRail";
import { Controls } from "./components/Controls";
import { Scoreboard } from "./components/Scoreboard";

interface AppProps {
  store?: StoreApi<GameState>;
}

export function App({ store }: AppProps = {}) {
  const active = store ?? defaultStore();
  const snapshot = useStore(active, (s) => s.snapshot);
  const selectedChip = useStore(active, (s) => s.selectedChip);
  const lastError = useStore(active, (s) => s.lastError);
  const setSelectedChip = useStore(active, (s) => s.setSelectedChip);
  const placeSelectedBet = useStore(active, (s) => s.placeSelectedBet);
  const clearBets = useStore(active, (s) => s.clearBets);
  const deal = useStore(active, (s) => s.deal);
  const peek = useStore(active, (s) => s.peek);
  const reveal = useStore(active, (s) => s.reveal);
  const settle = useStore(active, (s) => s.settle);
  const newShoe = useStore(active, (s) => s.newShoe);

  const revealAll = () => {
    for (const i of hiddenIndices(snapshot.player.cards)) reveal("Player", i);
    for (const i of hiddenIndices(snapshot.banker.cards)) reveal("Banker", i);
  };

  return (
    <main>
      <h1>Baccarat Simulator</h1>
      <div style={{ display: "flex", gap: "1rem", alignItems: "flex-start" }}>
        <Hud snapshot={snapshot} lastError={lastError} />
        <div>
          <Hand
            side="Player"
            hand={snapshot.player}
            phase={snapshot.phase}
            onPeek={(i) => peek("Player", i)}
            onReveal={(i) => reveal("Player", i)}
          />
          <Hand
            side="Banker"
            hand={snapshot.banker}
            phase={snapshot.phase}
            onPeek={(i) => peek("Banker", i)}
            onReveal={(i) => reveal("Banker", i)}
          />
          <Controls
            snapshot={snapshot}
            onDeal={deal}
            onRevealAll={revealAll}
            onSettle={settle}
            onNewShoe={newShoe}
          />
          <BetRail
            snapshot={snapshot}
            selectedChip={selectedChip}
            onSelectChip={setSelectedChip}
            onPlaceBet={placeSelectedBet}
            onClear={clearBets}
          />
        </div>
        <Scoreboard scoreboard={snapshot.scoreboard} />
      </div>
    </main>
  );
}
```

- [ ] **Step 4: Verify it passes**

Run: `cd /home/sabien/Dev/personal/baccarat-simulator && npm --workspace web test -- App 2>&1 | tail -15`
Expected: PASS (3 tests).

- [ ] **Step 5: Full suite + typecheck + build**

Run:
```bash
cd /home/sabien/Dev/personal/baccarat-simulator
npm --workspace web run typecheck 2>&1 | tail -8
npm --workspace web test 2>&1 | tail -8
npm --workspace web run build 2>&1 | tail -6
```
Expected: typecheck clean; ALL test files pass (squeeze, cards, Card, SqueezeCard, Hand, Controls, App, plus the unchanged format, adapter, gameStore, Hud, Hud, BetRail, Scoreboard); `vite build` succeeds.

- [ ] **Step 6: Dev-server sanity (optional)**

Run: `cd /home/sabien/Dev/personal/baccarat-simulator && timeout 8 npm --workspace web run dev 2>&1 | tail -6`
Expected: Vite prints `Local: http://localhost:5173/` with no errors. (Manually: Bet → Deal → drag/click a card to peek then reveal → Settle.)

- [ ] **Step 7: Commit**

```bash
cd /home/sabien/Dev/personal/baccarat-simulator
git add web/src/App.tsx web/src/App.test.tsx
git commit -m "feat(web): wire squeeze (peek/reveal/reveal-all) into App

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Final verification (whole plan)

- [ ] `npm --workspace web run typecheck` clean.
- [ ] `npm --workspace web test` → all suites green (squeeze, cards, Card, SqueezeCard, Hand, Controls, App, format, adapter, gameStore, Hud, BetRail, Scoreboard).
- [ ] `npm --workspace web run build` succeeds.
- [ ] Engine untouched: `cd engine && cargo test` still 117 green.
- [ ] `git status` clean; no `node_modules/`/`dist/`/`pkg/` tracked.

After all tasks pass, use **superpowers:finishing-a-development-branch** to merge `squeeze-cards` to `master`, then an Opus review (the squeeze is pure UI pacing — peek/reveal only cross at thresholds, no game logic in components, drag math is coordinate-based and jsdom-safe, click/keyboard fallback works).
