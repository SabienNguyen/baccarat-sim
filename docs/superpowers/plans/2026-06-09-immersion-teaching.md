# Immersion & Teaching Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a reactive dealer narration line, contextual glossary hovers, and an explain-the-rule mode — all driven by data the engine already exposes.

**Architecture:** Pure functions turn the existing `RoundSnapshot` (`events`, `explain`, `outcome`, `bets`) into narration segments and house-edge rows; presentational components render them. The glossary comes from the existing `getGlossary()` adapter call via a small memoized lookup. One UI-only store toggle (`explainOn`) gates the explain panel. No engine/adapter change, no game logic in the front-end.

**Tech Stack:** React 18 + TypeScript, Vite, Vitest + Testing Library, Zustand vanilla store, plain CSS with theme tokens.

**Spec:** `docs/superpowers/specs/2026-06-09-immersion-teaching-design.md`

---

## Conventions for every task

- Run web tests: `npm --workspace web run test -- --run` (optionally append a filename filter).
- Typecheck: `npx --workspace web tsc --noEmit` (expect no output).
- Engine `Event` serializes externally-tagged, so its TypeScript shape is:
  `{ Natural: { side: Side; total: number } } | { Monkey: { hand: Side; index: number } } | { Pair: { side: Side } } | { ThirdCard: { side: Side; reason: string } } | { Win: { result: Outcome; player: number; banker: number } }`.
  `Outcome` is `"PlayerWin" | "BankerWin" | "Tie"`. `Event` and `Outcome` are already re-exported from `web/src/engine/types.ts`.
- All existing tests must stay green; new components add markup with new labels and must not break existing queries.

---

## Task 1: `narrate(snapshot)` — narration segments

**Files:**
- Create: `web/src/narrate.ts`
- Test: `web/src/narrate.test.ts`

- [ ] **Step 1: Write the failing tests** — create `web/src/narrate.test.ts`:

```ts
import { narrate } from "./narrate";
import type { RoundSnapshot, Event } from "./engine/types";

function snap(phase: RoundSnapshot["phase"], events: Event[] = []): RoundSnapshot {
  return {
    phase,
    player: { cards: [], total: null },
    banker: { cards: [], total: null },
    bets: [],
    bankroll: 0,
    table_min: 0,
    table_max: 0,
    outcome: null,
    payouts: null,
    events,
    scoreboard: {
      bead_plate: { cells: [] },
      big_road: { columns: [] },
      big_eye_boy: { columns: [] },
      small_road: { columns: [] },
      cockroach_pig: { columns: [] },
    },
    explain: [],
  };
}

test("betting phase invites bets", () => {
  expect(narrate(snap("Betting"))).toEqual([{ text: "Place your bets." }]);
});

test("dealing with no events yet prompts the squeeze", () => {
  expect(narrate(snap("Dealing"))).toEqual([{ text: "Cards out — squeeze 'em." }]);
});

test("a monkey is called out with a glossary term", () => {
  const segs = narrate(snap("Dealing", [{ Monkey: { hand: "Player", index: 0 } }]));
  expect(segs).toEqual([
    { text: "Monkey", term: "monkey" },
    { text: " for the Player!" },
  ]);
});

test("a natural is announced with its total", () => {
  const segs = narrate(snap("Dealing", [{ Natural: { side: "Banker", total: 9 } }]));
  expect(segs).toEqual([
    { text: "Natural", term: "natural" },
    { text: " 9 — Banker!" },
  ]);
});

test("a pair tags the pair term", () => {
  const segs = narrate(snap("Dealing", [{ Pair: { side: "Player" } }]));
  expect(segs).toEqual([
    { text: "Player " },
    { text: "pair", term: "pair" },
    { text: "!" },
  ]);
});

test("the win line is decisive and beats earlier events", () => {
  const segs = narrate(
    snap("Settled", [
      { Monkey: { hand: "Player", index: 0 } },
      { Win: { result: "BankerWin", player: 5, banker: 7 } },
    ]),
  );
  expect(segs).toEqual([
    { text: "Banker", term: "banker" },
    { text: " wins, 7 over 5." },
  ]);
});

test("a tie pushes", () => {
  const segs = narrate(snap("Settled", [{ Win: { result: "Tie", player: 6, banker: 6 } }]));
  expect(segs).toEqual([{ text: "Tie", term: "tie" }, { text: " — bets push." }]);
});

test("natural outranks a co-occurring monkey", () => {
  const segs = narrate(
    snap("Dealing", [
      { Monkey: { hand: "Player", index: 0 } },
      { Natural: { side: "Player", total: 8 } },
    ]),
  );
  expect(segs[0]).toEqual({ text: "Natural", term: "natural" });
});
```

