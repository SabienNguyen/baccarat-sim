# Web Plan 4 — Immersion & Teaching — Design Spec

**Date:** 2026-06-09
**Status:** Approved for planning (autonomous design per the build mandate)

## 1. Purpose

Teach the game *through play* and make the table feel alive, using data the engine
already exposes. Three features, all front-end:

1. **Dealer narration** — a spoken line that reacts to the action ("Monkey for the
   Player!", "Banker wins, seven over six"), updating live as cards are squeezed.
2. **Contextual glossary** — jargon in the narration is hover/focus-revealable with a
   short definition (Monkey, Natural, Pair, …), sourced from the engine glossary.
3. **Explain-the-rule mode** — a toggle that shows *why* the round played out: the
   engine's third-card tableau trace plus the house edge for the active main bets.

**Skin/behavior discipline:** like Plan 3, no engine change and no game logic in the
front-end. Narration and explain are pure functions of the existing `RoundSnapshot`
(`events`, `explain`, `outcome`); the glossary comes from the existing `getGlossary()`
adapter call. The only store touch is one UI-only toggle.

## 2. Scope

**In scope:**
- `narrate(snapshot)` pure function → ordered narration **segments** (plain text and
  glossary-linked terms) for the current phase/events.
- `DealerLine` component rendering those segments, with terms as `GlossaryTerm`s.
- `GlossaryTerm` component: an accessible term that reveals its definition on
  hover/focus, backed by a `glossaryData` lookup built from `getGlossary()`.
- `ExplainPanel` component: renders `snapshot.explain` lines + a small house-edge
  readout for the active main bets; shown only when explain mode is on.
- Store UI-only state `explainOn: boolean` + `toggleExplain()`, and an "Explain" toggle
  button in the UI.

**Out of scope (deferred):**
- **Simulated other players** (cosmetic seats/bets/reactions) — flavor, not teaching;
  its own later plan.
- Any engine/adapter change. Audio/text-to-speech (the dealer "voice" is text only).
- Forced tutorials/quizzes (the original design deliberately excludes these).

## 3. Dealer narration — `narrate(snapshot)`

A pure function in `web/src/narrate.ts`:

```ts
export type NarrationSegment = { text: string } | { text: string; term: string };
export function narrate(snapshot: RoundSnapshot): NarrationSegment[];
```

It chooses one dealer line by salience, newest/most-decisive first:

- **Betting:** "Place your bets." (no events)
- **Dealing, no events yet:** "Cards out — squeeze 'em."
- **Win present** (round fully revealed): the decisive line, e.g.
  - `PlayerWin` → "Player wins, {player} over {banker}." (term `player` on "Player")
  - `BankerWin` → "Banker wins, {banker} over {player}." (term `banker` on "Banker")
  - `Tie` → "Tie — bets push." (term `tie` on "Tie")
- Else the most recent salient event among the snapshot's `events`:
  - `Natural{side,total}` → "Natural {total} — {side}!" (term `natural`)
  - `Pair{side}` → "{side} pair!" (term `pair`)
  - `Monkey{hand}` → "Monkey for the {hand}!" (term `monkey`)
  - `ThirdCard{side}` → "Third card for the {side}." (no glossary entry — plain text)

The exact glossary slugs used (`player`, `banker`, `tie`, `natural`, `pair`, `monkey`)
are confirmed present in the engine `glossary()` output. There is no `third-card` slug,
so that line carries no term.

Glossary terms embedded in a line are emitted as `{ text, term }` segments so they can be
made interactive; everything else is `{ text }`. `narrate` performs **no** lookups
itself — it only tags which word is a term (by the term's glossary `term` key). If a
tagged key isn't in the glossary, the term renders as plain emphasized text (no tooltip),
so a missing entry degrades gracefully.

`DealerLine` (`web/src/components/DealerLine.tsx`) renders the segments inside an
`aria-live="polite"` region so screen readers announce updates; plain segments as text,
term segments as `<GlossaryTerm term=… label=…>`.

## 4. Contextual glossary — `GlossaryTerm` + `glossaryData`

- `web/src/glossaryData.ts` exposes `glossaryEntry(term: string): GlossaryEntry | undefined`
  backed by a `Map` built **once** (lazily memoized) from `getGlossary()`. Keeping the
  lookup here means components never import the wasm adapter directly and stay testable
  by injecting/mocking the map.
- `GlossaryTerm` (`web/src/components/GlossaryTerm.tsx`): renders the term's display text
  with a dotted underline. On hover **and** keyboard focus it shows a small popover with
  the entry's `short` text (and `label` as a heading). It's a real focusable control
  (`<button type="button">` styled inline, or a `tabIndex=0` span with `aria-describedby`
  wiring the popover) so it's keyboard-accessible. If no entry exists for the term, it
  renders the label as plain emphasized text with no popover.
- Tooltip styling is retro (small beveled callout, reusing theme tokens).

The component takes the resolved entry (or `undefined`) as a prop rather than importing
`glossaryData` directly, so tests pass fixtures without the wasm glossary. `DealerLine`
does the lookup via `glossaryData` and passes the entry down.

## 5. Explain-the-rule mode — `ExplainPanel` + store toggle

- Store gains UI-only `explainOn: boolean` (default `false`) and `toggleExplain()`. No
  game logic; mirrors the `selectedChip`/`lastDelta` pattern.
- An **Explain** toggle button (in `Controls` or the HUD) flips it; `aria-pressed`
  reflects state.
- `ExplainPanel` (`web/src/components/ExplainPanel.tsx`), rendered only when `explainOn`:
  - **Why this round:** the `snapshot.explain` strings as a list (the engine's tableau
    trace, e.g. "Player drew on 4", "Banker stood on 7"). If empty (e.g. Betting), shows
    a neutral hint ("Place a bet and deal to see the rules in action.").
  - **House edge** for the active main bets only (derived from `snapshot.bets`): a small
    static, cited reference map `HOUSE_EDGE` in `web/src/houseEdge.ts` —
    Player 1.24%, Banker 1.06%, Tie 14.36% (8:1). Only edges for bets actually placed
    are shown, each labelled. Side-bet edges are out of scope here (noted as "varies").

## 6. Layout

- **DealerLine:** below the card stage, above the bet rail (the original design's
  "below stage: dealer narration line"). Full-width within the center column, styled as a
  retro callout.
- **Explain toggle:** a button in the control row.
- **ExplainPanel:** in the right dock beneath the `Scoreboard` (collapses with the
  toggle).

No grid restructure beyond adding the dealer line row to the center `stage` column and
the explain panel under the board column.

## 7. Testing

- `narrate()` — pure unit tests over crafted snapshots: betting line; dealing-no-events
  line; each event type → expected segments (text + term keys); win lines for
  Player/Banker/Tie with correct totals/ordering; win takes precedence over earlier
  events.
- `glossaryData` — builds a lookup; `glossaryEntry` returns the right entry and
  `undefined` for unknown keys (tested against a small injected fixture, not wasm).
- `GlossaryTerm` — renders label; reveals `short`/`label` on focus and hover; renders
  plain text with no popover when entry is `undefined`; accessible (focusable, the
  popover is associated via `aria-describedby` or `role="tooltip"`).
- `DealerLine` — renders narration segments; term segments become interactive terms;
  uses an `aria-live` region.
- `ExplainPanel` — renders `explain` lines; shows the neutral hint when empty; shows
  house-edge rows only for placed main bets; renders nothing-but-toggle when off.
- Store — `explainOn` defaults false; `toggleExplain()` flips it.
- All existing tests stay green; the dealer line and explain toggle must not break
  existing queries (additive markup, new labels).

## 8. Risks / notes

- **Event salience:** `narrate` must pick a sensible single line when several events
  coexist (e.g. Monkey + Natural). Rule: a `Win` always wins; otherwise prefer
  Natural > Pair > ThirdCard > Monkey, newest hand first. Encoded explicitly and tested.
- **Glossary term keys:** `narrate` references glossary `term` slugs (`player`, `banker`,
  `tie`, `natural`, `pair`, `monkey`) — all confirmed present in `glossary()`. Unknown
  keys fall back to plain emphasized text, so the feature degrades gracefully.
- **House edge accuracy:** only the three well-established main-bet figures are shown,
  each labelled with the rule basis; side bets are explicitly "varies" to avoid quoting
  shaky numbers.
