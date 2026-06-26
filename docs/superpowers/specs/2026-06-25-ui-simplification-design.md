# Table UI Simplification — Design Spec

**Date:** 2026-06-25
**Status:** Approved (design), pending implementation plan

## Goal

Make the baccarat table calmer and faster to play by removing three sources of friction, without removing any betting options:

- **A. Auto-advance** — drop the Settle and Next-hand buttons; the round settles itself when the cards are up and returns to betting on its own.
- **B. Side-bet drawer** — the table shows only Player / Tie / Banker by default; the six bonus bets live in a one-tap collapsible drawer.
- **C. Balance betting** — delete the discrete chip-inventory + exchange system; money is a single balance, and you bet by tapping a chip you can afford then tapping a spot.

The three are independent slices sharing a few files; build order A → B → C, each a green checkpoint.

---

## Current state (ground truth)

- **Phases** (`engine/types.ts`): `"Betting" | "Dealing" | "Settled"`. The engine returns to Betting the instant you settle; the UI *holds* the Settled view to keep payouts on the felt.
- **Settle / Next hand**: `components/Controls.tsx:49-54`, wired in `App.tsx:204` (`onSettle={settle}`, `onNewHand={newHand}`).
- **Reveal**: `App.tsx:107-147` (`revealAll`) flips your cards one per 900 ms beat; the house dealer's pacer (`gameStore.ts:130-148`) turns unbet hands. Phase stays `"Dealing"` until every card is `FaceUp`.
- **Win popup / bust / goal**: `App.tsx:229` (`WinPopup key={settleSeq} amount={lastDelta}`), `:241` VictoryModal on `goalReached`, `:252` BustModal on `busted`. `settle()` sets `lastDelta`, `settleSeq`, `goalReached`, `busted` (`gameStore.ts:287-300`).
- **Chip model** (the part being deleted): a discrete `Rack` of `{denom: count}` plus loose `change`, a picked-up `hand: number[]`, and `stagedChips: number[][]` parallel to `snapshot.bets`. Invariant: `rackTotal(rack) + change + sum(hand) + sum(stagedChips) === bankroll`. Defined in `chips.ts`; held in `GameState` (`gameStore.ts:68-77`); **reimplemented in full in `multiplayer/remoteStore.ts`** including a drift-guard re-rack in `handle()` (`remoteStore.ts:158-258`).
- **Exchange**: `components/ExchangeModal.tsx`, opened from BetRail's "Exchange" button (`BetRail.tsx:192`), wired in `App.tsx:264-273`. Exists only because chips are discrete — it breaks/colors-up/acquires denominations.
- **Bet placing today**: tap chips into a "hand" tray (`BetRail.tsx:163-174`), then tap a spot (`onPlaceHand`), or drag a chip (`onPlaceChip`, drags the whole hand along).

---

## A. Auto-advance

### Behavior
1. Player reveals cards (squeeze or "Reveal all"); the house dealer turns unbet hands.
2. When **every card in both hands is `FaceUp`** (so no `Peeked`/`FaceDown` remain) and no dealer flip is pending, the round **auto-settles** after a ~600 ms beat (lets the final flip animation land).
3. The win/loss popup shows. ~1400 ms later the felt **auto-clears** back to Betting (`newHand`).
4. **Suppressed when `busted` or `goalReached`** — the BustModal / VictoryModal owns the moment instead; no auto-advance into an unplayable round.

### Scope: single-player only
Auto-settle and auto-advance apply to the **single-player table** (`seats === null`) — the experience this change targets. **Multiplayer keeps its Settle / Next-hand buttons** because its server is authoritative and paces coups; I can't verify (server may be offline) whether it depends on a client-initiated settle, so I won't change that contract. This mirrors the existing by-mode button pattern in `Controls` (Sit out is multiplayer-only, Reveal all is single-player-only).