- [ ] **Step 2: Run, verify FAIL** — `npm --workspace web run test -- --run narrate` → module not found.

- [ ] **Step 3: Implement** — create `web/src/narrate.ts`:

```ts
import type { RoundSnapshot, Event, Outcome } from "./engine/types";

/** A piece of the dealer line; `term` marks a glossary slug for interactivity. */
export type NarrationSegment = { text: string; term?: string };

const SALIENCE: Record<string, number> = { Natural: 4, Pair: 3, ThirdCard: 2, Monkey: 1 };

function winLine(win: { result: Outcome; player: number; banker: number }): NarrationSegment[] {
  if (win.result === "PlayerWin") {
    return [{ text: "Player", term: "player" }, { text: ` wins, ${win.player} over ${win.banker}.` }];
  }
  if (win.result === "BankerWin") {
    return [{ text: "Banker", term: "banker" }, { text: ` wins, ${win.banker} over ${win.player}.` }];
  }
  return [{ text: "Tie", term: "tie" }, { text: " — bets push." }];
}

function eventLine(e: Event): NarrationSegment[] {
  if ("Natural" in e) {
    return [{ text: "Natural", term: "natural" }, { text: ` ${e.Natural.total} — ${e.Natural.side}!` }];
  }
  if ("Pair" in e) {
    return [{ text: `${e.Pair.side} ` }, { text: "pair", term: "pair" }, { text: "!" }];
  }
  if ("Monkey" in e) {
    return [{ text: "Monkey", term: "monkey" }, { text: ` for the ${e.Monkey.hand}!` }];
  }
  // ThirdCard — no glossary slug exists for it.
  return [{ text: `Third card for the ${e.ThirdCard.side}.` }];
}

/** Most salient non-win event; ties resolve to the newest (later in the list). */
function pickSalient(events: Event[]): Event | undefined {
  let best: Event | undefined;
  let bestRank = 0;
  for (const e of events) {
    const key = Object.keys(e)[0];
    if (key === "Win") continue;
    const rank = SALIENCE[key] ?? 0;
    if (rank >= bestRank) {
      bestRank = rank;
      best = e;
    }
  }
  return best;
}

/** Turn the current snapshot into an ordered dealer line. Pure. */
export function narrate(snapshot: RoundSnapshot): NarrationSegment[] {
  if (snapshot.phase === "Betting") return [{ text: "Place your bets." }];

  const win = snapshot.events.find((e): e is Extract<Event, { Win: unknown }> => "Win" in e);
  if (win) return winLine(win.Win);

  const salient = pickSalient(snapshot.events);
  if (!salient) return [{ text: "Cards out — squeeze 'em." }];
  return eventLine(salient);
}
```

- [ ] **Step 4: Run, verify PASS** — `npm --workspace web run test -- --run narrate`.

- [ ] **Step 5: Commit**

```bash
git add web/src/narrate.ts web/src/narrate.test.ts
git commit -m "feat(web): narrate() turns snapshot events into a dealer line"
```

---

## Task 2: `glossaryData` — memoized term lookup

**Files:**
- Create: `web/src/glossaryData.ts`
- Test: `web/src/glossaryData.test.ts`

- [ ] **Step 1: Write the failing tests** — create `web/src/glossaryData.test.ts`:

```ts
import { buildGlossaryMap } from "./glossaryData";
import type { GlossaryEntry } from "./engine/types";

const entries: GlossaryEntry[] = [
  { term: "monkey", label: "Monkey", short: "A 10 or face card (value 0).", long: "..." },
  { term: "natural", label: "Natural", short: "An 8 or 9 on the first two cards.", long: "..." },
];

test("builds a lookup keyed by term slug", () => {
  const map = buildGlossaryMap(entries);
  expect(map.get("monkey")?.label).toBe("Monkey");
  expect(map.get("natural")?.short).toContain("8 or 9");
});

test("unknown slugs resolve to undefined", () => {
  const map = buildGlossaryMap(entries);
  expect(map.get("nope")).toBeUndefined();
});
```

