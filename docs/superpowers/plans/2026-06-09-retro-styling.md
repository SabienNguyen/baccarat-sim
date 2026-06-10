# Balatro-Retro Styling Pass — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Apply the confirmed Balatro-retro visual skin to the existing, fully-functional web front-end without changing how it plays.

**Architecture:** A global `theme.css` (design tokens + web fonts + swirl felt + CSS-grid layout) plus co-located component stylesheets restyle every component. Components keep their props, callbacks, DOM roles, and ARIA labels, so the 48 existing behavior tests stay green. The only behavior-adjacent additions are a UI-only `lastDelta`/`settleSeq` pair in the Zustand store and a new presentational `WinPopup` component that floats a `+$95` payout pop-up on settle.

**Tech Stack:** React 18 + TypeScript, Vite, Vitest + Testing Library, Zustand (vanilla store), plain CSS with custom properties, Google Fonts (Press Start 2P, VT323). No new runtime dependencies.

**Spec:** `docs/superpowers/specs/2026-06-09-retro-styling-design.md`

---

## Conventions for every task

- Run web tests with: `npm --workspace web run test -- --run`
- Run the typecheck with: `npm --workspace web run build` (Vite build runs `tsc` first) **or**, if a faster check is desired, `npx --workspace web tsc --noEmit`.
- "Full suite green" means the Vitest run ends with `Tests  48 passed (48)` (or higher as new tests are added) and zero failures.
- **Restyle tasks add NO new behavior tests** — CSS is not unit-tested. Their verification is: (a) the full suite still passes unchanged, and (b) typecheck is clean. The chief risk is breaking a test's DOM query, so always preserve existing `role`/`aria-label`/element structure; only add `className`s and wrapper markup.

---

## Task 1: Global theme — tokens, fonts, felt, grid

**Files:**
- Create: `web/src/theme.css`
- Modify: `web/src/main.tsx`

- [ ] **Step 1: Create the theme stylesheet**

Create `web/src/theme.css`:

```css
@import url("https://fonts.googleapis.com/css2?family=Press+Start+2P&family=VT323&display=swap");

:root {
  /* felt */
  --felt-deep: #0b3d2e;
  --felt-light: #145c43;
  /* chips / accents */
  --gold: #f4c430;
  --chip-red: #c0202a;
  --chip-blue: #1f6feb;
  /* panels */
  --panel-face: #2a2438;
  --panel-bevel-hi: #4a4060;
  --panel-bevel-lo: #140f1f;
  /* structure */
  --ink: #15110f;
  --shadow: rgba(0, 0, 0, 0.45);
  /* type */
  --font-display: "Press Start 2P", ui-monospace, monospace;
  --font-text: "VT323", ui-monospace, monospace;
}

* {
  box-sizing: border-box;
}

body {
  margin: 0;
  font-family: var(--font-text);
  color: #f3eede;
  /* layered radial greens + a swirl that slowly drifts */
  background-color: var(--felt-deep);
  background-image:
    radial-gradient(circle at 30% 20%, var(--felt-light), transparent 55%),
    radial-gradient(circle at 75% 70%, var(--felt-light), transparent 50%),
    radial-gradient(circle at 50% 50%, rgba(255, 255, 255, 0.04), transparent 60%);
  background-attachment: fixed;
  background-size: 140% 140%, 160% 160%, 200% 200%;
  animation: felt-swirl 40s ease-in-out infinite alternate;
}

@keyframes felt-swirl {
  from {
    background-position: 0% 0%, 100% 100%, 50% 50%;
  }
  to {
    background-position: 20% 15%, 80% 85%, 55% 45%;
  }
}

/* Shared beveled panel look used by the HUD and scoreboard docks. */
.panel {
  background: var(--panel-face);
  border: 3px solid var(--ink);
  border-radius: 8px;
  box-shadow:
    inset 2px 2px 0 var(--panel-bevel-hi),
    inset -2px -2px 0 var(--panel-bevel-lo),
    4px 4px 0 var(--shadow);
  padding: 12px;
}

/* App grid: HUD | center stage | scoreboard dock. */
.app {
  display: grid;
  grid-template-columns: 240px 1fr 320px;
  grid-template-areas: "hud stage board";
  gap: 16px;
  min-height: 100vh;
  padding: 16px;
}
.app > .hud {
  grid-area: hud;
}
.app > .stage {
  grid-area: stage;
  display: flex;
  flex-direction: column;
  gap: 16px;
  align-items: center;
}
.app > .board {
  grid-area: board;
}
```

- [ ] **Step 2: Import the theme once, at app entry**

