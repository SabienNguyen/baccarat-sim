# Squeeze & Card Rendering — Design (Web Plan 2)

**Date:** 2026-06-08
**Status:** Approved
**Parent spec:** `2026-06-07-baccarat-simulator-design.md` (§4 squeeze/peek ritual, §6 layout)
**Predecessor:** `2026-06-08-web-foundation-design.md` (the components this extends)

## 1. Purpose

Replace the web foundation's placeholder per-card "Reveal" buttons with the signature
**drag-to-squeeze** interaction on real (CSS-drawn) cards. Dragging a face-down card's corner
bends it to expose only the suit sliver (`peek`); dragging past a threshold — or releasing past
the peek point — flips the card face-up (`reveal`). This is the dramatic centerpiece of the
table. The interaction is a pure UI **pacing layer** over the engine: the engine's
`peek(side, index)` / `reveal(side, index)` commands control what the snapshot exposes, so the
front-end never sees an undrawn card early.

This is web Plan 2 of four:
1. Web foundation — playable, minimal style (DONE).
2. **Squeeze & card rendering (this spec).**
3. Balatro-retro styling pass — swirl felt, pixel-art cards, left HUD, juicy feedback.
4. Immersion & teaching — dealer narration, glossary hover, explain mode, other players.

## 2. Engine mechanics this builds on (verified)

From `engine/src/session.rs`:
- `peek(side, index)` sets the card's status to `Peeked`; the snapshot renders it as
  `CardView::Peeked { sliver: Pip { suit } }` — only the suit shows.
- `reveal(side, index)` sets status to `FaceUp`; renders as `CardView::FaceUp(Card)`.
- Both are valid **only in the Dealing phase** (else `WrongPhase`), accept any index in range
  (else `BadCardIndex`), in any order, idempotently. Peeking never downgrades an already
  face-up card.
- `settle()` auto-reveals every card before producing the Settled snapshot.

So the squeeze adds no engine logic; it only chooses **when** to call `peek`/`reveal`.

## 3. Scope

In scope:
- A new presentational **`Card`** component rendering a `CardView` as an actual card (face-down
  back, peeked bent-corner showing the suit sliver, face-up rank+suit), CSS-drawn.
- A new **`SqueezeCard`** component wrapping `Card` with pointer-drag handling and a
  click/keyboard fallback, dispatching `onPeek` / `onReveal` at thresholds.
- A tiny pure **threshold helper** mapping drag progress → the action to dispatch.
- Modifying **`Hand`** to render Dealing-phase cards as `SqueezeCard`s wired to the store, and
  Betting/Settled cards as static `Card`s.
- Modifying **`Controls`** to remove the per-card Reveal buttons and add a single
  **"Reveal all"** button (Dealing only) that reveals every still-hidden card.
- Tests for all of the above against mocked snapshots / synthetic pointer events (no wasm).

Out of scope (later plans): pixel-art card faces and back, bitmap font, felt/HUD retro skin
(all Plan 3); dealer narration of reveals, glossary, explain mode, other players (Plan 4);
multi-touch and mobile-specific gestures (pointer events cover mouse + touch generically; fancy
mobile polish is deferred). Money, betting, scoreboard, and the store/adapter boundary are
unchanged.

## 4. Architecture

```
web/src/
  components/
    Card.tsx          # NEW: presentational card visual for a CardView
    Card.test.tsx
    SqueezeCard.tsx   # NEW: drag/click interaction wrapping Card
    SqueezeCard.test.tsx
    Hand.tsx          # MODIFIED: Dealing -> SqueezeCard wired to store; else static Card
    Hand.test.tsx     # MODIFIED/EXTENDED
    Controls.tsx      # MODIFIED: drop per-card reveal buttons; add "Reveal all"
    Controls.test.tsx # MODIFIED
  squeeze.ts          # NEW: pure threshold helper
  squeeze.test.ts
```

### 4.1 `Card` (presentational)

```ts
interface CardProps {
  card: CardView;
  /** 0..1 corner-bend progress for the peeked state; ignored when not peeked. */
  bend?: number;
}
```
Renders:
- `"FaceDown"` → a card **back** (a CSS-styled rectangle with a back pattern), `aria-label="face-down card"`.
- `{ Peeked: { sliver } }` → the back with a **bent corner** revealing the suit glyph
  (`♣♦♥♠`) of `sliver.suit`; the corner bend size scales with `bend` (default a small fixed
  bend if `bend` is undefined). `aria-label` like `"peeked card, Spades"`.
- `{ FaceUp: card }` → a **face** showing rank (A,2–10,J,Q,K) and suit glyph, colored red for
  Hearts/Diamonds and black for Clubs/Spades. `aria-label` like `"Nine of Hearts"`.

No interaction, no store. Rank/suit are mapped to display strings by small pure helpers.

### 4.2 `squeeze.ts` (pure threshold logic)

```ts
export type SqueezeAction = "none" | "peek" | "reveal";
export const PEEK_AT = 0.25;   // progress (0..1) at which the suit sliver shows
export const REVEAL_AT = 0.7;  // progress at which the card flips
/** Map a drag progress (0..1) to the action that should fire at that progress. */
export function actionForProgress(progress: number): SqueezeAction;
```
`actionForProgress(p)` returns `"reveal"` if `p >= REVEAL_AT`, `"peek"` if `p >= PEEK_AT`, else
`"none"`. Pure and unit-tested at the boundaries.

### 4.3 `SqueezeCard` (interaction)