- [ ] **Step 2: Run, verify FAIL** — `npm --workspace web run test -- --run glossaryData`.

- [ ] **Step 3: Implement** — create `web/src/glossaryData.ts`:

```ts
import type { GlossaryEntry } from "./engine/types";
import { getGlossary } from "./engine/adapter";

/** Pure: index glossary entries by their term slug. */
export function buildGlossaryMap(entries: GlossaryEntry[]): Map<string, GlossaryEntry> {
  return new Map(entries.map((e) => [e.term, e]));
}

let cache: Map<string, GlossaryEntry> | null = null;

/** Look up a glossary entry by slug, loading the glossary from wasm once. */
export function glossaryEntry(term: string): GlossaryEntry | undefined {
  if (!cache) cache = buildGlossaryMap(getGlossary());
  return cache.get(term);
}
```

- [ ] **Step 4: Run, verify PASS** — `npm --workspace web run test -- --run glossaryData` (tests only touch `buildGlossaryMap`, no wasm).

- [ ] **Step 5: Commit**

```bash
git add web/src/glossaryData.ts web/src/glossaryData.test.ts
git commit -m "feat(web): memoized glossary term lookup"
```

---

## Task 3: `GlossaryTerm` component

**Files:**
- Create: `web/src/components/GlossaryTerm.tsx`
- Create: `web/src/components/glossary.css`
- Test: `web/src/components/GlossaryTerm.test.tsx`

- [ ] **Step 1: Write the failing test** — create `web/src/components/GlossaryTerm.test.tsx`:

```tsx
import { render, screen, fireEvent } from "@testing-library/react";
import { GlossaryTerm } from "./GlossaryTerm";
import type { GlossaryEntry } from "../engine/types";

const entry: GlossaryEntry = {
  term: "monkey",
  label: "Monkey",
  short: "A 10 or face card, worth zero.",
  long: "...",
};

test("renders the label and reveals the definition on focus", () => {
  render(<GlossaryTerm term="monkey" label="Monkey" entry={entry} />);
  expect(screen.queryByRole("tooltip")).toBeNull();
  fireEvent.focus(screen.getByRole("button", { name: "Monkey" }));
  expect(screen.getByRole("tooltip")).toHaveTextContent("A 10 or face card, worth zero.");
});

test("hides the definition again on blur", () => {
  render(<GlossaryTerm term="monkey" label="Monkey" entry={entry} />);
  const btn = screen.getByRole("button", { name: "Monkey" });
  fireEvent.focus(btn);
  fireEvent.blur(btn);
  expect(screen.queryByRole("tooltip")).toBeNull();
});

test("with no entry it is plain text and not interactive", () => {
  render(<GlossaryTerm term="whatever" label="Whatever" entry={undefined} />);
  expect(screen.queryByRole("button")).toBeNull();
  expect(screen.getByText("Whatever")).toBeInTheDocument();
});
```

- [ ] **Step 2: Run, verify FAIL** — `npm --workspace web run test -- --run GlossaryTerm`.

- [ ] **Step 3: Implement** — create `web/src/components/GlossaryTerm.tsx`:

```tsx
import { useState } from "react";
import type { GlossaryEntry } from "../engine/types";
import "./glossary.css";

interface GlossaryTermProps {
  term: string;
  label: string;
  entry: GlossaryEntry | undefined;
}

export function GlossaryTerm({ term, label, entry }: GlossaryTermProps) {
  const [open, setOpen] = useState(false);
  if (!entry) return <em className="term-plain">{label}</em>;
  const id = `gloss-${term}`;
  return (
    <span className="glossary-term">
      <button
        type="button"
        className="term"
        aria-describedby={open ? id : undefined}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
      >
        {label}
      </button>
      {open && (
        <span role="tooltip" id={id} className="term-popover">
          <strong>{entry.label}</strong> {entry.short}
        </span>
      )}
    </span>
  );
}
```

Create `web/src/components/glossary.css`:

```css
.glossary-term {
  position: relative;
  display: inline-block;
}
.term {
  font: inherit;
  color: var(--gold);
  background: none;
  border: none;
  padding: 0;
  cursor: help;
  text-decoration: underline dotted;
}
.term-plain {
  font-style: italic;
}
.term-popover {
  position: absolute;
  left: 0;
  bottom: 125%;
  z-index: 60;
  width: max-content;
  max-width: 220px;
  font-family: var(--font-text);
  font-size: 16px;
  line-height: 1.2;
  color: #f3eede;
  background: var(--panel-face);
  border: 3px solid var(--ink);
  border-radius: 6px;
  box-shadow: 3px 3px 0 var(--shadow);
  padding: 8px 10px;
}
.term-popover strong {
  color: var(--gold);
  font-family: var(--font-display);
  font-size: 9px;
  display: block;
  margin-bottom: 4px;
}
```

- [ ] **Step 4: Run, verify PASS** — `npm --workspace web run test -- --run GlossaryTerm`.

- [ ] **Step 5: Commit**

```bash
git add web/src/components/GlossaryTerm.tsx web/src/components/glossary.css web/src/components/GlossaryTerm.test.tsx
git commit -m "feat(web): GlossaryTerm with hover/focus definition popover"
```

---

## Task 4: `DealerLine` component

**Files:**
- Create: `web/src/components/DealerLine.tsx`
- Create: `web/src/components/dealer.css`
- Test: `web/src/components/DealerLine.test.tsx`

- [ ] **Step 1: Write the failing test** — create `web/src/components/DealerLine.test.tsx`:

```tsx
import { render, screen, fireEvent } from "@testing-library/react";
import { DealerLine } from "./DealerLine";
import type { RoundSnapshot, GlossaryEntry } from "../engine/types";

function snap(over: Partial<RoundSnapshot> = {}): RoundSnapshot {
  return {
    phase: "Dealing",
    player: { cards: [], total: null },
    banker: { cards: [], total: null },
    bets: [],
    bankroll: 0,
    table_min: 0,
    table_max: 0,
    outcome: null,
    payouts: null,
    events: [{ Monkey: { hand: "Player", index: 0 } }],
    scoreboard: {
      bead_plate: { cells: [] },
      big_road: { columns: [] },
      big_eye_boy: { columns: [] },
      small_road: { columns: [] },
      cockroach_pig: { columns: [] },
    },
    explain: [],
    ...over,
  };
}

const lookup = (term: string): GlossaryEntry | undefined =>
  term === "monkey"
    ? { term: "monkey", label: "Monkey", short: "A zero-value card.", long: "..." }
    : undefined;

test("renders the dealer line in a live region with an interactive term", () => {
  render(<DealerLine snapshot={snap()} lookup={lookup} />);
  const region = screen.getByLabelText("Dealer");
  expect(region).toBeInTheDocument();
  expect(screen.getByText(/for the Player!/)).toBeInTheDocument();
  fireEvent.focus(screen.getByRole("button", { name: "Monkey" }));
  expect(screen.getByRole("tooltip")).toHaveTextContent("A zero-value card.");
});

test("plain (non-term) phases render without a button", () => {
  render(<DealerLine snapshot={snap({ phase: "Betting", events: [] })} lookup={lookup} />);
  expect(screen.getByText("Place your bets.")).toBeInTheDocument();
  expect(screen.queryByRole("button")).toBeNull();
});
```

- [ ] **Step 2: Run, verify FAIL** — `npm --workspace web run test -- --run DealerLine`.

- [ ] **Step 3: Implement** — create `web/src/components/DealerLine.tsx`:

```tsx
import type { RoundSnapshot, GlossaryEntry } from "../engine/types";
import { narrate } from "../narrate";
import { glossaryEntry } from "../glossaryData";
import { GlossaryTerm } from "./GlossaryTerm";
import "./dealer.css";

interface DealerLineProps {
  snapshot: RoundSnapshot;
  /** Term→entry lookup; defaults to the real (wasm-backed) glossary. Injectable for tests. */
  lookup?: (term: string) => GlossaryEntry | undefined;
}

export function DealerLine({ snapshot, lookup = glossaryEntry }: DealerLineProps) {
  const segments = narrate(snapshot);
  return (
    <section aria-label="Dealer" className="dealer-line">
      <p aria-live="polite">
        {segments.map((seg, i) =>
          seg.term ? (
            <GlossaryTerm key={i} term={seg.term} label={seg.text} entry={lookup(seg.term)} />
          ) : (
            <span key={i}>{seg.text}</span>
          ),
        )}
      </p>
    </section>
  );
}
```