Modify `web/src/main.tsx` — add the import below the existing imports (after `import { App } from "./App";`):

```tsx
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./theme.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
```

- [ ] **Step 3: Verify the suite is unaffected and typecheck is clean**

Run: `npm --workspace web run test -- --run`
Expected: `Tests  48 passed (48)`, no failures (importing CSS does not affect jsdom tests).

Run: `npm --workspace web run build`
Expected: build succeeds (tsc clean, Vite bundles, fonts referenced via CSS `@import`).

- [ ] **Step 4: Commit**

```bash
git add web/src/theme.css web/src/main.tsx
git commit -m "feat(web): retro theme tokens, swirl felt, and app grid"
```

---

## Task 2: Store — `lastDelta` and `settleSeq` (UI-only feedback state)

This is the only store change. `lastDelta` is the bankroll change across `settle()`; `settleSeq` increments each settle so the pop-up can be force-remounted by `key`. Both reset/advance with no game logic — pure arithmetic over snapshots the store already holds.

**Files:**
- Modify: `web/src/store/gameStore.ts`
- Test: `web/src/store/gameStore.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `web/src/store/gameStore.test.ts`:

```ts
test("settle records the positive bankroll delta as lastDelta and bumps settleSeq", () => {
  const before = snapshotWith({ phase: "Dealing", bankroll: 100000 });
  const after = snapshotWith({ phase: "Settled", bankroll: 109500 });
  const store = createGameStore(fakeSession({ ok: true, snapshot: after }, before));
  expect(store.getState().lastDelta).toBeNull();
  expect(store.getState().settleSeq).toBe(0);
  store.getState().settle();
  expect(store.getState().lastDelta).toBe(9500);
  expect(store.getState().settleSeq).toBe(1);
});

test("settle records a negative delta on a loss", () => {
  const before = snapshotWith({ phase: "Dealing", bankroll: 100000 });
  const after = snapshotWith({ phase: "Settled", bankroll: 99500 });
  const store = createGameStore(fakeSession({ ok: true, snapshot: after }, before));
  store.getState().settle();
  expect(store.getState().lastDelta).toBe(-500);
});

test("deal and clearBets reset lastDelta to null", () => {
  const before = snapshotWith({ phase: "Dealing", bankroll: 100000 });
  const after = snapshotWith({ phase: "Settled", bankroll: 109500 });
  const store = createGameStore(fakeSession({ ok: true, snapshot: after }, before));
  store.getState().settle();
  expect(store.getState().lastDelta).toBe(9500);
  store.getState().deal();
  expect(store.getState().lastDelta).toBeNull();
  store.getState().settle();
  expect(store.getState().lastDelta).toBe(9500);
  store.getState().clearBets();
  expect(store.getState().lastDelta).toBeNull();
});