### Changes
- `App.tsx` (`GameTable`): pass `onSettle` / `onNewHand` to `Controls` **only in multiplayer** (`seats !== null ? settle : undefined`, likewise `newHand`). In single-player they're `undefined`.
- `components/Controls.tsx`: render the Settle and Next-hand buttons **only when their handlers are provided** (`{onSettle && …}`, `{onNewHand && …}`), exactly like `onSitOut` / `onRevealAll` today. Single-player → no buttons.
- `App.tsx` (`GameTable`): add two effects, both gated on `seats === null`.
  - **Auto-settle**: when `phase === "Dealing"` and every dealt card is `FaceUp`, `setTimeout(settle, AUTO_SETTLE_MS)`. Guard with a ref so it fires once per coup (reset when a new deal begins); clear the timer on cleanup.
  - **Auto-advance**: when `phase === "Settled"` and not `busted` and not `goalReached`, `setTimeout(newHand, AUTO_ADVANCE_MS)`; clear on cleanup.
- Keep: Deal, Reveal all, Sit out, New Shoe, Explain.
- Timing constants are named consts in `App.tsx` (`AUTO_SETTLE_MS = 600`, `AUTO_ADVANCE_MS = 1400`) for easy tuning.

### Notes / out of scope
- The shoe still only reshuffles via the **New Shoe** button (kept). Endless auto-advance depletes a shoe faster; a low-shoe auto-prompt is **out of scope** for this pass.
- The "touch a chip after a settled round starts the next hand" branch in the stores becomes redundant in single-player (auto-advance gets there first) but is left in place (harmless) and still serves multiplayer.

---

## B. Side-bet drawer

### Behavior
- Default felt shows only the three main bets (Player / Tie / Banker).
- A single **"▸ Side bets"** toggle row sits below the mains. Tapping it slides the six bonus spots in (Player Pair, Banker Pair, Dragon 7, Panda 8, Dragon Bonus, Tiger). The bonus-info **ⓘ** moves into the drawer's header.
- The drawer **auto-opens when any side bet is currently staked** (a `{Side: …}` entry in `snapshot.bets`), so live action is always visible.
- Open/closed state **persists across reloads** (localStorage), so a habitual side-bettor keeps it open.
- Slide animation respects `prefers-reduced-motion` (instant show/hide).

### Changes
- `components/BetRail.tsx`: wrap the `.side-bets` block in a drawer. Local `showSide` state seeded from localStorage and forced open when a side bet is staked. Toggle is a real `<button aria-expanded aria-controls>`. Move the bonus-info button into the drawer header.
- `components/betrail.css`: drawer wrapper + toggle styles; height/opacity transition; `@media (prefers-reduced-motion: reduce)` disables it. Keep the existing `.side-bets` 6/3-column grids for the expanded content.
- No store or engine changes. All six bonuses remain fully functional.

---

## C. Balance betting (delete discrete chips + exchange)

### New model
Money is just the engine bankroll (already the source of truth, already persisted per tier via `bankrollStorage.ts`). Betting does not change the bankroll until settle, so:

```
available to bet = snapshot.bankroll − sum(snapshot.bets[*].amount)
```

There is no rack, no loose change, no hand tray, no staged-chip array, no exchange.

### Betting interaction
- **Tap a chip** to *arm* that denomination (`selectedChip`). A chip is **disabled when its denomination exceeds `available`**.
- **Tap a spot** to stake the armed chip there; tap again to stack. Each tap calls `session.placeBet(kind, selectedChip)`.
- **Clear bets** removes all staked bets (bankroll never dropped, so nothing to refund beyond clearing the bets).
- **Drag-to-place** stays as a secondary shortcut: dropping a chip on a spot stakes that denomination directly (independent of the armed chip). The old "drag drags your whole hand" behavior dies with the hand.
- Felt chip graphics are **derived for display only**: each spot sums its bets of that kind and decomposes the total via `toChips(total, denoms)` into `MiniChip`s, with the cents label.

### `GameState` changes (shared by both stores)
Remove fields: `rack`, `change`, `hand`, `stagedChips`, and actions `pickChip`, `returnHand`, `placeHand`, `placeChip`, `exchangeBreak`, `exchangeColorUp`, `exchangeAcquire`.