Create `web/src/components/dealer.css`:

```css
.dealer-line {
  width: 100%;
  max-width: 720px;
  text-align: center;
}
.dealer-line p {
  margin: 0;
  font-family: var(--font-text);
  font-size: 24px;
  color: #f3eede;
  background: var(--panel-bevel-lo);
  border: 3px solid var(--ink);
  border-radius: 8px;
  box-shadow: inset 2px 2px 0 rgba(255, 255, 255, 0.06), 3px 3px 0 var(--shadow);
  padding: 10px 16px;
}
```

- [ ] **Step 4: Run, verify PASS** — `npm --workspace web run test -- --run DealerLine`.

- [ ] **Step 5: Commit**

```bash
git add web/src/components/DealerLine.tsx web/src/components/dealer.css web/src/components/DealerLine.test.tsx
git commit -m "feat(web): DealerLine renders narration with glossary terms"
```

---

## Task 5: Mount `DealerLine` in App

**Files:**
- Modify: `web/src/App.tsx`
- Test: `web/src/App.test.tsx`

- [ ] **Step 1: Add the import and render the line** — in `web/src/App.tsx` add `import { DealerLine } from "./components/DealerLine";` with the other component imports, and insert the dealer line into the `stage` column, directly after the closing `</div>` of `card-stage` and before `<Controls …>`:

```tsx
        <DealerLine snapshot={snapshot} />
```

(No other App changes in this task.)

- [ ] **Step 2: Add an App test** — append to `web/src/App.test.tsx`:

```tsx
test("renders the dealer line for the current phase", () => {
  const store = createGameStore(fakeSession(bettingSnapshot()));
  render(<App store={store} />);
  const dealer = screen.getByLabelText("Dealer");
  expect(dealer).toHaveTextContent("Place your bets.");
});
```

(`bettingSnapshot`, `fakeSession`, `createGameStore`, `render`, `screen` are already imported in `App.test.tsx`.) The real `glossaryEntry` default is used here, but the betting line has no term segments, so no wasm glossary lookup occurs.

- [ ] **Step 3: Run suite + typecheck** — `npm --workspace web run test -- --run` (all green) and `npx --workspace web tsc --noEmit` (clean).

- [ ] **Step 4: Commit**

```bash
git add web/src/App.tsx web/src/App.test.tsx
git commit -m "feat(web): mount the dealer narration line"
```

---

## Task 6: Store — `explainOn` toggle

**Files:**
- Modify: `web/src/store/gameStore.ts`
- Test: `web/src/store/gameStore.test.ts`

- [ ] **Step 1: Write the failing tests** — append to `web/src/store/gameStore.test.ts`:

```ts
test("explain mode is off by default and toggles", () => {
  const store = createGameStore(fakeSession({ ok: true, snapshot: snapshotWith() }));
  expect(store.getState().explainOn).toBe(false);
  store.getState().toggleExplain();
  expect(store.getState().explainOn).toBe(true);
  store.getState().toggleExplain();
  expect(store.getState().explainOn).toBe(false);
});
```

- [ ] **Step 2: Run, verify FAIL** — `npm --workspace web run test -- --run gameStore`.

- [ ] **Step 3: Implement** — in `web/src/store/gameStore.ts` add to the `GameState` interface (after `settleSeq: number;`):

```ts
  /** Whether explain-the-rule mode is showing. UI-only. */
  explainOn: boolean;
  toggleExplain: () => void;
```

And in the returned store object, add the initial value and action (e.g. right after `settleSeq: 0,`):

```ts
      explainOn: false,
      toggleExplain: () => set({ explainOn: !get().explainOn }),
```

- [ ] **Step 4: Run, verify PASS** — `npm --workspace web run test -- --run gameStore`.

- [ ] **Step 5: Commit**

```bash
git add web/src/store/gameStore.ts web/src/store/gameStore.test.ts
git commit -m "feat(web): explainOn UI toggle in the store"
```

---

## Task 7: `houseEdge` reference