test("a failed settle leaves lastDelta untouched", () => {
  const before = snapshotWith({ phase: "Dealing", bankroll: 100000 });
  const err: CommandError = { WrongPhase: { expected: "Dealing", found: "Settled" } };
  const store = createGameStore(fakeSession({ ok: false, error: err }, before));
  store.getState().settle();
  expect(store.getState().lastDelta).toBeNull();
  expect(store.getState().settleSeq).toBe(0);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm --workspace web run test -- --run gameStore`
Expected: FAIL — `lastDelta`/`settleSeq` are not properties of the state.

- [ ] **Step 3: Implement `lastDelta` / `settleSeq`**

Edit `web/src/store/gameStore.ts`. Add the two fields to the `GameState` interface (after `lastError`):

```ts
export interface GameState {
  snapshot: RoundSnapshot;
  selectedChip: number;
  lastError: CommandError | null;
  /** Bankroll change across the last settle, in cents; null until/after a settle. */
  lastDelta: number | null;
  /** Increments on each settle so the win pop-up can remount via React key. */
  settleSeq: number;
  setSelectedChip: (cents: number) => void;
  placeSelectedBet: (kind: BetKind) => void;
  clearBets: () => void;
  deal: () => void;
  peek: (side: Side, index: number) => void;
  reveal: (side: Side, index: number) => void;
  settle: () => void;
  newShoe: () => void;
}
```

Then update the store body — initialize the new fields and override `settle`, `deal`, and `clearBets` so they manage `lastDelta`/`settleSeq`. Replace the returned object's relevant lines:

```ts
    return {
      snapshot: session.snapshot(),
      selectedChip: CHIP_DENOMINATIONS[0],
      lastError: null,
      lastDelta: null,
      settleSeq: 0,
      setSelectedChip: (cents) => set({ selectedChip: cents }),
      placeSelectedBet: (kind) => apply(session.placeBet(kind, get().selectedChip)),
      clearBets: () => {
        set({ lastDelta: null });
        apply(session.clearBets());
      },
      deal: () => {
        set({ lastDelta: null });
        apply(session.deal());
      },
      peek: (side, index) => apply(session.peek(side, index)),
      reveal: (side, index) => apply(session.reveal(side, index)),
      settle: () => {
        const before = get().snapshot.bankroll;
        const result = session.settle();
        if (result.ok) {
          set({
            lastDelta: result.snapshot.bankroll - before,
            settleSeq: get().settleSeq + 1,
          });
        }
        apply(result);
      },
      newShoe: () => apply(session.newShoe()),
    };
```

(Leave `apply` exactly as it is — it still owns snapshot/lastError updates.)

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm --workspace web run test -- --run gameStore`
Expected: PASS, including the four new tests.

- [ ] **Step 5: Run the full suite + typecheck**

Run: `npm --workspace web run test -- --run`
Expected: `Tests  52 passed (52)`.
Run: `npx --workspace web tsc --noEmit`
Expected: no output (clean).

- [ ] **Step 6: Commit**

```bash
git add web/src/store/gameStore.ts web/src/store/gameStore.test.ts
git commit -m "feat(web): track settle bankroll delta for win pop-up feedback"
```

---

## Task 3: `WinPopup` component

A presentational float-up pop-up. Renders nothing for `null`/`0`; otherwise a gold positive or muted negative callout using `formatCents`.

**Files:**
- Create: `web/src/components/WinPopup.tsx`
- Create: `web/src/components/winpopup.css`
- Test: `web/src/components/WinPopup.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `web/src/components/WinPopup.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import { WinPopup } from "./WinPopup";

test("renders nothing when amount is null", () => {
  const { container } = render(<WinPopup amount={null} />);
  expect(container).toBeEmptyDOMElement();
});

test("renders nothing when amount is zero (a push)", () => {
  const { container } = render(<WinPopup amount={0} />);
  expect(container).toBeEmptyDOMElement();
});

test("renders a positive payout with a + sign and win styling", () => {
  render(<WinPopup amount={9500} />);
  const el = screen.getByText("+$95.00");
  expect(el).toBeInTheDocument();
  expect(el).toHaveAttribute("data-sign", "win");
});

test("renders a negative payout with loss styling", () => {
  render(<WinPopup amount={-500} />);
  const el = screen.getByText("-$5.00");
  expect(el).toHaveAttribute("data-sign", "loss");
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm --workspace web run test -- --run WinPopup`
Expected: FAIL — module `./WinPopup` not found.

- [ ] **Step 3: Implement the component and its CSS**

Create `web/src/components/WinPopup.tsx`:

```tsx
import { formatCents } from "../format";
import "./winpopup.css";

interface WinPopupProps {
  /** Net cents from the last settle; null or 0 renders nothing. */
  amount: number | null;
}

export function WinPopup({ amount }: WinPopupProps) {
  if (amount === null || amount === 0) return null;
  const sign = amount > 0 ? "win" : "loss";
  const text = amount > 0 ? `+${formatCents(amount)}` : formatCents(amount);
  return (
    <div className="win-popup" data-sign={sign} role="status">
      {text}
    </div>
  );
}
```

Create `web/src/components/winpopup.css`:

```css
.win-popup {
  position: fixed;
  top: 38%;
  left: 50%;
  transform: translate(-50%, 0);
  font-family: var(--font-display);
  font-size: 28px;
  padding: 10px 16px;
  border: 3px solid var(--ink);
  border-radius: 8px;
  background: var(--panel-face);
  text-shadow: 2px 2px 0 var(--ink);
  pointer-events: none;
  z-index: 50;
  animation: win-float 1500ms ease-out forwards;
}
.win-popup[data-sign="win"] {
  color: var(--gold);
}
.win-popup[data-sign="loss"] {
  color: #b8a;
}

@keyframes win-float {
  0% {
    opacity: 0;
    transform: translate(-50%, 12px) scale(0.8);
  }
  20% {
    opacity: 1;
    transform: translate(-50%, 0) scale(1.05);
  }
  80% {
    opacity: 1;
    transform: translate(-50%, -28px) scale(1);
  }
  100% {
    opacity: 0;
    transform: translate(-50%, -48px) scale(1);
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm --workspace web run test -- --run WinPopup`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add web/src/components/WinPopup.tsx web/src/components/winpopup.css web/src/components/WinPopup.test.tsx
git commit -m "feat(web): WinPopup float-up payout callout"
```

---

## Task 4: App layout — grid wiring + mount WinPopup

Restyle `App.tsx` into the grid and render the pop-up keyed by `settleSeq`. Keep the existing `App.test.tsx` green; add one test that the pop-up shows when the store has a delta.

**Files:**
- Modify: `web/src/App.tsx`
- Test: `web/src/App.test.tsx`

- [ ] **Step 1: Restyle App into the grid and mount WinPopup**

Replace the body of `web/src/App.tsx` with (imports + component):

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
import { WinPopup } from "./components/WinPopup";

interface AppProps {
  store?: StoreApi<GameState>;
}

export function App({ store }: AppProps = {}) {
  const active = store ?? defaultStore();
  const snapshot = useStore(active, (s) => s.snapshot);
  const selectedChip = useStore(active, (s) => s.selectedChip);
  const lastError = useStore(active, (s) => s.lastError);
  const lastDelta = useStore(active, (s) => s.lastDelta);
  const settleSeq = useStore(active, (s) => s.settleSeq);
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
    <div className="app">
      <Hud snapshot={snapshot} lastError={lastError} />
      <main className="stage">
        <div className="card-stage">
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
        </div>
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
      </main>
      <Scoreboard scoreboard={snapshot.scoreboard} />
      <WinPopup key={settleSeq} amount={lastDelta} />
    </div>
  );
}
```

Note: the `<h1>Baccarat Simulator</h1>` is intentionally dropped — the title moves into the HUD panel in Task 6. If `App.test.tsx` asserts on the title text, that assertion is updated in Step 2.

- [ ] **Step 2: Update the existing heading assertion and add a pop-up test**

`web/src/App.test.tsx`'s first test asserts the app title heading:

```tsx
  expect(screen.getByRole("heading", { name: "Baccarat Simulator" })).toBeInTheDocument();
```

Task 4 removes App's own `<h1>` (the title moves into the HUD panel in Task 6, where it keeps the text "Baccarat Simulator"). To keep this test green at the Task 4 commit, **delete that one assertion line** — the same test already asserts `screen.getByLabelText("HUD")`, which covers that the HUD region mounted. Leave every other line of that test untouched.

Then append a pop-up integration test. Reuse the file's existing `fakeSession` helper and the `bettingSnapshot`/`dealingSnapshot` fixtures already imported at the top — do not redefine a snapshot helper:

```tsx
test("shows the win pop-up after a winning settle", () => {
  const dealing = dealingSnapshot();
  const won: RoundSnapshot = {
    ...dealing,
    phase: "Settled",
    bankroll: dealing.bankroll + 9500,
  };
  const store = createGameStore(
    fakeSession(dealing, { settle: () => okResult(won) }),
  );
  const { rerender } = render(<App store={store} />);
  expect(screen.queryByRole("status")).toBeNull();
  store.getState().settle();
  rerender(<App store={store} />);
  expect(screen.getByRole("status")).toHaveTextContent("+$95.00");
});
```

(`fakeSession`, `okResult`, `dealingSnapshot`, `createGameStore`, `RoundSnapshot`, `render`, and `screen` are all already imported/defined in `App.test.tsx` — no new imports needed.)

- [ ] **Step 3: Run the suite**

Run: `npm --workspace web run test -- --run`
Expected: all green — `Tests  57 passed (57)` (48 baseline + 4 store + 4 WinPopup + 1 new App test). The key signal is zero failures; if your count differs by the exact number of tests you added, that's fine.

Run: `npx --workspace web tsc --noEmit`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add web/src/App.tsx web/src/App.test.tsx
git commit -m "feat(web): grid layout and mount WinPopup on settle"
```

---

## Task 5: Retro card faces

Upgrade `cards.css` and add classNames/wrapper to the card stage. Preserve every `aria-label` in `Card.tsx` (`face-down card`, `peeked card, <suit>`, `<rank> of <suit>`) and the `card`, `card-back`, `card-face`, `card-sliver`, `card-rank`, `card-suit`, `data-color` hooks the tests/markup use.

**Files:**
- Modify: `web/src/components/cards.css`
- Modify: `web/src/components/Hand.tsx` (add a stage wrapper class only — see Step 2)

- [ ] **Step 1: Replace `cards.css` with the retro version**

Overwrite `web/src/components/cards.css`:

```css
.card {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 72px;
  height: 104px;
  border: 3px solid var(--ink);
  border-radius: 8px;
  margin: 4px;
  font-family: var(--font-display);
  user-select: none;
  position: relative;
  box-shadow: 3px 3px 0 var(--shadow);
  transition: transform 120ms ease;
}
.card-back {
  background:
    repeating-linear-gradient(45deg, #3a2a55, #3a2a55 6px, #4a3a6a 6px, #4a3a6a 12px);
  box-shadow:
    inset 2px 2px 0 var(--panel-bevel-hi),
    inset -2px -2px 0 var(--panel-bevel-lo),
    3px 3px 0 var(--shadow);
}
.card-face {
  background: #f6f1e0;
  flex-direction: column;
  gap: 2px;
}
.card-face[data-color="red"],
.card-sliver[data-color="red"] {
  color: var(--chip-red);
}
.card-face[data-color="black"],
.card-sliver[data-color="black"] {
  color: #1a1a1a;
}
.card-sliver {
  position: absolute;
  top: 3px;
  left: 3px;
  background: #f6f1e0;
  padding: 2px 4px;
  font-size: 14px;
  line-height: 1;
  border-radius: 2px;
}
.card-rank {
  font-size: 18px;
}
.card-suit {
  font-size: 18px;
}

/* Player/Banker hands sit side by side on the felt stage. */
.card-stage {
  display: flex;
  gap: 48px;
  justify-content: center;
}
```

- [ ] **Step 2: Confirm the Hand root markup carries a label (no logic change)**

Open `web/src/components/Hand.tsx`. It already renders a labelled section per hand. No change is required beyond confirming the `.card-stage` flex wrapper (added in `App.tsx` Task 4) contains both `Hand`s. If `Hand.tsx`'s root is a bare `<div>` with no class, leave it — the `.card-stage` parent handles layout. **Do not** alter any `aria-label` or the conditional that swaps `SqueezeCard`/`Card`.

- [ ] **Step 3: Run the suite + typecheck**

Run: `npm --workspace web run test -- --run`
Expected: all green (card tests rely on `aria-label`/`data-color`, all preserved).
Run: `npx --workspace web tsc --noEmit`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add web/src/components/cards.css
git commit -m "feat(web): retro card faces (chunky outline, pixel rank, patterned back)"
```

---

## Task 6: HUD beveled panel

Restyle the HUD into the left beveled panel and fold the app title into it. Preserve `aria-label="HUD"`, `aria-label="payouts"`, and the `role="alert"` error element.

**Files:**
- Modify: `web/src/components/Hud.tsx`
- Create: `web/src/components/hud.css`

- [ ] **Step 1: Add the panel classes + title to Hud**

In `web/src/components/Hud.tsx`, add `import "./hud.css";` at the top, give the root section the panel classes, and add the app title heading (text "Baccarat Simulator" — this is the title that moved out of App in Task 4). Change the opening tag and add the heading as the first child:

```tsx
import "./hud.css";
// ...existing imports unchanged...

export function Hud({ snapshot, lastError }: HudProps) {
  return (
    <section aria-label="HUD" className="hud panel">
      <h1 className="hud-title">Baccarat Simulator</h1>
      <dl className="hud-stats">
        <dt>Bankroll</dt>
        <dd>{formatCents(snapshot.bankroll)}</dd>
        <dt>Phase</dt>
        <dd>{snapshot.phase}</dd>
        <dt>Table</dt>
        <dd>
          {formatCents(snapshot.table_min)} – {formatCents(snapshot.table_max)}
        </dd>
      </dl>

      {snapshot.outcome !== null && <p className="hud-outcome">Outcome: {snapshot.outcome}</p>}

      {snapshot.payouts !== null && (
        <ul aria-label="payouts" className="hud-payouts">
          {snapshot.payouts.map((p, i) => (
            <li key={i}>
              {describeBet(p.bet.kind)}: <span>{formatNet(p.net)}</span>
            </li>
          ))}
        </ul>
      )}

      {lastError !== null && (
        <p role="alert" className="hud-error">
          {JSON.stringify(lastError)}
        </p>
      )}
    </section>
  );
}
```

(Leave `formatNet` and `describeBet` exactly as they are.)

- [ ] **Step 2: Create `hud.css`**

Create `web/src/components/hud.css`:

```css
.hud {
  display: flex;
  flex-direction: column;
  gap: 12px;
  align-self: start;
}
.hud-title {
  font-family: var(--font-display);
  font-size: 16px;
  color: var(--gold);
  text-shadow: 2px 2px 0 var(--ink);
  margin: 0 0 4px;
  line-height: 1.4;
}
.hud-stats {
  display: grid;
  grid-template-columns: 1fr;
  gap: 2px;
  margin: 0;
  font-size: 20px;
}
.hud-stats dt {
  font-family: var(--font-display);
  font-size: 9px;
  color: #b9aee0;
  margin-top: 8px;
  letter-spacing: 1px;
}
.hud-stats dd {
  margin: 0;
  color: #f3eede;
}
.hud-outcome {
  font-family: var(--font-display);
  font-size: 11px;
  color: var(--gold);
  margin: 4px 0 0;
}
.hud-payouts {
  list-style: none;
  padding: 0;
  margin: 0;
  font-size: 18px;
}
.hud-error {
  color: var(--chip-red);
  font-size: 16px;
  margin: 0;
}
```

- [ ] **Step 3: Run the suite + typecheck**

Run: `npm --workspace web run test -- --run`
Expected: green. The HUD tests query by `aria-label`/`role`/text content, all preserved. The added `<h1>Baccarat</h1>` is harmless (App test was updated in Task 4 to not depend on the old title; if any HUD test now matches two headings, scope it — but HUD tests do not assert on a heading).
Run: `npx --workspace web tsc --noEmit`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add web/src/components/Hud.tsx web/src/components/hud.css
git commit -m "feat(web): HUD beveled sidebar panel with title"
```

---

## Task 7: Bet rail — chips and betting spots

Restyle the chip selector and bet spots as beveled plastic. Preserve `aria-label`s: `Bet rail`, `Chips`, `Spots`, `Staged bets`, the `aria-pressed` chip buttons, and the `Bet <label>` / `Clear bets` button text.

**Files:**
- Modify: `web/src/components/BetRail.tsx`
- Create: `web/src/components/betrail.css`

- [ ] **Step 1: Add classes + import to BetRail**

In `web/src/components/BetRail.tsx`, add `import "./betrail.css";` at the top, and add classNames (no structural/label changes). Update the JSX wrappers and buttons:

```tsx
import "./betrail.css";
// ...existing imports unchanged...

  return (
    <section aria-label="Bet rail" className="bet-rail panel">
      <div aria-label="Chips" className="chips">
        {CHIP_DENOMINATIONS.map((cents) => (
          <button
            key={cents}
            type="button"
            className="chip"
            aria-pressed={selectedChip === cents}
            onClick={() => onSelectChip(cents)}
          >
            {formatCents(cents)} chip
          </button>
        ))}
      </div>

      <div aria-label="Spots" className="spots">
        {SPOTS.map((spot) => (
          <button
            key={spot.label}
            type="button"
            className="spot"
            disabled={!betting}
            onClick={() => onPlaceBet(spot.kind)}
          >
            Bet {spot.label}
          </button>
        ))}
      </div>

      <ul aria-label="Staged bets" className="staged">
        {snapshot.bets.map((bet, i) => (
          <li key={i}>
            <span>{`${describeBet(bet.kind)} ${formatCents(bet.amount)}`}</span>
          </li>
        ))}
      </ul>

      <button type="button" className="clear-bets" disabled={!betting} onClick={onClear}>
        Clear bets
      </button>
    </section>
  );
```

- [ ] **Step 2: Create `betrail.css`**

Create `web/src/components/betrail.css`:

```css
.bet-rail {
  width: 100%;
  max-width: 720px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.chips {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}
.chip {
  font-family: var(--font-display);
  font-size: 9px;
  color: #fff;
  background: var(--chip-blue);
  border: 3px solid var(--ink);
  border-radius: 999px;
  padding: 10px 12px;
  box-shadow: inset 2px 2px 0 rgba(255, 255, 255, 0.3), 2px 2px 0 var(--shadow);
  cursor: pointer;
  transition: transform 80ms ease;
}
.chip[aria-pressed="true"] {
  background: var(--chip-red);
  transform: translateY(-4px) scale(1.06);
}
.spots {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 8px;
}
.spot {
  font-family: var(--font-display);
  font-size: 9px;
  color: #1a1208;
  background: var(--gold);
  border: 3px solid var(--ink);
  border-radius: 8px;
  padding: 14px 8px;
  box-shadow: inset 2px 2px 0 rgba(255, 255, 255, 0.4), 2px 2px 0 var(--shadow);
  cursor: pointer;
  line-height: 1.4;
}
.spot:disabled {
  filter: grayscale(0.6) brightness(0.8);
  cursor: not-allowed;
}
.staged {
  list-style: none;
  padding: 0;
  margin: 0;
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  font-size: 18px;
  min-height: 24px;
}
.staged li {
  background: var(--panel-bevel-lo);
  border: 2px solid var(--ink);
  border-radius: 4px;
  padding: 2px 8px;
}
.clear-bets {
  align-self: flex-start;
  font-family: var(--font-display);
  font-size: 9px;
  color: #fff;
  background: var(--panel-bevel-hi);
  border: 3px solid var(--ink);
  border-radius: 8px;
  padding: 10px 12px;
  cursor: pointer;
}
.clear-bets:disabled {
  filter: brightness(0.7);
  cursor: not-allowed;
}
```

- [ ] **Step 3: Run the suite + typecheck**

Run: `npm --workspace web run test -- --run`
Expected: green (BetRail tests use labels/`aria-pressed`/button text, all preserved).
Run: `npx --workspace web tsc --noEmit`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add web/src/components/BetRail.tsx web/src/components/betrail.css
git commit -m "feat(web): retro chip selector and beveled bet spots"
```

---

## Task 8: Controls — plastic buttons

**Files:**
- Modify: `web/src/components/Controls.tsx`
- Create: `web/src/components/controls.css`

- [ ] **Step 1: Add classes + import to Controls**

In `web/src/components/Controls.tsx`, add `import "./controls.css";` at the top, give the section `className="controls"`, and add `className="btn"` to each of the four buttons. Preserve the `aria-label="Controls"`, the button text, `disabled` logic, and `onClick` handlers exactly. Example for the section + first button:

```tsx
import "./controls.css";
// ...existing import unchanged...

  return (
    <section aria-label="Controls" className="controls">
      <button type="button" className="btn" disabled={!betting || !hasBets} onClick={onDeal}>
        Deal
      </button>
      <button type="button" className="btn" disabled={!dealing} onClick={onRevealAll}>
        Reveal all
      </button>
      <button type="button" className="btn" disabled={!dealing} onClick={onSettle}>
        Settle
      </button>
      <button type="button" className="btn" onClick={onNewShoe}>
        New Shoe
      </button>
    </section>
  );
```

- [ ] **Step 2: Create `controls.css`**

Create `web/src/components/controls.css`:

```css
.controls {
  display: flex;
  gap: 12px;
  justify-content: center;
}
.controls .btn {
  font-family: var(--font-display);
  font-size: 11px;
  color: #fff;
  background: var(--chip-red);
  border: 3px solid var(--ink);
  border-radius: 8px;
  padding: 14px 18px;
  box-shadow: inset 2px 2px 0 rgba(255, 255, 255, 0.3), 3px 3px 0 var(--shadow);
  cursor: pointer;
  transition: transform 80ms ease;
}
.controls .btn:hover:not(:disabled) {
  transform: translateY(-2px);
}
.controls .btn:active:not(:disabled) {
  transform: translateY(2px);
  box-shadow: inset 2px 2px 0 rgba(0, 0, 0, 0.3);
}
.controls .btn:disabled {
  filter: grayscale(0.7) brightness(0.7);
  cursor: not-allowed;
}
```

- [ ] **Step 3: Run the suite + typecheck**

Run: `npm --workspace web run test -- --run`
Expected: green.
Run: `npx --workspace web tsc --noEmit`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add web/src/components/Controls.tsx web/src/components/controls.css
git commit -m "feat(web): plastic retro control buttons"
```

---

## Task 9: Scoreboard right dock

Restyle the roads into a beveled right-dock with grid cells. Preserve `aria-label="Scoreboard"`, each road's `aria-label`, the `data-mark` attributes, and the existing element structure (the tests query these).

**Files:**
- Modify: `web/src/components/Scoreboard.tsx`
- Create: `web/src/components/scoreboard.css`

- [ ] **Step 1: Add classes + import to Scoreboard**

In `web/src/components/Scoreboard.tsx`, add `import "./scoreboard.css";` at the top. Give the root section `className="board panel"` and add a `className` to the bead/big-road/derived containers for styling. Update the root and the two inline blocks, and the `DerivedRoadView` wrapper:

```tsx
import "./scoreboard.css";
// ...existing type imports unchanged...

function DerivedRoadView({ label, road }: { label: string; road: DerivedRoad }) {
  return (
    <div aria-label={label} className="road derived">
      <h4>{label}</h4>
      <div className="road-grid">
        {road.columns.map((col, ci) => (
          <ul key={ci}>
            {col.map((mark: Mark, ri) => (
              <li key={ri} data-mark={mark}>
                {mark === "Red" ? "●" : "○"}
              </li>
            ))}
          </ul>
        ))}
      </div>
    </div>
  );
}

export function Scoreboard({ scoreboard }: { scoreboard: ScoreboardSnapshot }) {
  return (
    <section aria-label="Scoreboard" className="board panel">
      <div aria-label="Bead Plate" className="road bead">
        <h4>Bead Plate</h4>
        <ul className="bead-grid">
          {scoreboard.bead_plate.cells.map((cell, i) => (
            <li key={i}>{beadLabel(cell)}</li>
          ))}
        </ul>
      </div>

      <div aria-label="Big Road" className="road big">
        <h4>Big Road</h4>
        <div className="road-grid">
          {scoreboard.big_road.columns.map((col, ci) => (
            <ul key={ci}>
              {col.map((cell, ri) => (
                <li key={ri}>{bigRoadLabel(cell)}</li>
              ))}
            </ul>
          ))}
        </div>
      </div>

      <DerivedRoadView label="Big Eye Boy" road={scoreboard.big_eye_boy} />
      <DerivedRoadView label="Small Road" road={scoreboard.small_road} />
      <DerivedRoadView label="Cockroach Pig" road={scoreboard.cockroach_pig} />
    </section>
  );
}
```

Note: a `.road-grid` wrapper `<div>` is added around the Big-Road/derived columns for layout; the bead plate keeps its single `<ul className="bead-grid">`. This is verified safe against the existing tests — `Scoreboard.test.tsx` queries `within(getByLabelText("Bead Plate")).getAllByRole("listitem")` (length 3) and `within(getByLabelText("Big Road")).getAllByRole("list")` (length 2). A wrapper `<div>` has no list role and the `<ul>`/`<li>` elements stay inside the labelled region, so both `within(...)` role queries still resolve to the same counts.

- [ ] **Step 2: Create `scoreboard.css`**

Create `web/src/components/scoreboard.css`:

```css
.board {
  align-self: start;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.board h4 {
  font-family: var(--font-display);
  font-size: 9px;
  color: var(--gold);
  margin: 0 0 6px;
  letter-spacing: 1px;
}
.bead-grid {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  grid-template-columns: repeat(6, 1fr);
  gap: 2px;
}
.bead-grid li {
  background: var(--panel-bevel-lo);
  border: 1px solid var(--ink);
  border-radius: 3px;
  font-size: 14px;
  text-align: center;
  min-height: 20px;
  line-height: 20px;
}
.road-grid {
  display: flex;
  gap: 2px;
  overflow-x: auto;
}
.road-grid ul {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.road-grid li {
  width: 20px;
  height: 20px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 13px;
  background: var(--panel-bevel-lo);
  border: 1px solid var(--ink);
  border-radius: 3px;
}
.road-grid li[data-mark="Red"] {
  color: var(--chip-red);
}
.road-grid li[data-mark="Blue"] {
  color: var(--chip-blue);
}
```

- [ ] **Step 3: Run the suite + typecheck**

Run: `npm --workspace web run test -- --run`
Expected: green — the Scoreboard tests use `within(region).getAllByRole(...)`, which the `.road-grid` wrapper preserves (see Step 1 note).
Run: `npx --workspace web tsc --noEmit`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add web/src/components/Scoreboard.tsx web/src/components/scoreboard.css
git commit -m "feat(web): scoreboard right dock with road grids"
```

---

## Task 10: Final verification

- [ ] **Step 1: Full suite + build**

Run: `npm --workspace web run test -- --run`
Expected: all green (57 tests, zero failures).

Run: `npm --workspace web run build`
Expected: tsc clean, Vite production build succeeds.

- [ ] **Step 2: Eyeball the running app**

Run: `npm --workspace web run dev`
Open the printed local URL and confirm visually: swirl-green felt, left beveled HUD with pixel title, retro cards (drag-to-squeeze still works), gold bet spots + blue/red chips, plastic control buttons, right road dock. Place a bet → deal → squeeze → settle → confirm the `+$NN.NN` pop-up floats up. Stop the dev server when done.

- [ ] **Step 3: Confirm clean tree**

Run: `git status`
Expected: clean working tree, all styling commits present.

---

## Self-review notes (for the executor)

- **Preserve test hooks:** every restyle task must keep existing `role`/`aria-label`/`data-*` attributes and element nesting that tests query. Adding `className`s and a couple of layout wrapper `<div>`s is safe; renaming/removing labels or restructuring queried lists is not. After every task, the full suite must be green before committing.
- **No engine/adapter changes:** this plan touches only `web/src/**`. If you find yourself editing Rust or the adapter, stop — the shoe counter / commission tally were deliberately deferred (spec §2).
- **Fonts are remote:** the Google Fonts `@import` means first paint depends on network; tests don't care (jsdom ignores it). Fine for this plan.