Add:
- `selectedChip: number` — the armed denomination; initialized to the table's smallest denom.
- `selectChip(denom: number): void` — arm a denomination.
- `stake(kind: BetKind, denom?: number): void` — place a chip (defaults to `selectedChip`; `denom` set by drag). No-op if the amount exceeds `available` or phase isn't bettable.

Keep: `clearBets`, `deal`, `peek`, `reveal`, `settle`, `newHand`, `newShoe`, and everything non-chip.

Derived (selector or computed in `App.tsx`): `available = bankroll − sum(bets)`.

### Store simplifications
- **`gameStore.ts`**: `settle()` collapses to `lastDelta = after − before`, `settleSeq++`, `goalReached`/`busted` checks, `apply(result)` — no chip resolution loop. `deal()`/`newShoe()` drop the `returnHand()` call. Initial state drops `buyIn`.
- **`remoteStore.ts`**: the `handle()` reconciliation loses all chip bookkeeping (pending chips, pay/sweep on settle, the drift-guard re-rack). It becomes: apply the pushed snapshot, compute `lastDelta`/`settleSeq` on a settle transition, set `lastFlip`. `stake` sends `{type:"bet", kind, amount}`; `selectedChip` is local UI state. This is a large net deletion.
- **`chips.ts`**: keep `CHIP_DENOMINATIONS` and `toChips` (display). Delete `Rack`, `emptyRack`, `rackTotal`, `buyIn`, `addChips`, `removeChips`, `breakChip`, `colorUp`, `mintChange`, `acquire`.

### Component changes
- **`BetRail.tsx`**: props become `{ snapshot, denoms, selectedChip, available, onSelectChip, onStake, onClear }` (+ the drawer from B). Remove the hand tray and the Exchange button. Chip buttons show `aria-pressed` for the armed one and disable when unaffordable. Update `chipsOn` to sum bet amounts and decompose for display.
- **`App.tsx`**: drop the exchange state + `ExchangeModal`; swap the chip/hand selectors for `selectedChip`/`available`/`selectChip`/`stake`; update BetRail and Controls wiring; add the Change-A effects.
- **Delete** `components/ExchangeModal.tsx` (and its test).

### Test impact (expected, not lost coverage)
- `chips.test.ts`: drop tests for deleted functions; keep `toChips`.
- `store/gameStore.test.ts`: replace chip-invariant tests with balance tests — placing reduces `available`, settle moves `bankroll` and sets `lastDelta`, clear restores `available`, win/loss/push deltas.
- `multiplayer/remoteStore.test.ts`: rewrite for the simplified mirror (no re-rack); keep bet/settle/clear round-trips.
- `BetRail.test.tsx`, `Controls.test.tsx`, `App.test.tsx`, and the store integration tests: update for the new bet flow, the removed buttons, and auto-settle/auto-advance (drive reveals, assert the round settles and re-opens without button clicks).

---

## Cross-cutting

- **Multiplayer**: Change A is single-player only (multiplayer keeps its buttons, see above). Change C's `GameState` reshape still touches both stores; the wire `protocol.ts` carries bets/snapshots, not chip inventory, so it's unchanged. Verify a remote bet→deal→settle round-trip still reconciles (server may be unavailable; if so, lean on `remoteStore.test.ts`).
- **Persistence**: bankroll still saves per tier; untouched.
- **Accessibility**: drawer toggle is a labelled button with `aria-expanded`; the armed chip uses `aria-pressed`; auto-advance never traps focus.
- **Reduced motion**: drawer slide disabled; auto-advance timers still fire (not animation-bound).

## Build order
1. **A** — Controls + App effects (+ test updates). Smallest, isolated.
2. **B** — BetRail drawer + CSS. Medium, mostly presentational.
3. **C** — `GameState` reshape, both stores, `chips.ts` trim, BetRail/App rewire, delete ExchangeModal, test rewrites. Largest.

Each step ends with `npx vitest run` and `npx tsc --noEmit` green and the app driven in a browser.