**Files:**
- Create: `web/src/houseEdge.ts`
- Test: `web/src/houseEdge.test.ts`

- [ ] **Step 1: Write the failing tests** — create `web/src/houseEdge.test.ts`:

```ts
import { mainBetEdge } from "./houseEdge";

test("returns the cited edge for each main bet", () => {
  expect(mainBetEdge({ Main: "Player" })).toEqual({
    label: "Player",
    edge: "1.24%",
    basis: "pays 1:1",
  });
  expect(mainBetEdge({ Main: "Banker" })?.edge).toBe("1.06%");
  expect(mainBetEdge({ Main: "Tie" })?.edge).toBe("14.36%");
});

test("side bets have no main-bet edge entry", () => {
  expect(mainBetEdge({ Side: "PlayerPair" })).toBeUndefined();
});
```

- [ ] **Step 2: Run, verify FAIL** — `npm --workspace web run test -- --run houseEdge`.

- [ ] **Step 3: Implement** — create `web/src/houseEdge.ts`:

```ts
import type { BetKind } from "./engine/types";

export interface EdgeInfo {
  label: string;
  edge: string;
  basis: string;
}

/** House edge for the three main bets (standard commission baccarat, 8-deck). */
export function mainBetEdge(kind: BetKind): EdgeInfo | undefined {
  if (!("Main" in kind)) return undefined;
  switch (kind.Main) {
    case "Player":
      return { label: "Player", edge: "1.24%", basis: "pays 1:1" };
    case "Banker":
      return { label: "Banker", edge: "1.06%", basis: "pays 0.95:1 (5% commission)" };
    case "Tie":
      return { label: "Tie", edge: "14.36%", basis: "pays 8:1" };
  }
}
```

- [ ] **Step 4: Run, verify PASS** — `npm --workspace web run test -- --run houseEdge`.

- [ ] **Step 5: Commit**

```bash
git add web/src/houseEdge.ts web/src/houseEdge.test.ts
git commit -m "feat(web): main-bet house-edge reference data"
```

---

## Task 8: `ExplainPanel` component

**Files:**
- Create: `web/src/components/ExplainPanel.tsx`
- Create: `web/src/components/explain.css`
- Test: `web/src/components/ExplainPanel.test.tsx`

- [ ] **Step 1: Write the failing test** — create `web/src/components/ExplainPanel.test.tsx`:

```tsx
import { render, screen, within } from "@testing-library/react";
import { ExplainPanel } from "./ExplainPanel";
import type { RoundSnapshot } from "../engine/types";

function snap(over: Partial<RoundSnapshot> = {}): RoundSnapshot {
  return {
    phase: "Settled",
    player: { cards: [], total: null },
    banker: { cards: [], total: null },
    bets: [],
    bankroll: 0,
    table_min: 0,
    table_max: 0,
    outcome: null,
    payouts: null,
    events: [],
    scoreboard: {
      bead_plate: { cells: [] },
      big_road: { columns: [] },
      big_eye_boy: { columns: [] },
      small_road: { columns: [] },
      cockroach_pig: { columns: [] },
    },
    explain: [],
    ...over,
  };
}

test("lists the engine's explain trace", () => {
  render(<ExplainPanel snapshot={snap({ explain: ["Player drew on 4", "Banker stood on 7"] })} />);
  const panel = screen.getByLabelText("Explain");
  expect(within(panel).getByText("Player drew on 4")).toBeInTheDocument();
  expect(within(panel).getByText("Banker stood on 7")).toBeInTheDocument();
});

test("shows a neutral hint when there is no trace", () => {
  render(<ExplainPanel snapshot={snap({ explain: [] })} />);
  expect(screen.getByText(/see the rules in action/i)).toBeInTheDocument();
});

test("shows house edge only for placed main bets, de-duplicated", () => {
  render(
    <ExplainPanel
      snapshot={snap({
        bets: [
          { kind: { Main: "Banker" }, amount: 500 },
          { kind: { Main: "Banker" }, amount: 200 },
          { kind: { Side: "PlayerPair" }, amount: 100 },
        ],
      })}
    />,
  );
  expect(screen.getByText(/Banker/)).toBeInTheDocument();
  expect(screen.getByText(/1\.06%/)).toBeInTheDocument();
  // only one Banker edge row despite two Banker bets
  expect(screen.getAllByText(/1\.06%/)).toHaveLength(1);
});
```

