# Web Plan 3 — Balatro-Retro Styling Pass — Design Spec

**Date:** 2026-06-09
**Status:** Approved for planning

## 1. Purpose

Apply the confirmed **Balatro-inspired retro aesthetic** (original design §6) to the
existing, fully-functional-but-unstyled web front-end. The table already plays a full
round through the real engine; this plan dresses it — felt, panels, cards, chips,
buttons, layout, and win feedback — without changing how it plays.

**Guiding principle: skin, don't rewire.** Every component keeps its current props,
callbacks, DOM roles, and ARIA labels. The 48 existing interaction tests assert
roles/labels/callbacks (not pixels), so a faithful restyle leaves them green. No
engine, adapter, or store *game logic* is touched. The only behavior-adjacent addition
is one small presentational component (the win pop-up) plus a UI-only piece of store
state to feed it.

## 2. Scope

**In scope (the visual skin):**
- Global theme tokens + swirl felt background + app grid layout + web-font import.
- Retro restyle of: Hud, Card, SqueezeCard, Hand, BetRail, Controls, Scoreboard.
- Shoe counter (`remaining/total`) in the scoreboard dock.
- One new presentational component: `WinPopup` (floating `+$95`-style payout pop-up).
- UI-only store state `lastDelta` (bankroll change across `settle()`) to drive the pop-up.

**Out of scope (deferred to Plan 4 — Immersion & Teaching):**
- Dealer narration line, contextual glossary hover, explain-the-rule readout,
  simulated other-player seats.

**Explicitly not done:**
- Real binary pixel-art card sprites / bitmap font files (CSS-drawn faces + Google
  web fonts instead; sprites can be swapped in later behind the same markup).
- A motion/animation runtime library (CSS transitions + `@keyframes` only).
- Responsive / mobile layout (desktop-first, like Balatro).

## 3. CSS architecture

- **`web/src/theme.css`** (new) — imported once in `main.tsx`. Contains:
  - **Design tokens** as CSS custom properties on `:root`:
    - Felt: `--felt-deep`, `--felt-light`
    - Chips/accents: `--gold`, `--chip-red`, `--chip-blue`
    - Panels: `--panel-face`, `--panel-bevel-hi`, `--panel-bevel-lo`
    - Structure: `--ink` (thick dark outline), `--shadow`
    - Type: `--font-display`, `--font-text`
  - **Web fonts** via Google Fonts `@import`: **Press Start 2P** (display: HUD numbers,
    bet spots, win pop-ups, title) and **VT323** (denser text). No binary assets.
  - **Global felt** background (layered radial green gradients + a slow-translating
    swirl via `@keyframes`) and the **app grid** layout.
- **Co-located component CSS** (matches the existing `cards.css` pattern — each
  component imports its own stylesheet):
  - New: `app.css`, `hud.css`, `betrail.css`, `controls.css`, `scoreboard.css`,
    `winpopup.css`.
  - Upgraded: `cards.css` (retro card faces).

Tokens are the single source of palette/type truth; component CSS references
`var(--…)` rather than hard-coded colors so the skin stays consistent and tunable.

## 4. Layout — CSS grid

`App.tsx` replaces its inline flexbox with a named CSS grid over the swirl-felt
background:

```
┌──────────┬───────────────────────────┬────────────┐
│          │   ░░ swirl felt stage ░░   │            │
│   HUD    │   ┌────┐         ┌────┐    │ SCOREBOARD │
│ sidebar  │   │PLYR│         │BNKR│    │   dock     │
│ (beveled │   └────┘         └────┘    │ bead·big·  │
│  panel)  │      ▸ controls ◂          │ eye·small· │
│ bankroll │                           │ cockroach  │
│ bet/min/ ├───────────────────────────┤            │
│ max/comm │   ▸▸ bet rail + chips ◂◂   │ shoe 41/52 │
└──────────┴───────────────────────────┴────────────┘
```

Grid columns: `hud | stage | board`. The `stage` column is itself a two-row grid:
card-stage (top) + bet-rail (bottom). The title may sit above the grid or fold into
the HUD panel. Responsive collapse is out of scope.

## 5. Component restyle pass (logic-frozen)

Each item is a CSS + markup-class change only; component props, callbacks, roles, and
ARIA labels are preserved so existing tests pass unchanged.

- **Hud** — beveled left panel; bankroll / current bet / table min-max / commission
  tally rendered as pixel-font readouts. Surfaces fields already present in the
  snapshot; no new data requirements.
- **Card / SqueezeCard / Hand** — chunky `--ink` outline, drop shadow, pixel-font
  rank, pip layout, patterned card back. The squeeze corner-bend keeps its existing
  `bend` transform and the `Peeked` suit-sliver clip.
- **BetRail** — main bet spots (Player / Tie / Banker) and side-bet spots styled as
  beveled "plastic" betting circles; the chip selector becomes stacked saturated chip
  graphics with the selected chip highlighted. Existing select/place/clear callbacks
  unchanged.
- **Controls** — beveled "plastic" buttons (Deal / Reveal all / Settle / New shoe),
  with disabled states styled.
- **Scoreboard** — right-dock grid cells for the roads (bead plate, big road, derived
  roads), plus a **shoe counter** showing `remaining/total` in the dock corner.

## 6. New component — `WinPopup`

A floating Balatro-style payout pop-up shown on settlement.

- **Contract:** `<WinPopup amount={cents: number | null} />`. Renders a float-up
  `+$95` (positive, gold) / `-$5` (negative, muted) callout; renders **nothing** when
  `amount` is `null` or `0`.
- **Replay:** mounted with a React `key` that changes each settle so the
  `@keyframes` float-up animation re-plays on every round.
- **Data source — `lastDelta`:** the store records the bankroll change across
  `settle()` as UI-only state. The store already holds the pre-settle snapshot and
  receives the post-settle one, so `lastDelta = post.bankroll − pre.bankroll`. This is
  arithmetic over existing data — **no game logic** — and is unit-testable. `lastDelta`
  resets to `null` on the next `deal()`/`clearBets()` so a stale pop-up doesn't linger.
- App passes `amount={lastDelta}` (with a settle-counter `key`) into `WinPopup`.

This is the only store touch in the plan and the only new behavior surface.

## 7. Testing strategy

- **Regression:** all 48 existing tests must stay green. The restyle preserves DOM
  roles and ARIA labels precisely because those tests depend on them — any markup
  change that would break a query is a signal the restyle went too far.
- **New TDD coverage (presentational):**
  - `WinPopup` — renders formatted positive/negative amounts; renders nothing for
    `null`/`0`; sign/color class correct.
  - Store `lastDelta` — computed correctly on `settle()` (positive win, negative loss,
    zero/push); reset to `null` on `deal()`/`clearBets()`.
  - Shoe counter — renders `remaining/total` from the snapshot.
- **CSS is not unit-tested.** Correctness lives in the unchanged behavior tests; the
  visual skin is verified by eye via `npm --workspace web run dev`. Typecheck
  (`tsc --noEmit`) must stay clean.

## 8. Risks / notes

- **Web-font load:** Google Fonts `@import` is a network dependency at runtime. If
  offline-first matters later, the fonts can be vendored; not a blocker for this plan.
- **Markup drift:** the chief risk is "improving" markup in a way that breaks an
  existing test query. Mitigation: restyle via classes/wrappers, keep roles/labels,
  run the full suite after each component.
- **Pop-up data:** if a future round model exposes an explicit settlement payout, the
  `WinPopup` can switch to it; the `lastDelta` arithmetic is an interim, sufficient
  source that needs no engine change.