```ts
interface SqueezeCardProps {
  card: CardView;
  onPeek: () => void;    // dispatch store.peek(side, index)
  onReveal: () => void;  // dispatch store.reveal(side, index)
}
```
Behavior:
- Holds local `bend` progress state (0..1); not engine state.
- **Pointer drag:** on `pointerdown` over the card, capture the pointer and record the start Y.
  On `pointermove`, compute `progress = clamp((startY - currentY) / DRAG_DISTANCE_PX, 0, 1)`
  (dragging up peels the corner; `DRAG_DISTANCE_PX` a small constant, e.g. 120). Update `bend`.
  When `actionForProgress(progress)` first reaches `"peek"`, call `onPeek()` once; when it first
  reaches `"reveal"`, call `onReveal()` once. On `pointerup`: if progress ≥ PEEK_AT but <
  REVEAL_AT, treat the release as committing the flip → call `onReveal()` (releasing a started
  squeeze flips it); reset local `bend`.
- **Guards:** fire `onPeek`/`onReveal` at most once each per mount-state; if `card` is already
  `FaceUp`, the component renders the static face and ignores drags. If already `Peeked`,
  dragging continues toward reveal (don't re-peek).
- **Click/keyboard fallback:** the card is a focusable control (`role="button"`,
  `tabIndex=0`). A click (or Enter/Space) advances one step: face-down → `onPeek()`; peeked →
  `onReveal()`. This guarantees usability without a drag and gives tests a simple path.
- Renders `<Card card={card} bend={bend} />` plus the interaction wiring.

The engine is the source of truth for the displayed state: after `onPeek`/`onReveal` updates
the store, the new snapshot flows back and `card` becomes `Peeked` / `FaceUp`. Local `bend` is
only the in-flight animation amount.

### 4.4 `Hand` (modified)

```ts
interface HandProps {
  side: Side;
  hand: HandView;
  phase: PhaseTag;
  onPeek?: (index: number) => void;
  onReveal?: (index: number) => void;
}
```
- In `Dealing`, render each card as `<SqueezeCard card={c} onPeek={() => onPeek?.(i)}
  onReveal={() => onReveal?.(i)} />`.
- In `Betting`/`Settled`, render each card as a static `<Card card={c} />`.
- Keep showing `hand.total` when not `null` (unchanged).
The `App` passes `phase={snapshot.phase}` and wires `onPeek`/`onReveal` to `store.peek(side, i)`
/ `store.reveal(side, i)`.

### 4.5 `Controls` (modified)

- Remove the per-card `Reveal {side} {index}` buttons.
- Add one **"Reveal all"** button, enabled only in `Dealing`, that calls a new
  `onRevealAll()` callback. `App` implements `onRevealAll` by calling `store.reveal(side, i)`
  for every not-yet-FaceUp card index in both hands (reusing the same `hiddenIndices` logic,
  which moves into a shared helper or stays local to `App`).
- Keep `Deal`, `Settle`, `New Shoe` exactly as before.

## 5. Data flow

```
pointer drag / click on a card  →  (threshold)  →  store.peek/reveal(side,i)
   →  engine sets Peeked/FaceUp  →  new RoundSnapshot  →  card re-renders in new state
```
Strictly one-directional; the drag/bend is transient UI state that never bypasses the engine.

## 6. Testing strategy

All Vitest + RTL, mocked — no wasm:
- **`squeeze.ts`:** `actionForProgress` returns `none`/`peek`/`reveal` at and around `PEEK_AT`
  and `REVEAL_AT` boundaries.
- **`Card`:** renders back for FaceDown; renders the suit glyph (not the rank) for Peeked;
  renders rank+suit with correct color for FaceUp; sensible `aria-label`s.
- **`SqueezeCard`:** (a) click fallback: first click calls `onPeek`, a second click on a
  now-`Peeked` card calls `onReveal`; (b) pointer drag: synthetic `pointerdown` + `pointermove`
  crossing `PEEK_AT` calls `onPeek` once; crossing `REVEAL_AT` calls `onReveal` once; (c) a
  `FaceUp` card ignores interaction. Use `@testing-library/user-event`/`fireEvent` with
  `pointer*` events and `clientY` deltas; jsdom doesn't do layout, so the component must compute
  progress purely from pointer coordinates and a constant distance (not from `getBoundingClientRect`
  sizes that jsdom returns as 0) — keep the math coordinate-based so tests are deterministic.
- **`Hand`:** in `Dealing`, clicking a card invokes `onPeek(index)` with the right index; in
  `Settled`, cards are static (no peek/reveal wiring) and totals show.
- **`Controls`:** "Reveal all" is enabled only in `Dealing` and calls `onRevealAll`; the old
  per-card reveal buttons are gone.
- **`App`:** still mounts with the injected fake store; the Dealing wiring (`onPeek`/`onReveal`/
  `onRevealAll`) calls the store actions. Existing 30 tests stay green (adjusting the few that
  referenced the removed per-card Reveal buttons / old `Hand`/`Controls` props).

## 7. Open items

- **7.1 Drag distance & thresholds** (`DRAG_DISTANCE_PX`, `PEEK_AT`, `REVEAL_AT`) are tuned by
  feel during implementation; the values above are sensible defaults and are the unit-test
  anchors. Changing them later only touches `squeeze.ts`/`SqueezeCard`.
- **7.2 Animation fidelity.** Plan 2 uses CSS transforms for the corner bend and a `rotateY`
  flip — enough to feel like a squeeze. The juicy, pixel-art, particle-laden version (and real
  card art/back) is Plan 3; this plan must not block on assets.
- **7.3 `hiddenIndices` location.** The "not yet FaceUp" index computation currently lives in
  `Controls`; with the buttons removed it moves to where `onRevealAll` is implemented (App) or
  a small shared `cards.ts` helper — the plan picks one and keeps it DRY.