- [ ] **Step 2: Run, verify FAIL** — `npm --workspace web run test -- --run ExplainPanel`.

- [ ] **Step 3: Implement** — create `web/src/components/ExplainPanel.tsx`:

```tsx
import type { RoundSnapshot } from "../engine/types";
import { mainBetEdge, type EdgeInfo } from "../houseEdge";
import "./explain.css";

function uniqueEdges(snapshot: RoundSnapshot): EdgeInfo[] {
  const byLabel = new Map<string, EdgeInfo>();
  for (const bet of snapshot.bets) {
    const edge = mainBetEdge(bet.kind);
    if (edge && !byLabel.has(edge.label)) byLabel.set(edge.label, edge);
  }
  return [...byLabel.values()];
}

export function ExplainPanel({ snapshot }: { snapshot: RoundSnapshot }) {
  const edges = uniqueEdges(snapshot);
  return (
    <section aria-label="Explain" className="explain-panel panel">
      <h4>Why this round</h4>
      {snapshot.explain.length > 0 ? (
        <ul className="explain-trace">
          {snapshot.explain.map((line, i) => (
            <li key={i}>{line}</li>
          ))}
        </ul>
      ) : (
        <p className="explain-hint">Place a bet and deal to see the rules in action.</p>
      )}

      {edges.length > 0 && (
        <>
          <h4>House edge</h4>
          <ul className="explain-edges">
            {edges.map((e) => (
              <li key={e.label}>
                {e.label}: {e.edge} <span className="basis">({e.basis})</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
```

Create `web/src/components/explain.css`:

```css
.explain-panel {
  align-self: start;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.explain-panel h4 {
  font-family: var(--font-display);
  font-size: 9px;
  color: var(--gold);
  margin: 6px 0 2px;
  letter-spacing: 1px;
}
.explain-trace,
.explain-edges {
  list-style: none;
  margin: 0;
  padding: 0;
  font-size: 18px;
}
.explain-trace li {
  padding: 2px 0;
  border-bottom: 1px solid var(--panel-bevel-lo);
}
.explain-edges .basis {
  color: #b9aee0;
  font-size: 15px;
}
.explain-hint {
  margin: 0;
  font-size: 16px;
  color: #b9aee0;
}
```

- [ ] **Step 4: Run, verify PASS** — `npm --workspace web run test -- --run ExplainPanel`.

- [ ] **Step 5: Commit**

```bash
git add web/src/components/ExplainPanel.tsx web/src/components/explain.css web/src/components/ExplainPanel.test.tsx
git commit -m "feat(web): ExplainPanel shows the tableau trace and house edge"
```

---

## Task 9: Explain toggle in Controls + mount panel in App

**Files:**
- Modify: `web/src/components/Controls.tsx`
- Modify: `web/src/App.tsx`
- Test: `web/src/components/Controls.test.tsx`, `web/src/App.test.tsx`

- [ ] **Step 1: Add an optional toggle to Controls** — in `web/src/components/Controls.tsx` extend the props and render a toggle button. Add to `ControlsProps`:

```ts
  explainOn?: boolean;
  onToggleExplain?: () => void;
```

Update the destructure to include `explainOn` and `onToggleExplain`, and add this button as the last child of the `<section>` (after "New Shoe"):

```tsx
      <button
        type="button"
        className="btn"
        aria-pressed={!!explainOn}
        onClick={onToggleExplain}
      >
        Explain
      </button>
```

The new props are optional so existing `Controls.test.tsx` renders (which omit them) still compile and pass.

- [ ] **Step 2: Add a Controls toggle test** — append to `web/src/components/Controls.test.tsx` (reuse whatever snapshot helper the file already defines; if it builds an inline snapshot, mirror that):

```tsx
test("the Explain button reflects and toggles explain mode", async () => {
  const onToggleExplain = vi.fn();
  render(
    <Controls
      snapshot={bettingSnapshot()}
      onDeal={() => {}}
      onRevealAll={() => {}}
      onSettle={() => {}}
      onNewShoe={() => {}}
      explainOn={true}
      onToggleExplain={onToggleExplain}
    />,
  );
  const btn = screen.getByRole("button", { name: "Explain" });
  expect(btn).toHaveAttribute("aria-pressed", "true");
  await userEvent.click(btn);
  expect(onToggleExplain).toHaveBeenCalledOnce();
});
```

