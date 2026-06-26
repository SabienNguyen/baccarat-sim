# Table UI Simplification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove three sources of table friction — manual Settle/Next-hand, the always-on side-bet clutter, and the discrete chip-inventory + exchange — so single-player auto-advances, bonuses live in a drawer, and money is a single balance you bet by tapping a chip then a spot.

**Architecture:** Three independent slices on `feat/ui-simplification`. **A** adds auto-settle/auto-advance effects in `App.tsx` and makes Settle/Next-hand multiplayer-only. **B** wraps the side bets in a collapsible drawer in `BetRail.tsx`. **C** reshapes the shared `GameState` from a chip rack to `selectedChip` + derived `available`, simplifying both `gameStore.ts` and `remoteStore.ts`, trimming `chips.ts`, rewiring `BetRail`/`Chip`/`App`, and deleting `ExchangeModal`.

**Tech Stack:** React 18 + TypeScript, Zustand vanilla stores, Vitest + Testing Library (jsdom). Run from `web/`.

**Working agreement:** All tests green after every task (`cd web && npx vitest run`) and `npx tsc --noEmit` clean before each commit. Conventional commits `feat(web)/refactor(web)/test(web)`. Each commit ends with the Co-Authored-By trailer:
```
Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
```

---

## File Map

| File | Slice | Change |
|---|---|---|
| `web/src/components/Controls.tsx` | A | Settle/Next-hand render only when handler provided |
| `web/src/components/Controls.test.tsx` | A | Assert buttons absent without handlers |
| `web/src/App.tsx` | A, C | Auto-settle/advance effects; Controls + BetRail rewiring; drop ExchangeModal |
| `web/src/App.test.tsx` | A, C | Auto-advance flow; new bet flow |
| `web/src/components/BetRail.tsx` | B, C | Side-bet drawer; balance-betting props |
| `web/src/components/betrail.css` | B, C | Drawer styles; drop hand-tray/exchange styles |
| `web/src/components/BetRail.test.tsx` | B, C | Drawer + new bet flow |
| `web/src/components/Chip.tsx` | C | Selectable denomination button (no count) |
| `web/src/components/Chip.test.tsx` | C | Select/disabled behavior |
| `web/src/chips.ts` | C | Keep `CHIP_DENOMINATIONS`, `toChips`; delete rack functions |
| `web/src/chips.test.ts` | C | Trim to kept functions |
| `web/src/store/gameStore.ts` | C | `GameState` reshape; balance actions |
| `web/src/store/gameStore.test.ts` | C | Balance tests |
| `web/src/store/gameStore.integration.test.ts` | A, C | New flow |
| `web/src/multiplayer/remoteStore.ts` | C | Simplified mirror; balance actions |
| `web/src/multiplayer/remoteStore.test.ts` | C | Simplified mirror tests |
| `web/src/components/ExchangeModal.tsx` | C | **Delete** |
| `web/src/store/tableSession.integration.test.ts` | C | New flow if it touches chips |

---

# SLICE A — Auto-advance (single-player)

### Task A1: Controls renders Settle/Next-hand only when handlers are provided

**Files:** Modify `web/src/components/Controls.tsx`.

- [ ] **Step 1: Make the two buttons conditional.** In `Controls.tsx`, the props `onSettle` and `onNewHand` already exist (`onNewHand?` is optional; make `onSettle?` optional too). Change the interface line `onSettle: () => void;` to `onSettle?: () => void;`. Replace the two button JSX blocks (currently lines ~49-54):

```tsx
      {onSettle && (
        <button type="button" className="btn" disabled={!dealing} onClick={onSettle}>
          Settle
        </button>
      )}
      {onNewHand && (
        <button type="button" className="btn" disabled={!settled} onClick={onNewHand}>
          Next hand
        </button>
      )}
```

- [ ] **Step 2: Typecheck.** Run `npx tsc --noEmit`. Expected: clean (existing callers still pass `onSettle`).

- [ ] **Step 3: Update Controls.test.tsx.** The existing tests pass `onSettle={vi.fn()}` so Settle still renders. Replace the test named `"Settle is enabled in Dealing; no per-card Reveal buttons exist"` with this pair:

```tsx
test("Settle and Next hand render only when their handlers are given", () => {
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
```

- [ ] **Step 4: Run the Controls tests.** Run `npx vitest run src/components/Controls.test.tsx`. Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git add web/src/components/Controls.tsx web/src/components/Controls.test.tsx
git commit -m "refactor(web): Settle/Next-hand render only with handlers (multiplayer-only)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

### Task A2: Auto-settle and auto-advance effects in App.tsx (single-player)

**Files:** Modify `web/src/App.tsx`.

- [ ] **Step 1: Add timing constants.** Near the top of `App.tsx` (after imports), add:

```tsx
/** Beat after the final card flips before the round resolves itself. */
const AUTO_SETTLE_MS = 600;
/** How long the win/loss popup lingers before the next hand opens. */
const AUTO_ADVANCE_MS = 1400;
```

- [ ] **Step 2: Import `useEffect` and `useRef`.** Change `import { useState } from "react";` to `import { useEffect, useRef, useState } from "react";`.

- [ ] **Step 3: Add the effects in `GameTable`.** Place after the `bankerLocked` computation (just before `return (`). The auto-settle guard ref prevents re-firing within one coup and resets when the phase leaves Settled-ish:

```tsx
  // Single-player only: the round settles itself once every card is face-up,
  // then clears to the next hand after the win popup. Multiplayer keeps its
  // buttons (the authoritative server paces coups).
  const settledThisCoup = useRef(false);
  useEffect(() => {
    if (seats !== null) return;
    if (snapshot.phase !== "Dealing") {
      if (snapshot.phase === "Betting") settledThisCoup.current = false;
      return;
    }
    const all = [...snapshot.player.cards, ...snapshot.banker.cards];
    const allUp = all.length > 0 && all.every((c) => isFaceUp(c));
    if (!allUp || settledThisCoup.current) return;
    settledThisCoup.current = true;
    const t = setTimeout(settle, AUTO_SETTLE_MS);
    return () => clearTimeout(t);
  }, [seats, snapshot, settle]);

  useEffect(() => {
    if (seats !== null) return;
    if (snapshot.phase !== "Settled" || busted || goalReached) return;
    const t = setTimeout(newHand, AUTO_ADVANCE_MS);
    return () => clearTimeout(t);
  }, [seats, snapshot.phase, busted, goalReached, newHand]);
```

- [ ] **Step 4: Make Settle/Next-hand multiplayer-only.** In the `<Controls ... />` JSX, change:

```tsx
          onSettle={seats !== null ? settle : undefined}
          onNewHand={seats !== null ? newHand : undefined}
```

(Replace the existing `onSettle={settle}` and `onNewHand={newHand}` lines.)

- [ ] **Step 5: Typecheck.** Run `npx tsc --noEmit`. Expected: clean.

- [ ] **Step 6: Add an App-level auto-advance test.** Append to `web/src/App.test.tsx` (it already imports `render`, `screen`, etc., and builds a store via fixtures — match the file's existing setup; if it injects a store, drive the store the same way). Add:

```tsx
test("single-player: revealing the last card auto-settles, then auto-advances to Betting", async () => {
  vi.useFakeTimers();
  // Build the table with an injected single-player store already in Dealing
  // with all cards face-up (seats === null). Reuse the file's store helper.
  // After mount, advance timers and assert the phase walks Dealing→Settled→Betting
  // without any Settle/Next-hand button existing.
  // (Implementer: mirror the store-injection pattern already used in this file.)
  expect(true).toBe(true); // replace with the real assertions per the file's harness
  vi.useRealTimers();
});
```

> Implementer note: `App.test.tsx` may not have an easy all-face-up Dealing fixture. If wiring a real store-driven assertion here is heavy, instead assert the simpler, equivalent guarantee at the unit level (Task A3 covers the store; this App test should at minimum assert **no Settle/Next-hand buttons render in single-player**). Replace the placeholder body with:

```tsx
test("single-player table shows no Settle or Next-hand buttons", () => {
  // mount the table the way the rest of App.test.tsx does (injected store, seats === null)
  // then:
  expect(screen.queryByRole("button", { name: "Settle" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Next hand" })).toBeNull();
});
```

- [ ] **Step 7: Run App tests.** Run `npx vitest run src/App.test.tsx`. Expected: PASS.

- [ ] **Step 8: Full suite + typecheck.** Run `npx vitest run` then `npx tsc --noEmit`. Expected: all green. (Existing integration tests that click "Settle"/"Next hand" in **single-player** will now fail — fix them in Task A3 before committing.)

### Task A3: Fix single-player integration tests for auto-advance

**Files:** Modify `web/src/store/gameStore.integration.test.ts` (and `tableSession.integration.test.ts` only if it drives the UI through Settle/Next-hand).

- [ ] **Step 1: Find the clicks.** Run:

```bash
grep -n "Settle\|Next hand" web/src/store/gameStore.integration.test.ts web/src/store/tableSession.integration.test.ts
```

- [ ] **Step 2: Replace button-driven settle with the store action.** These integration tests drive a real store. Where a test clicked the **Settle** button, call the store's `settle()` directly (the button no longer exists in single-player); where it clicked **Next hand**, call `newHand()` directly. Example transform:

```tsx
// before: await userEvent.click(screen.getByRole("button", { name: "Settle" }));
act(() => store.getState().settle());
// before: await userEvent.click(screen.getByRole("button", { name: "Next hand" }));
act(() => store.getState().newHand());
```

(Keep every assertion the test already makes; only the trigger changes. Import `act` from `@testing-library/react` if not already.)

- [ ] **Step 3: Run the integration tests.** Run `npx vitest run src/store`. Expected: PASS.

- [ ] **Step 4: Full suite + typecheck + commit.**

```bash
cd web && npx vitest run && npx tsc --noEmit
git add web/src/App.tsx web/src/App.test.tsx web/src/store/gameStore.integration.test.ts web/src/store/tableSession.integration.test.ts
git commit -m "feat(web): single-player auto-settles when revealed, auto-advances to the next hand

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

**Slice A checkpoint:** single-player has no Settle/Next-hand; revealing the final card resolves the round and re-opens betting on its own. Multiplayer unchanged.

---

# SLICE B — Side-bet drawer

### Task B1: Collapse the six side bets into a drawer

**Files:** Modify `web/src/components/BetRail.tsx`.

- [ ] **Step 1: Add drawer state + persistence helpers.** At the top of `BetRail.tsx` (after imports), add:

```tsx
const SIDE_OPEN_KEY = "baccarat.sidebets.open";
function loadSideOpen(): boolean {
  try {
    return localStorage.getItem(SIDE_OPEN_KEY) === "1";
  } catch {
    return false;
  }
}
function saveSideOpen(open: boolean): void {
  try {
    localStorage.setItem(SIDE_OPEN_KEY, open ? "1" : "0");
  } catch {
    /* storage unavailable — fine */
  }
}
```

- [ ] **Step 2: Compute drawer-open state inside the component.** In the `BetRail` body (after `const betting = ...`), add:

```tsx
  const sideStaked = snapshot.bets.some(
    (b) => typeof b.kind === "object" && "Side" in b.kind,
  );
  const [sideOpenPref, setSideOpenPref] = useState(loadSideOpen);
  // a live side bet forces the drawer open; otherwise the saved preference wins
  const sideOpen = sideOpenPref || sideStaked;
  const toggleSide = () => {
    const next = !sideOpen;
    setSideOpenPref(next);
    saveSideOpen(next);
  };
```

- [ ] **Step 3: Restructure the felt JSX.** Replace the `<div className="felt" ...>` block's contents so the main bets come first, then the drawer holding the toggle, the bonus-info button, and the side bets. Replace the existing `.felt` inner JSX (the bonus-info button + `.side-bets` + `.main-bets`) with:

```tsx
      <div className="felt" aria-label="Spots">
        <div className="main-bets">
          {MAIN_SPOTS.map((spot) => (
            <BetSpot
              key={spot.label}
              spot={spot}
              betting={canBet}
              chips={chipsOn(spot.kind, snapshot.bets, stagedChips)}
              shape={spot.label.toLowerCase()}
              onPlaceHand={onPlaceHand}
              onPlaceChip={onPlaceChip}
            />
          ))}
        </div>
        <div className="side-drawer">
          <div className="side-drawer-head">
            <button
              type="button"
              className="side-toggle"
              aria-expanded={sideOpen}
              aria-controls="side-bets"
              onClick={toggleSide}
            >
              {sideOpen ? "▾" : "▸"} Side bets
            </button>
            <button
              type="button"
              className="bonus-info-btn"
              aria-label="What are the bonus bets?"
              onClick={() => setShowBonusInfo(true)}
            >
              i
            </button>
          </div>
          <div
            id="side-bets"
            className={`side-bets${sideOpen ? " side-bets--open" : ""}`}
            hidden={!sideOpen}
          >
            {SIDE_SPOTS.map((spot) => (
              <BetSpot
                key={spot.label}
                spot={spot}
                betting={canBet}
                chips={chipsOn(spot.kind, snapshot.bets, stagedChips)}
                shape="side"
                onPlaceHand={onPlaceHand}
                onPlaceChip={onPlaceChip}
              />
            ))}
          </div>
        </div>
      </div>
```

> Note: this task keeps the **current** `BetSpot` props (`onPlaceHand`/`onPlaceChip`/`chips`/`stagedChips`) so Slice B compiles against today's chip model; Slice C rewires them. Do not change `BetSpot` here.

- [ ] **Step 4: Typecheck.** Run `npx tsc --noEmit`. Expected: clean.

### Task B2: Drawer styles + the drawer test

**Files:** Modify `web/src/components/betrail.css`, `web/src/components/BetRail.test.tsx`.

- [ ] **Step 1: Add drawer CSS.** Append to `betrail.css`:

```css
/* --- side-bet drawer --- */
.side-drawer {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.side-drawer-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.side-toggle {
  background: none;
  border: none;
  color: var(--gold);
  font-family: var(--font-display);
  font-size: 10px;
  letter-spacing: 1px;
  cursor: pointer;
  padding: 4px 2px;
}
.side-bets--open {
  animation: side-reveal 180ms ease-out;
}
@keyframes side-reveal {
  from {
    opacity: 0;
    transform: translateY(-6px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}
@media (prefers-reduced-motion: reduce) {
  .side-bets--open {
    animation: none;
  }
}
```

> The existing `.bonus-info-btn` is `position: absolute` (top-right of `.felt`). It now lives in `.side-drawer-head`; change its rule to `position: static` (remove `top`/`right`/`position: absolute` from the `.bonus-info-btn` block in `bonusinfo.css`), so it sits inline in the header. Verify with grep: `grep -n "bonus-info-btn" web/src/components/bonusinfo.css`.

- [ ] **Step 2: Write the drawer test.** In `BetRail.test.tsx`, add (uses the existing `noopProps`):

```tsx
test("side bets are hidden until the drawer is opened", async () => {
  render(<BetRail snapshot={bettingSnapshot()} {...noopProps} />);
  expect(screen.queryByRole("button", { name: "Bet Dragon 7" })).toBeNull();
  await userEvent.click(screen.getByRole("button", { name: /Side bets/ }));
  expect(screen.getByRole("button", { name: "Bet Dragon 7" })).toBeInTheDocument();
});

test("a staked side bet forces the drawer open", () => {
  const snap = bettingSnapshot({ bets: [{ kind: { Side: "Dragon7" }, amount: 500 }] });
  render(<BetRail snapshot={snap} {...noopProps} stagedChips={[[500]]} />);
  expect(screen.getByRole("button", { name: "Bet Dragon 7" })).toBeInTheDocument();
});
```

- [ ] **Step 3: Adjust the existing bonus-info test.** The test `"the felt's info icon opens the bonus-bets explainer"` clicks `"What are the bonus bets?"`, which now lives in the drawer header (always rendered) — it still works. No change needed; just confirm it passes.

- [ ] **Step 4: Run BetRail tests.** Run `npx vitest run src/components/BetRail.test.tsx`. Expected: PASS.

- [ ] **Step 5: Full suite + typecheck + commit.**

```bash
cd web && npx vitest run && npx tsc --noEmit
git add web/src/components/BetRail.tsx web/src/components/betrail.css web/src/components/bonusinfo.css web/src/components/BetRail.test.tsx
git commit -m "feat(web): side bets collapse into a one-tap drawer; main bets lead the felt

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

**Slice B checkpoint:** the felt shows P/T/B by default; the six bonuses open from one toggle, auto-open when staked, and remember their state.

---

# SLICE C — Balance betting (delete chip inventory + exchange)

### Task C1: Trim `chips.ts` to display-only

**Files:** Modify `web/src/chips.ts`, `web/src/chips.test.ts`.

- [ ] **Step 1: Reduce `chips.ts`.** Replace the entire file with:

```ts
/**
 * Chip display helpers. Money is a single balance (the engine bankroll);
 * chips are only a way to *show* a bet amount on the felt.
 */

/** The classic main-floor denominations: $1, $5, $25, $100, $500, $1,000. */
export const CHIP_DENOMINATIONS = [100, 500, 2500, 10000, 50000, 100000];

function desc(denoms: number[]): number[] {
  return [...denoms].sort((a, b) => b - a);
}

/**
 * Break an amount into chips, largest denomination first (how a dealer pays).
 * Whatever can't form a whole chip is returned as `remainder`.
 */
export function toChips(
  cents: number,
  denoms: number[] = CHIP_DENOMINATIONS,
): { chips: number[]; remainder: number } {
  const chips: number[] = [];
  let left = Math.max(0, Math.floor(cents));
  for (const d of desc(denoms)) {
    while (left >= d) {
      chips.push(d);
      left -= d;
    }
  }
  return { chips, remainder: left };
}
```

- [ ] **Step 2: Trim `chips.test.ts`.** Replace the whole file with only the surviving coverage:

```ts
import { CHIP_DENOMINATIONS, toChips } from "./chips";

test("six real casino denominations, ascending", () => {
  expect(CHIP_DENOMINATIONS).toEqual([100, 500, 2500, 10000, 50000, 100000]);
});

test("toChips pays largest-first and conserves the amount", () => {
  const { chips, remainder } = toChips(163000); // $1,630
  expect(chips).toEqual([100000, 50000, 10000, 2500, 500]);
  expect(remainder).toBe(0);
});

test("toChips leaves sub-$1 cents as remainder (commission change)", () => {
  const { chips, remainder } = toChips(2375); // $23.75
  expect(chips.reduce((a, b) => a + b, 0)).toBe(2300);
  expect(remainder).toBe(75);
});
```

- [ ] **Step 3: Expect breakage.** Run `npx tsc --noEmit`. Expected: FAIL — `gameStore.ts`, `remoteStore.ts`, `BetRail.tsx`, and their tests still import deleted symbols. That's the next tasks. Do **not** commit yet.

### Task C2: Reshape `GameState` and `gameStore.ts` to the balance model

**Files:** Modify `web/src/store/gameStore.ts`.

- [ ] **Step 1: Replace the chip imports.** Change the `from "../chips"` import block to:

```ts
import { CHIP_DENOMINATIONS } from "../chips";
```

- [ ] **Step 2: Reshape the `GameState` interface.** Remove the fields `rack`, `change`, `hand`, `stagedChips` and the actions `pickChip`, `returnHand`, `placeHand`, `placeChip`, `exchangeBreak`, `exchangeColorUp`, `exchangeAcquire`. In their place add:

```ts
  /** The chip denominations this table stocks. */
  denoms: number[];
  /** The armed chip denomination (cents) — tap a spot to stake it. */
  selectedChip: number;

  toggleExplain: () => void;
  /** Arm a denomination to bet. */
  selectChip: (denom: number) => void;
  /** Stake a chip on a spot: the armed one, or `denom` (drag-and-drop). */
  stake: (kind: BetKind, denom?: number) => void;
  clearBets: () => void;
```

(Keep `deal`, `peek`, `reveal`, `settle`, `newHand`, `newShoe` declarations.)

- [ ] **Step 3: Replace the initial chip state + actions.** Remove `const initial = buyIn(...)`. In the returned object, replace the `rack/change/hand/stagedChips` initial fields with `selectedChip: denoms[0]`, and replace the `pickChip`/`returnHand`/`placeHand`/`placeChip`/`exchange*`/`clearBets`/`deal`/`settle`/`newShoe` actions with:

```ts
      denoms,
      selectedChip: denoms[0],

      toggleExplain: () => set({ explainOn: !get().explainOn }),

      selectChip: (denom) => set({ selectedChip: denom }),

      stake: (kind, denom) => {
        if (get().snapshot.phase === "Settled") get().newHand();
        const amount = denom ?? get().selectedChip;
        const bankroll = session.snapshot().bankroll;
        const staked = get().snapshot.bets.reduce((a, b) => a + b.amount, 0);
        if (amount <= 0 || amount > bankroll - staked) return; // can't afford it
        apply(session.placeBet(kind, amount));
      },

      clearBets: () => apply(session.clearBets()),

      deal: () => {
        set({ lastDelta: null, lastFlip: null });
        apply(session.deal());
      },

      peek: (side, index) => apply(session.peek(side, index)),
      reveal: (side, index) => apply(session.reveal(side, index)),

      settle: () => {
        const before = session.snapshot().bankroll;
        const result = session.settle();
        if (result.ok) {
          set({
            lastDelta: result.snapshot.bankroll - before,
            settleSeq: get().settleSeq + 1,
            goalReached:
              goal !== null && before < goal && result.snapshot.bankroll >= goal
                ? true
                : get().goalReached,
            busted: result.snapshot.bankroll < result.snapshot.table_min,
          });
        }
        apply(result);
      },

      newHand: () =>
        set({
          snapshot: {
            ...session.snapshot(),
            phase: "Betting",
            payouts: null,
            outcome: null,
            events: [],
            player: { cards: [], total: null },
            banker: { cards: [], total: null },
          },
          lastError: null,
          lastDelta: null,
          lastFlip: null,
        }),

      newShoe: () => apply(session.newShoe()),
```

- [ ] **Step 4: Typecheck the store in isolation.** Run `npx tsc --noEmit`. Expected: still FAIL, but now only in `remoteStore.ts`, `BetRail.tsx`, `App.tsx`, and tests — not in `gameStore.ts`. Confirm `gameStore.ts` has no errors via the error list.

### Task C3: Rewrite `gameStore.test.ts` for the balance model

**Files:** Modify `web/src/store/gameStore.test.ts`.

- [ ] **Step 1: Replace the chip-invariant helpers and tests.** Replace the file's top (the `rackTotal` import and `chipsTotal` helper) and all chip/exchange tests with balance tests. Keep `snapshotWith`, `fakeSession`, and the goal/bust/explain/newHand tests (they don't use the rack). Concretely:
  - Remove `import { rackTotal } from "../chips";` and the `chipsTotal` helper.
  - Delete tests: `"buys in the full bankroll as chips on creation"`, `"pickChip moves..."`, `"pickChip refuses..."`, `"placeHand stakes..."`, `"a rejected placeHand..."`, `"placeChip stakes..."`, `"a dragged chip brings..."`, `"clearBets returns every staged chip..."`, `"a win returns the stake..."`, `"a commission win..."`, `"a loss sweeps..."`, `"exchange: break and color up..."`, `"deal returns any chips still in hand..."`, `"touching chips after a settled round..."`.
  - Keep: `"a failed settle leaves... counters untouched"` (drop its `chipsTotal` assertion line), `"newHand refreshes..."`, `"explain mode..."`, the two goal tests, the two bust tests.
  - Add these balance tests:

```ts
test("starts with the smallest denomination armed", () => {
  const store = createGameStore(fakeSession({ ok: true, snapshot: snapshotWith() }));
  expect(store.getState().selectedChip).toBe(100);
});

test("selectChip arms a denomination", () => {
  const store = createGameStore(fakeSession({ ok: true, snapshot: snapshotWith() }));
  store.getState().selectChip(2500);
  expect(store.getState().selectedChip).toBe(2500);
});

test("stake places the armed chip via placeBet", () => {
  const placeBet = vi.fn((): CommandResult => ({ ok: true, snapshot: snapshotWith() }));
  const store = createGameStore({ ...fakeSession({ ok: true, snapshot: snapshotWith() }), placeBet });
  store.getState().selectChip(2500);
  store.getState().stake({ Main: "Player" });
  expect(placeBet).toHaveBeenCalledWith({ Main: "Player" }, 2500);
});

test("stake with an explicit denom (drag) ignores the armed chip", () => {
  const placeBet = vi.fn((): CommandResult => ({ ok: true, snapshot: snapshotWith() }));
  const store = createGameStore({ ...fakeSession({ ok: true, snapshot: snapshotWith() }), placeBet });
  store.getState().stake({ Main: "Banker" }, 50000);
  expect(placeBet).toHaveBeenCalledWith({ Main: "Banker" }, 50000);
});

test("stake refuses a chip the balance can't cover", () => {
  const placeBet = vi.fn((): CommandResult => ({ ok: true, snapshot: snapshotWith() }));
  // bankroll 1,000,000 already fully staked → nothing left to bet
  const staked = snapshotWith({ bets: [{ kind: { Main: "Player" }, amount: 1_000_000 }] });
  const store = createGameStore({ ...fakeSession({ ok: true, snapshot: staked }, staked), placeBet });
  store.getState().stake({ Main: "Tie" }, 100000);
  expect(placeBet).not.toHaveBeenCalled();
});

test("a settle records the delta and bumps the popup sequence", () => {
  const won = snapshotWith({
    phase: "Settled",
    bankroll: 1_002_500,
    payouts: [{ bet: { kind: { Main: "Player" }, amount: 2500 }, net: 2500 }],
  });
  const store = createGameStore({
    ...fakeSession({ ok: true, snapshot: snapshotWith() }),
    settle: () => ({ ok: true, snapshot: won }),
  });
  store.getState().settle();
  expect(store.getState().lastDelta).toBe(2500);
  expect(store.getState().settleSeq).toBe(1);
});
```

(For the kept `"a failed settle..."` test, the body becomes: `store.getState().settle(); expect(lastDelta).toBeNull(); expect(settleSeq).toBe(0);` — drop the `chipsTotal` line.)

- [ ] **Step 2: Run the store tests.** Run `npx vitest run src/store/gameStore.test.ts`. Expected: PASS.

### Task C4: Simplify `remoteStore.ts` to a thin mirror

**Files:** Modify `web/src/multiplayer/remoteStore.ts`.

- [ ] **Step 1: Replace the imports.** Change the `from "../chips"` block to:

```ts
import { tableSpec, type TableTier } from "../tables";
```

(Drop all chip-function imports; `tableSpec` import already exists on the next line — merge so it isn't duplicated.)

- [ ] **Step 2: Replace the store body.** Replace from `const initialSnapshot = stripView(opts.view);` through the end of the `createStore(...)` call with:

```ts
  const initialSnapshot = stripView(opts.view);

  const store = createStore<GameState>((set, get) => ({
    snapshot: initialSnapshot,
    lastError: null,
    seats: opts.view.seats,
    squeezers: squeezersOf(opts.view),
    lastFlip: null,
    announcement: null,
    sitOut: () => send({ type: "sit_out" }),
    lastDelta: null,
    settleSeq: 0,
    explainOn: false,
    goal: null,
    goalReached: false,
    dismissGoal: () => set({ goalReached: false }),
    busted: false,
    denoms,
    selectedChip: denoms[0],

    toggleExplain: () => set({ explainOn: !get().explainOn }),

    selectChip: (denom) => set({ selectedChip: denom }),

    stake: (kind, denom) => {
      if (get().snapshot.phase === "Settled") get().newHand();
      const amount = denom ?? get().selectedChip;
      const staked = get().snapshot.bets.reduce((a, b) => a + b.amount, 0);
      if (amount <= 0 || amount > get().snapshot.bankroll - staked) return;
      send({ type: "bet", kind, amount });
    },

    clearBets: () => send({ type: "clear_bets" }),
    deal: () => send({ type: "deal" }),
    peek: (side, index) => send({ type: "peek", hand: side, index }),
    reveal: (side, index) => send({ type: "reveal", hand: side, index }),
    settle: () => send({ type: "settle" }),

    newHand: () =>
      set({
        snapshot: {
          ...get().snapshot,
          phase: "Betting",
          payouts: null,
          outcome: null,
          events: [],
          player: { cards: [], total: null },
          banker: { cards: [], total: null },
        },
        lastDelta: null,
        lastFlip: null,
      }),

    newShoe: () => send({ type: "new_shoe" }),
  }));
```

- [ ] **Step 3: Replace `handle()` with the thin mirror.** Replace the whole `const handle = (msg) => { ... }` body with:

```ts
  const handle = (msg: ServerMsg) => {
    const set = store.setState.bind(store);
    const get = store.getState.bind(store);

    if (msg.type === "announce") {
      set({ announcement: msg.message });
      return;
    }
    if (msg.type === "error") {
      set({ lastError: { Message: msg.message } });
      return;
    }
    if (msg.type !== "state" && msg.type !== "joined") return;

    const view = msg.view;
    const prev = get().snapshot;
    const next = stripView(view);

    // A settle push (Dealing→Settled) carries the round's bankroll change.
    let { lastDelta, settleSeq } = get();
    if (next.phase === "Settled" && prev.phase !== "Settled") {
      lastDelta = next.bankroll - prev.bankroll;
      settleSeq += 1;
    }

    const flip = lastFlipBetween(prev, next);
    set({
      snapshot: next,
      seats: view.seats,
      squeezers: squeezersOf(view),
      ...(flip ? { lastFlip: flip } : next.phase === "Betting" ? { lastFlip: null } : {}),
      lastDelta,
      settleSeq,
      lastError: null,
      announcement: null,
    });
  };
```

- [ ] **Step 4: Remove the now-unused `staked`/`pending`/`initial` locals.** Delete the `let pending: number[][] = [];`, the `const staked = ...`, and `const initial = buyIn(...)` lines if still present.

- [ ] **Step 5: Typecheck.** Run `npx tsc --noEmit`. Expected: errors now only in `BetRail.tsx`, `App.tsx`, and component/remote tests.

### Task C5: Rewrite `remoteStore.test.ts` for the thin mirror

**Files:** Modify `web/src/multiplayer/remoteStore.test.ts`.

- [ ] **Step 1: Inspect current tests.** Run `grep -n "^test\|rack\|pending\|buyIn\|stagedChips\|placeHand\|pickChip" web/src/multiplayer/remoteStore.test.ts`.

- [ ] **Step 2: Replace chip-bookkeeping assertions with mirror assertions.** For each test:
  - Keep tests that assert **sent messages** on `stake`/`clearBets`/`deal`/`settle` — but rename `placeHand`/`placeChip` calls to `stake(kind)` / `stake(kind, denom)` and assert `send` was called with `{ type: "bet", kind, amount }`.
  - Replace any test asserting rack/pending/drift reconciliation with a single mirror test:

```ts
test("a settle push records the round's delta and bumps the popup", () => {
  // build the remote store via createRemoteStore with a Dealing view, then:
  store.handle({ type: "state", view: settledView }); // Dealing→Settled, bankroll up 2500
  expect(store.getState().lastDelta).toBe(2500);
  expect(store.getState().settleSeq).toBe(1);
  expect(store.getState().snapshot.phase).toBe("Settled");
});
```

  (Use the file's existing view-builder helpers; mirror the `TableViewMsg` shape already used there.)

- [ ] **Step 3: Run remote tests.** Run `npx vitest run src/multiplayer/remoteStore.test.ts`. Expected: PASS.

### Task C6: Rewrite the `Chip` component as a selectable denomination

**Files:** Modify `web/src/components/Chip.tsx`, `web/src/components/Chip.test.tsx`.

- [ ] **Step 1: Replace the `Chip` component.** Keep `CHIP_COLOR`, `chipFace`, and `MiniChip`. Replace `ChipProps` + `Chip` with:

```tsx
interface ChipProps {
  cents: number;
  /** The armed chip is highlighted. */
  selected: boolean;
  /** Greyed when the balance can't cover it. */
  disabled?: boolean;
  onSelect: (cents: number) => void;
}

/** A casino chip denomination. Click to arm it; drag one onto a spot. */
export function Chip({ cents, selected, disabled, onSelect }: ChipProps) {
  return (
    <button
      type="button"
      className={`chip ${CHIP_COLOR[cents] ?? ""}${selected ? " chip--armed" : ""}`}
      aria-label={`${formatCents(cents)} chip`}
      aria-pressed={selected}
      disabled={disabled}
      draggable={!disabled}
      onDragStart={(e) => {
        e.dataTransfer.setData("text/plain", String(cents));
        e.dataTransfer.effectAllowed = "copy";
      }}
      onClick={() => onSelect(cents)}
    >
      <span className="chip-face">{chipFace(cents)}</span>
    </button>
  );
}
```

- [ ] **Step 2: Add the armed style.** In `betrail.css` (or wherever `.chip` is styled — `grep -n "\.chip\b" web/src/components/*.css`), add:

```css
.chip--armed {
  outline: 3px solid var(--gold);
  outline-offset: 2px;
}
```

- [ ] **Step 3: Replace `Chip.test.tsx`.** Run `grep -n "onPick\|count\|chip" web/src/components/Chip.test.tsx` first, then replace its `Chip`-specific tests with:

```tsx
test("clicking a chip arms its denomination", async () => {
  const onSelect = vi.fn();
  render(<Chip cents={2500} selected={false} onSelect={onSelect} />);
  await userEvent.click(screen.getByRole("button", { name: "$25.00 chip" }));
  expect(onSelect).toHaveBeenCalledWith(2500);
});

test("the armed chip is pressed; an unaffordable chip is disabled", () => {
  const { rerender } = render(<Chip cents={2500} selected onSelect={vi.fn()} />);
  expect(screen.getByRole("button", { name: "$25.00 chip" })).toHaveAttribute("aria-pressed", "true");
  rerender(<Chip cents={2500} selected={false} disabled onSelect={vi.fn()} />);
  expect(screen.getByRole("button", { name: "$25.00 chip" })).toBeDisabled();
});
```

(Keep any `MiniChip` test unchanged.)

- [ ] **Step 4: Typecheck.** Run `npx tsc --noEmit`. Expected: errors now only in `BetRail.tsx`, `App.tsx`, `BetRail.test.tsx`.

### Task C7: Rewire `BetRail` to the balance model

**Files:** Modify `web/src/components/BetRail.tsx`.

- [ ] **Step 1: Replace imports + props.** Change `import { type Rack } from "../chips";` to `import { toChips } from "../chips";`. Replace `BetRailProps` with:

```tsx
interface BetRailProps {
  snapshot: RoundSnapshot;
  denoms: number[];
  /** The armed chip denomination. */
  selectedChip: number;
  /** Cents free to bet (bankroll − staked). */
  available: number;
  onSelectChip: (denom: number) => void;
  onStake: (kind: BetKind, denom?: number) => void;
  onClear: () => void;
}
```

- [ ] **Step 2: Rewrite `chipsOn` to sum amounts.** Replace it with:

```tsx
/** Total cents staked on one spot. */
function stakedOn(kind: BetKind, bets: PlacedBet[]): number {
  const key = JSON.stringify(kind);
  return bets.reduce((sum, b) => (JSON.stringify(b.kind) === key ? sum + b.amount : sum), 0);
}
```

- [ ] **Step 3: Rewrite `BetSpot`.** Replace `BetSpotProps` + `BetSpot` with:

```tsx
interface BetSpotProps {
  spot: Spot;
  betting: boolean;
  staked: number;
  shape: string;
  denoms: number[];
  onStake: (kind: BetKind, denom?: number) => void;
}

function BetSpot({ spot, betting, staked, shape, denoms, onStake }: BetSpotProps) {
  const chips = toChips(staked, denoms).chips;
  return (
    <button
      type="button"
      className={`spot spot--${shape}`}
      aria-label={`Bet ${spot.label}`}
      disabled={!betting}
      onClick={() => onStake(spot.kind)}
      onDragOver={(e) => {
        if (betting) e.preventDefault();
      }}
      onDrop={(e) => {
        e.preventDefault();
        const cents = Number(e.dataTransfer.getData("text/plain"));
        if (betting && Number.isFinite(cents) && cents > 0) onStake(spot.kind, cents);
      }}
    >
      <span className="spot-name">{spot.display}</span>
      <span className="spot-payout">{spot.payout}</span>
      {staked > 0 && (
        <span className="spot-chips">
          {chips.slice(0, 8).map((c, i) => (
            <MiniChip key={i} cents={c} />
          ))}
          <span className="spot-stake">{formatCents(staked)}</span>
        </span>
      )}
    </button>
  );
}
```

- [ ] **Step 4: Rewrite the `BetRail` body.** Replace the component signature + body so it uses the new props, passes `staked`/`denoms`/`onStake` to every `BetSpot`, drops the hand tray + Exchange button, and renders selectable chips. The full new component (keeping the Slice-B drawer):

```tsx
export function BetRail({
  snapshot,
  denoms,
  selectedChip,
  available,
  onSelectChip,
  onStake,
  onClear,
}: BetRailProps) {
  const betting = snapshot.phase === "Betting";
  const canBet = betting || snapshot.phase === "Settled";
  const [showBonusInfo, setShowBonusInfo] = useState(false);

  const sideStaked = snapshot.bets.some(
    (b) => typeof b.kind === "object" && "Side" in b.kind,
  );
  const [sideOpenPref, setSideOpenPref] = useState(loadSideOpen);
  const sideOpen = sideOpenPref || sideStaked;
  const toggleSide = () => {
    const next = !sideOpen;
    setSideOpenPref(next);
    saveSideOpen(next);
  };

  return (
    <section aria-label="Bet rail" className="bet-rail">
      <div className="felt" aria-label="Spots">
        <div className="main-bets">
          {MAIN_SPOTS.map((spot) => (
            <BetSpot
              key={spot.label}
              spot={spot}
              betting={canBet}
              staked={stakedOn(spot.kind, snapshot.bets)}
              shape={spot.label.toLowerCase()}
              denoms={denoms}
              onStake={onStake}
            />
          ))}
        </div>
        <div className="side-drawer">
          <div className="side-drawer-head">
            <button
              type="button"
              className="side-toggle"
              aria-expanded={sideOpen}
              aria-controls="side-bets"
              onClick={toggleSide}
            >
              {sideOpen ? "▾" : "▸"} Side bets
            </button>
            <button
              type="button"
              className="bonus-info-btn"
              aria-label="What are the bonus bets?"
              onClick={() => setShowBonusInfo(true)}
            >
              i
            </button>
          </div>
          <div
            id="side-bets"
            className={`side-bets${sideOpen ? " side-bets--open" : ""}`}
            hidden={!sideOpen}
          >
            {SIDE_SPOTS.map((spot) => (
              <BetSpot
                key={spot.label}
                spot={spot}
                betting={canBet}
                staked={stakedOn(spot.kind, snapshot.bets)}
                shape="side"
                denoms={denoms}
                onStake={onStake}
              />
            ))}
          </div>
        </div>
      </div>

      <div className="rail-row">
        <p className="rail-hint">
          {betting
            ? "Tap a chip, then tap a spot. Or drag a chip onto a spot."
            : snapshot.phase === "Settled"
              ? "Hand over — tap a spot to play the next one."
              : "Bets are locked — squeeze the cards."}
        </p>
        <button
          type="button"
          className="clear-bets"
          disabled={!betting || snapshot.bets.length === 0}
          onClick={onClear}
        >
          Clear bets
        </button>
      </div>

      <div aria-label="Chips" className="chips">
        {denoms.map((cents) => (
          <Chip
            key={cents}
            cents={cents}
            selected={cents === selectedChip}
            disabled={!canBet || cents > available}
            onSelect={onSelectChip}
          />
        ))}
        <span className="change-note">{formatCents(available)} to bet</span>
      </div>

      {showBonusInfo && <BonusInfoModal onClose={() => setShowBonusInfo(false)} />}
    </section>
  );
}
```

- [ ] **Step 5: Drop dead CSS.** In `betrail.css`, remove the `.hand-tray`, `.hand-chips`, `.hand-total`, `.hand-return`, and `.exchange-btn` rules (no longer rendered). Leave `.rail-row`, `.rail-hint`, `.clear-bets`, `.chips`, `.change-note`.

- [ ] **Step 6: Typecheck.** Run `npx tsc --noEmit`. Expected: errors now only in `App.tsx` and `BetRail.test.tsx`.

### Task C8: Rewrite `BetRail.test.tsx` for the balance flow

**Files:** Modify `web/src/components/BetRail.test.tsx`.

- [ ] **Step 1: Replace the prop bag + tests.** Replace the file with:

```tsx
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { BetRail } from "./BetRail";
import { bettingSnapshot, dealingSnapshot } from "../test/fixtures";
import { CHIP_DENOMINATIONS } from "../chips";

const noopProps = {
  denoms: CHIP_DENOMINATIONS,
  selectedChip: 2500,
  available: 1_000_000,
  onSelectChip: vi.fn(),
  onStake: vi.fn(),
  onClear: vi.fn(),
};

test("clicking a chip arms its denomination", async () => {
  const onSelectChip = vi.fn();
  render(<BetRail snapshot={bettingSnapshot()} {...noopProps} onSelectChip={onSelectChip} />);
  await userEvent.click(screen.getByRole("button", { name: "$5.00 chip" }));
  expect(onSelectChip).toHaveBeenCalledWith(500);
});

test("clicking a spot stakes the armed chip there", async () => {
  const onStake = vi.fn();
  render(<BetRail snapshot={bettingSnapshot()} {...noopProps} onStake={onStake} />);
  await userEvent.click(screen.getByRole("button", { name: "Bet Player" }));
  expect(onStake).toHaveBeenCalledWith({ Main: "Player" });
});

test("dropping a chip on a spot stakes that denomination", () => {
  const onStake = vi.fn();
  render(<BetRail snapshot={bettingSnapshot()} {...noopProps} onStake={onStake} />);
  const spot = screen.getByRole("button", { name: "Bet Banker" });
  fireEvent.drop(spot, { dataTransfer: { getData: () => "50000" } });
  expect(onStake).toHaveBeenCalledWith({ Main: "Banker" }, 50000);
});

test("a chip dropped outside Betting is ignored", () => {
  const onStake = vi.fn();
  render(<BetRail snapshot={dealingSnapshot()} {...noopProps} onStake={onStake} />);
  fireEvent.drop(screen.getByRole("button", { name: "Bet Banker" }), {
    dataTransfer: { getData: () => "50000" },
  });
  expect(onStake).not.toHaveBeenCalled();
});

test("staked totals render on their spot", () => {
  const snap = bettingSnapshot({
    bets: [
      { kind: { Main: "Player" }, amount: 12500 },
      { kind: { Main: "Banker" }, amount: 2500 },
    ],
  });
  render(<BetRail snapshot={snap} {...noopProps} />);
  expect(screen.getByRole("button", { name: "Bet Player" })).toHaveTextContent("$125.00");
  expect(screen.getByRole("button", { name: "Bet Banker" })).toHaveTextContent("$25.00");
});

test("a chip past the available balance is disabled", () => {
  render(<BetRail snapshot={bettingSnapshot()} {...noopProps} available={2500} />);
  expect(screen.getByRole("button", { name: "$1,000.00 chip" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "$25.00 chip" })).toBeEnabled();
});

test("bet spots are disabled outside the Betting phase", () => {
  render(<BetRail snapshot={dealingSnapshot()} {...noopProps} />);
  expect(screen.getByRole("button", { name: "Bet Player" })).toBeDisabled();
});

test("side bets are hidden until the drawer is opened", async () => {
  render(<BetRail snapshot={bettingSnapshot()} {...noopProps} />);
  expect(screen.queryByRole("button", { name: "Bet Dragon 7" })).toBeNull();
  await userEvent.click(screen.getByRole("button", { name: /Side bets/ }));
  expect(screen.getByRole("button", { name: "Bet Dragon 7" })).toBeInTheDocument();
});

test("a staked side bet forces the drawer open", () => {
  const snap = bettingSnapshot({ bets: [{ kind: { Side: "Dragon7" }, amount: 500 }] });
  render(<BetRail snapshot={snap} {...noopProps} />);
  expect(screen.getByRole("button", { name: "Bet Dragon 7" })).toBeInTheDocument();
});

test("the info icon opens the bonus-bets explainer", async () => {
  render(<BetRail snapshot={bettingSnapshot()} {...noopProps} />);
  await userEvent.click(screen.getByRole("button", { name: "What are the bonus bets?" }));
  expect(screen.getByRole("dialog", { name: "Bonus bets" })).toHaveTextContent(/Dragon 7/);
});

test("Clear bets is disabled when nothing is staked", () => {
  render(<BetRail snapshot={bettingSnapshot()} {...noopProps} />);
  expect(screen.getByRole("button", { name: "Clear bets" })).toBeDisabled();
});
```

> `localStorage` persistence: jsdom provides it. The drawer default is closed; the "hidden until opened" test relies on that. If a prior test opened it (shared jsdom storage), clear it — add `beforeEach(() => localStorage.clear());` at the top.

- [ ] **Step 2: Run BetRail tests.** Run `npx vitest run src/components/BetRail.test.tsx`. Expected: PASS.

### Task C9: Rewire `App.tsx` and delete `ExchangeModal`

**Files:** Modify `web/src/App.tsx`; delete `web/src/components/ExchangeModal.tsx` and its test.

- [ ] **Step 1: Remove exchange + chip selectors.** In `App.tsx`:
  - Delete the import `import { ExchangeModal } from "./components/ExchangeModal";`.
  - Delete the `const [exchanging, setExchanging] = useState(false);` line.
  - Delete the selectors: `rack`, `change`, `hand`, `stagedChips`, `pickChip`, `returnHand`, `placeHand`, `placeChip`, `exchangeBreak`, `exchangeAcquire`.
  - Add selectors:

```tsx
  const selectedChip = useStore(active, (s) => s.selectedChip);
  const selectChip = useStore(active, (s) => s.selectChip);
  const stake = useStore(active, (s) => s.stake);
```

- [ ] **Step 2: Compute `available`.** After the selectors (before `return`), add:

```tsx
  const available = snapshot.bankroll - snapshot.bets.reduce((a, b) => a + b.amount, 0);
```

- [ ] **Step 3: Replace the `<BetRail .../>` props.**

```tsx
        <BetRail
          snapshot={snapshot}
          denoms={denoms}
          selectedChip={selectedChip}
          available={available}
          onSelectChip={selectChip}
          onStake={stake}
          onClear={clearBets}
        />
```

- [ ] **Step 4: Delete the `<ExchangeModal .../>` block** (the `{exchanging && (...)}` JSX near the end).

- [ ] **Step 5: Delete the files.**

```bash
git rm web/src/components/ExchangeModal.tsx web/src/components/ExchangeModal.test.tsx
```

(If `ExchangeModal.test.tsx` doesn't exist, just `git rm` the component.)

- [ ] **Step 6: Typecheck.** Run `npx tsc --noEmit`. Expected: clean (or only `App.test.tsx` / integration tests left).

### Task C10: Fix `App.test.tsx` and integration tests for the balance flow

**Files:** Modify `web/src/App.test.tsx`, `web/src/store/gameStore.integration.test.ts`, `web/src/store/tableSession.integration.test.ts`.

- [ ] **Step 1: Find chip-flow drivers.** Run:

```bash
grep -rn "pick up\|in hand\|Return\|Exchange\|chip\b\|hand-tray\|Chips in hand" web/src/App.test.tsx web/src/store/*.integration.test.ts
```

- [ ] **Step 2: Convert betting interactions.** Where a test placed a bet by picking chips into the hand then clicking a spot, replace with the tap flow: click a chip (arms it), then click the spot (stakes it). Example:

```tsx
// before: pick $25 + $5 into hand, click Player
await userEvent.click(screen.getByRole("button", { name: "$25.00 chip" }));
await userEvent.click(screen.getByRole("button", { name: "Bet Player" }));
// the staked total shows on the spot
expect(screen.getByRole("button", { name: "Bet Player" })).toHaveTextContent("$25.00");
```

- [ ] **Step 3: Remove dead chip assertions.** Delete assertions about the rack count badge, "in hand" text, change notes that no longer exist. Keep outcome/bankroll/scoreboard assertions.

- [ ] **Step 4: Run the suite.** Run `npx vitest run`. Expected: PASS. Fix any remaining references one file at a time.

- [ ] **Step 5: Typecheck.** Run `npx tsc --noEmit`. Expected: clean.

- [ ] **Step 6: Commit Slice C.**

```bash
cd web && npx vitest run && npx tsc --noEmit
git add -A
git commit -m "feat(web): balance betting — tap a chip, tap a spot; delete chip inventory + exchange

Money is a single balance; available = bankroll − staked. Both stores drop
the rack/change/hand/staged model and the exchange; chips.ts keeps only
display helpers. BetRail arms a denomination and stakes it on tap or drag.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

**Slice C checkpoint:** no exchange, no hand tray; tap a chip you can afford, tap a spot, stack by tapping again; the felt shows the staked total as chips.

---

# Final: verify + merge

### Task F1: Browser verification

- [ ] **Step 1:** `cd web && npm run dev`. Drive a full single-player round: pick a table, arm a chip, tap Player to stake, open the side drawer and stake a bonus, Deal, squeeze/reveal both hands, and confirm the round **auto-settles and auto-advances** to a fresh betting round with no button clicks.
- [ ] **Step 2:** Confirm: unaffordable chips grey out as the balance drops; "Clear bets" empties the felt and restores "to bet"; a busted roll shows the BustModal and does **not** auto-advance; the side drawer remembers open/closed across a reload.
- [ ] **Step 3:** Screenshot the table (use the project's verify/run tooling). Tune `AUTO_SETTLE_MS` / `AUTO_ADVANCE_MS` if the pacing feels off; commit any tuning as `fix(web): squeeze/advance pacing`.

### Task F2: Gates + merge

- [ ] **Step 1:** `cd web && npx vitest run && npx tsc --noEmit && npm run build`. All green.
- [ ] **Step 2:** Merge to `main` and push (CI runs cargo + vitest gates and deploys Pages):

```bash
git checkout main && git merge --ff-only feat/ui-simplification && git push origin main
git branch -d feat/ui-simplification
```

- [ ] **Step 3:** Verify the live site after CI.

---

## Self-Review Notes

- **Spec coverage:** A — Tasks A1-A3 (buttons multiplayer-only, auto-settle, auto-advance, suppressed on bust/goal). B — Tasks B1-B2 (drawer, auto-open when staked, persisted, reduced-motion). C — Tasks C1-C10 (balance model both stores, `chips.ts` trim, tap-to-stake + drag, exchange deleted, available = bankroll − staked, test rewrites). Cross-cutting — F1 covers reduced-motion/persistence/bust manually; multiplayer protocol untouched (C4/C5).
- **Type consistency:** `GameState` adds `selectedChip: number`, `selectChip(denom)`, `stake(kind, denom?)`, keeps `denoms`; both stores implement the identical shape (C2, C4). `BetRail` props (`selectedChip`, `available`, `onSelectChip`, `onStake`, `onClear`) match App's wiring (C9) and the test prop bag (C8). `Chip` props (`selected`, `disabled`, `onSelect`) match BetRail's usage (C7) and its test (C6). `stakedOn`/`toChips` names consistent across C7/C8.
- **Known soft spots flagged for the implementer:** the A2 App test and the C10 integration edits depend on each file's existing store-injection harness — the plan says to mirror it rather than inventing a new one. The B/C drawer tests clear `localStorage` to avoid cross-test bleed.