First READ `web/src/components/Controls.test.tsx` to see how it imports a snapshot (it uses the shared fixtures or an inline builder) and `userEvent`; reuse the same import. If it has no `bettingSnapshot` import, add `import { bettingSnapshot } from "../test/fixtures";` and `import userEvent from "@testing-library/user-event";` if missing.

- [ ] **Step 3: Wire App** — in `web/src/App.tsx`:
  - Add `import { ExplainPanel } from "./components/ExplainPanel";`.
  - Read the new store fields: `const explainOn = useStore(active, (s) => s.explainOn);` and `const toggleExplain = useStore(active, (s) => s.toggleExplain);`.
  - Pass `explainOn={explainOn}` and `onToggleExplain={toggleExplain}` to `<Controls … />`.
  - Render the panel under the scoreboard: replace `<Scoreboard scoreboard={snapshot.scoreboard} />` with:

```tsx
      <div className="board-dock">
        <Scoreboard scoreboard={snapshot.scoreboard} />
        {explainOn && <ExplainPanel snapshot={snapshot} />}
      </div>
```

  Add to `web/src/components/scoreboard.css` (or a small rule in `theme.css`) a stacking rule so the dock column stacks the two panels — append to `theme.css`:

```css
.app > .board-dock {
  grid-area: board;
  display: flex;
  flex-direction: column;
  gap: 16px;
}
```

  Note: the dock now occupies the `board` grid area via `.board-dock` (the `Scoreboard`'s own `.board` class still styles the scoreboard panel itself; it no longer needs to be the grid-area owner, but leaving its `align-self` is harmless).

- [ ] **Step 4: Add an App test for the panel toggle** — append to `web/src/App.test.tsx`:

```tsx
test("explain panel appears only when explain mode is on", async () => {
  const store = createGameStore(fakeSession(bettingSnapshot()));
  render(<App store={store} />);
  expect(screen.queryByLabelText("Explain")).toBeNull();
  await userEvent.click(screen.getByRole("button", { name: "Explain" }));
  expect(screen.getByLabelText("Explain")).toBeInTheDocument();
});
```

(`userEvent` is already imported in `App.test.tsx`.)

- [ ] **Step 5: Run suite + typecheck** — `npm --workspace web run test -- --run` (all green) and `npx --workspace web tsc --noEmit` (clean).

- [ ] **Step 6: Commit**

```bash
git add web/src/components/Controls.tsx web/src/components/Controls.test.tsx web/src/App.tsx web/src/App.test.tsx web/src/theme.css
git commit -m "feat(web): explain toggle and panel in the board dock"
```

---

## Task 10: Final verification

- [ ] **Step 1: Full suite + build**

Run: `npm --workspace web run test -- --run` → all green (≈89 tests, zero failures).
Run: `npm --workspace web run build` → tsc clean, Vite build succeeds.

- [ ] **Step 2: Eyeball** — `npm --workspace web run dev`: place a bet → deal → squeeze. Confirm the dealer line reacts ("Monkey…", "Natural…", win line), hovering a highlighted term shows its definition, and toggling **Explain** shows the tableau trace + house edge for your placed bets. Stop the server.

- [ ] **Step 3: Confirm clean tree** — `git status` clean.

---

## Self-review notes (for the executor)

- **No engine/adapter changes** — only `web/src/**`. `narrate`, `glossaryData` (`buildGlossaryMap`), and `houseEdge` are pure and tested without wasm; `DealerLine` takes an injectable `lookup` so its tests avoid wasm too.
- **Preserve test hooks** — additive markup/labels only; the Controls `Explain` button and the new `Dealer`/`Explain` regions add labels, they don't rename or restructure existing ones.
- **Event shape** — remember `Event` is externally tagged (`"Monkey" in e`, `e.Monkey.hand`, etc.). `Outcome` strings are `PlayerWin`/`BankerWin`/`Tie`.
- **Glossary slugs** — `narrate` only emits the slugs `player`, `banker`, `tie`, `natural`, `pair`, `monkey`, all present in `glossary()`. A missing slug degrades to plain text via `GlossaryTerm`.
