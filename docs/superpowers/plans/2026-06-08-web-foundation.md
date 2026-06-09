# Web Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A React + Vite + TypeScript app that drives the real `engine-wasm` package through a complete baccarat round (bet → deal → reveal → settle), functional but minimally styled.

**Architecture:** An npm workspace adds a `web/` package. A single **engine adapter** is the only importer of `engine-wasm`; it exposes a typed, plain-number, throw-free `GameSession`. A **Zustand store** (constructed with an injected `GameSession`) holds the current `RoundSnapshot` plus UI-only state and is the source of truth. **Presentational components** take props (snapshot slices + callbacks) so they test against hand-written fixtures with no wasm. `App` wires store → props.

**Tech Stack:** React 18, Vite 5, TypeScript (strict), Zustand, `vite-plugin-wasm`, `vite-plugin-top-level-await`, Vitest, @testing-library/react, jsdom.

**Spec:** `docs/superpowers/specs/2026-06-08-web-foundation-design.md`

---

## Conventions & gotchas (read once)

- **Absolute paths in shells.** Always `cd /home/sabien/Dev/personal/baccarat-simulator` (or an absolute subdir) at the start of a shell step; the cwd is not reliable.
- **Money:** all engine money is **cents** (`number` in snapshots). The ONLY `bigint` boundary is `WasmSession.place_bet(kind, amount: bigint)` — the adapter converts `number → BigInt` there. Everything else (bankroll, payouts) is already `number`.
- **Engine commands throw on error.** `WasmSession` methods return `RoundSnapshot` and *throw* a serialized `CommandError` on rejection. The adapter converts throws into `{ ok: false, error }` so nothing else needs try/catch.
- **`engine-wasm/pkg/` is generated and git-ignored.** It must be (re)built with `wasm-pack build engine-wasm --target bundler` before `web` installs/builds. The existing `smoke/` uses the `--target nodejs` build of the same `pkg/`; they share the dir (spec open item 7.1) — for web work, build the **bundler** target.
- **Components are presentational** (props in, callbacks out). The store is the only stateful unit and is unit-tested with a fake `GameSession`. This keeps every component test wasm-free.
- **Verify, don't trust.** Each task ends green: `npm --workspace web run typecheck` and `npm --workspace web test` must pass.

---

## Task 0: Build the bundler wasm package (prerequisite)

- [ ] **Step 1: Build the bundler target**

Run: `cd /home/sabien/Dev/personal/baccarat-simulator && wasm-pack build engine-wasm --target bundler 2>&1 | tail -4`
Expected: `Your wasm pkg is ready to publish at .../engine-wasm/pkg`. Confirm `engine-wasm/pkg/engine_wasm.js`, `engine_wasm_bg.wasm`, `engine_wasm.d.ts` exist. No commit (pkg/ is git-ignored).

---

## Task 1: npm workspace + web scaffold + wasm build wiring (walking skeleton)

Create the workspace root, scaffold the Vite React-TS app, wire the wasm plugins and Vitest, and prove it renders.

**Files:**
- Create: `package.json` (workspace root)
- Create (scaffolded): `web/` (Vite react-ts template), then customize:
- Create/Modify: `web/package.json`, `web/vite.config.ts`, `web/vitest.setup.ts`, `web/tsconfig.json`, `web/src/App.tsx`, `web/src/main.tsx`, `web/index.html`
- Create: `web/src/App.test.tsx`
- Modify: `.gitignore`

- [ ] **Step 1: Create the workspace root `package.json`**

Create `/home/sabien/Dev/personal/baccarat-simulator/package.json`:
```json
{
  "name": "baccarat-simulator",
  "private": true,
  "workspaces": ["web", "smoke"],
  "scripts": {
    "build:wasm": "wasm-pack build engine-wasm --target bundler"
  }
}
```

- [ ] **Step 2: Scaffold the Vite React-TS app**

Run: `cd /home/sabien/Dev/personal/baccarat-simulator && npm create vite@latest web -- --template react-ts`
Expected: creates `web/` with `package.json`, `vite.config.ts`, `tsconfig*.json`, `src/`, `index.html`. (If it prompts, the `--template react-ts` makes it non-interactive; if a prompt still appears, choose React → TypeScript.)
Then delete the template demo files that we replace: `rm -f web/src/App.css web/src/index.css web/src/assets/react.svg web/public/vite.svg` and empty `web/src/App.tsx`/`web/src/main.tsx` (replaced below).

- [ ] **Step 3: Set `web/package.json`**

Overwrite `web/package.json`:
```json
{
  "name": "baccarat-web",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc --noEmit && vite build",
    "preview": "vite preview",
    "typecheck": "tsc --noEmit",
    "test": "vitest run"
  },
  "dependencies": {
    "engine-wasm": "file:../engine-wasm/pkg",
    "react": "^18.3.1",
    "react-dom": "^18.3.1",
    "zustand": "^4.5.5"
  },
  "devDependencies": {
    "@testing-library/jest-dom": "^6.4.8",
    "@testing-library/react": "^16.0.1",
    "@testing-library/user-event": "^14.5.2",
    "@types/react": "^18.3.5",
    "@types/react-dom": "^18.3.0",
    "@vitejs/plugin-react": "^4.3.1",
    "jsdom": "^25.0.0",
    "typescript": "^5.5.4",
    "vite": "^5.4.2",
    "vite-plugin-top-level-await": "^1.4.4",
    "vite-plugin-wasm": "^3.3.0",
    "vitest": "^2.0.5"
  }
}
```

- [ ] **Step 4: Configure Vite + Vitest (`web/vite.config.ts`)**

Overwrite `web/vite.config.ts`:
```ts
/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import wasm from "vite-plugin-wasm";
import topLevelAwait from "vite-plugin-top-level-await";

export default defineConfig({
  plugins: [react(), wasm(), topLevelAwait()],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./vitest.setup.ts"],
  },
});
```

- [ ] **Step 5: Vitest setup + tsconfig**

Create `web/vitest.setup.ts`:
```ts
import "@testing-library/jest-dom/vitest";
```
Ensure `web/tsconfig.json` (or `tsconfig.app.json` it references) has `"types": ["vitest/globals", "@testing-library/jest-dom"]` in `compilerOptions`, `"jsx": "react-jsx"`, `"strict": true`, `"moduleResolution": "bundler"`, and includes `vitest.setup.ts`. If the scaffold split config into `tsconfig.app.json`, add the `types` there and keep `tsconfig.json` as the project-references root; for `tsc --noEmit` to typecheck tests, set `web/tsconfig.json` to a single flat config:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "useDefineForClassFields": true,
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "jsx": "react-jsx",
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noEmit": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "types": ["vitest/globals", "@testing-library/jest-dom", "node"]
  },
  "include": ["src", "vite.config.ts", "vitest.setup.ts"]
}
```
(Delete `web/tsconfig.app.json` and `web/tsconfig.node.json` if present — we use the single flat `tsconfig.json` above. The `build` script set in Step 3 already uses `tsc --noEmit && vite build`, consistent with this flat config.)

- [ ] **Step 6: Minimal app + render test**

Overwrite `web/index.html` `<title>` to `Baccarat Simulator` and ensure the script points to `/src/main.tsx` (the scaffold already does this).

Create `web/src/main.tsx`:
```tsx
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
```

Create `web/src/App.tsx`:
```tsx
export function App() {
  return <h1>Baccarat Simulator</h1>;
}
```

Create `web/src/App.test.tsx`:
```tsx
import { render, screen } from "@testing-library/react";
import { App } from "./App";

test("renders the app title", () => {
  render(<App />);
  expect(screen.getByRole("heading", { name: "Baccarat Simulator" })).toBeInTheDocument();
});
```

- [ ] **Step 7: Install dependencies (workspace)**

Run: `cd /home/sabien/Dev/personal/baccarat-simulator && npm install 2>&1 | tail -8`
Expected: installs the workspace; `engine-wasm` resolves from the local `pkg/` (built in Task 0). No errors. (If npm complains that `engine-wasm/pkg` is missing, re-run Task 0.)

- [ ] **Step 8: Typecheck + test the skeleton**

Run:
```bash
cd /home/sabien/Dev/personal/baccarat-simulator
npm --workspace web run typecheck 2>&1 | tail -10
npm --workspace web test 2>&1 | tail -15
```
Expected: typecheck clean; `App` render test passes (1 passed).

- [ ] **Step 9: Ignore web build artifacts**

Append to `.gitignore` (check first; don't duplicate):
```
node_modules/
web/dist/
```

- [ ] **Step 10: Commit**

```bash
cd /home/sabien/Dev/personal/baccarat-simulator
git add package.json package-lock.json web .gitignore
git commit -m "feat(web): npm workspace + Vite React-TS scaffold with wasm + vitest

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```
(Confirm `git status` does NOT show `node_modules/` or `engine-wasm/pkg/` as tracked.)

---

## Task 2: Types re-export + money formatter

Small, pure units used everywhere downstream.

**Files:**
- Create: `web/src/engine/types.ts`
- Create: `web/src/format.ts`
- Test: `web/src/format.test.ts`

- [ ] **Step 1: Re-export the generated engine types**

Create `web/src/engine/types.ts`:
```ts
// The single place the app imports engine types from. Mirrors engine-wasm's .d.ts.
export type {
  RoundSnapshot,
  SessionConfig,
  BetKind,
  BetSpot,
  SideBet,
  BetSide,
  CommandError,
  Side,
  CardView,
  HandView,
  Card,
  Rank,
  Suit,
  Pip,
  Outcome,
  PhaseTag,
  PlacedBet,
  BetPayout,
  ScoreboardSnapshot,
  BeadPlate,
  BeadCell,
  BigRoad,
  BigRoadCell,
  DerivedRoad,
  Mark,
  GlossaryEntry,
  Event,
} from "engine-wasm";
```

- [ ] **Step 2: Write the failing formatter test**

Create `web/src/format.test.ts`:
```ts
import { formatCents } from "./format";

test("formats whole dollars", () => {
  expect(formatCents(100000)).toBe("$1,000.00");
});

test("formats cents", () => {
  expect(formatCents(2550)).toBe("$25.50");
});

test("formats zero", () => {
  expect(formatCents(0)).toBe("$0.00");
});

test("formats negatives (a net loss)", () => {
  expect(formatCents(-500)).toBe("-$5.00");
});
```

- [ ] **Step 3: Run it — verify it fails**

Run: `cd /home/sabien/Dev/personal/baccarat-simulator && npm --workspace web test -- format 2>&1 | tail -10`
Expected: FAIL — cannot find `./format` / `formatCents`.

- [ ] **Step 4: Implement `formatCents`**

Create `web/src/format.ts`:
```ts
/** Format integer cents as a US dollar string, e.g. 100000 -> "$1,000.00". */
export function formatCents(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  const dollars = Math.floor(abs / 100);
  const remainder = (abs % 100).toString().padStart(2, "0");
  const grouped = dollars.toLocaleString("en-US");
  return `${sign}$${grouped}.${remainder}`;
}
```

- [ ] **Step 5: Run it — verify it passes**

Run: `cd /home/sabien/Dev/personal/baccarat-simulator && npm --workspace web test -- format 2>&1 | tail -10`
Expected: PASS (4 tests).

- [ ] **Step 6: Commit**

```bash
cd /home/sabien/Dev/personal/baccarat-simulator
git add web/src/engine/types.ts web/src/format.ts web/src/format.test.ts
git commit -m "feat(web): engine type re-exports + cents formatter

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: Engine adapter

The one module that imports `engine-wasm`. Converts the bigint money boundary and turns thrown `CommandError`s into result values.

**Files:**
- Create: `web/src/engine/adapter.ts`
- Test: `web/src/engine/adapter.test.ts` (real wasm, node env)

- [ ] **Step 1: Write the failing integration test**

Create `web/src/engine/adapter.test.ts`:
```ts
// @vitest-environment node
import { createSession, getGlossary } from "./adapter";
import type { SessionConfig } from "./types";

const config: SessionConfig = {
  starting_bankroll: 100000,
  table_min: 100,
  table_max: 10000,
  ruleset: "Commission",
  seed: 7,
};

test("plays a full round through the adapter", () => {
  const session = createSession(config);
  expect(session.snapshot().phase).toBe("Betting");

  const placed = session.placeBet({ Main: "Player" }, 500);
  expect(placed.ok).toBe(true);

  const dealt = session.deal();
  expect(dealt.ok).toBe(true);

  const settled = session.settle();
  expect(settled.ok).toBe(true);
  if (settled.ok) {
    expect(settled.snapshot.phase).toBe("Settled");
    expect(settled.snapshot.outcome).not.toBeNull();
    expect(settled.snapshot.payouts).not.toBeNull();
  }
});

test("a wrong-phase command returns ok:false with a typed error", () => {
  const session = createSession(config);
  const result = session.settle(); // settle before deal -> WrongPhase
  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.error).toHaveProperty("WrongPhase");
  }
});

test("glossary is non-empty and includes monkey", () => {
  const terms = getGlossary();
  expect(terms.length).toBeGreaterThanOrEqual(20);
  expect(terms.some((t) => t.term === "monkey")).toBe(true);
});
```

- [ ] **Step 2: Run it — verify it fails**

Run: `cd /home/sabien/Dev/personal/baccarat-simulator && npm --workspace web test -- adapter 2>&1 | tail -15`
Expected: FAIL — cannot find `./adapter`.

- [ ] **Step 3: Implement the adapter**

Create `web/src/engine/adapter.ts`:
```ts
import { WasmSession, glossary as wasmGlossary } from "engine-wasm";
import type {
  RoundSnapshot,
  SessionConfig,
  BetKind,
  CommandError,
  Side,
  GlossaryEntry,
} from "./types";

/** A command either advances the game (new snapshot) or is rejected (typed error). */
export type CommandResult =
  | { ok: true; snapshot: RoundSnapshot }
  | { ok: false; error: CommandError };

/** Plain, throw-free, number-based facade over a wasm `WasmSession`. */
export interface GameSession {
  snapshot(): RoundSnapshot;
  placeBet(kind: BetKind, amountCents: number): CommandResult;
  clearBets(): CommandResult;
  deal(): CommandResult;
  peek(hand: Side, index: number): CommandResult;
  reveal(hand: Side, index: number): CommandResult;
  settle(): CommandResult;
  newShoe(): CommandResult;
}

function run(fn: () => RoundSnapshot): CommandResult {
  try {
    return { ok: true, snapshot: fn() };
  } catch (error) {
    // WasmSession throws the serialized CommandError object on rejection.
    return { ok: false, error: error as CommandError };
  }
}

export function createSession(config: SessionConfig): GameSession {
  const inner = new WasmSession(config);
  return {
    snapshot: () => inner.snapshot(),
    placeBet: (kind, amountCents) =>
      run(() => inner.place_bet(kind, BigInt(amountCents))),
    clearBets: () => run(() => inner.clear_bets()),
    deal: () => run(() => inner.deal_round()),
    peek: (hand, index) => run(() => inner.peek(hand, index)),
    reveal: (hand, index) => run(() => inner.reveal(hand, index)),
    settle: () => run(() => inner.settle()),
    newShoe: () => run(() => inner.new_shoe()),
  };
}

export function getGlossary(): GlossaryEntry[] {
  return wasmGlossary();
}
```

- [ ] **Step 4: Run it — verify it passes**

Run: `cd /home/sabien/Dev/personal/baccarat-simulator && npm --workspace web test -- adapter 2>&1 | tail -15`
Expected: PASS (3 tests). This proves the bundler-target wasm loads under Vitest's node environment and the marshaling (BigInt, error-catch) works.
NOTE: if the bundler wasm fails to load under Vitest node env (a `vite-plugin-wasm`/top-level-await interaction), do NOT weaken the test — report it. The fallback (spec open item 7.2) is to point this one test at the `--target nodejs` build; but attempt the bundler path first since the web app uses it.

- [ ] **Step 5: Commit**

```bash
cd /home/sabien/Dev/personal/baccarat-simulator
git add web/src/engine/adapter.ts web/src/engine/adapter.test.ts
git commit -m "feat(web): engine adapter — typed throw-free GameSession over wasm

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4: Game store (Zustand, injected session)

The only stateful unit. Tested with a fake `GameSession` — no wasm.

**Files:**
- Create: `web/src/store/gameStore.ts`
- Test: `web/src/store/gameStore.test.ts`

- [ ] **Step 1: Write the failing store test**

Create `web/src/store/gameStore.test.ts`:
```ts
import { createGameStore, CHIP_DENOMINATIONS } from "./gameStore";
import type { GameSession, CommandResult } from "../engine/adapter";
import type { RoundSnapshot, CommandError } from "../engine/types";

function snapshotWith(overrides: Partial<RoundSnapshot> = {}): RoundSnapshot {
  return {
    phase: "Betting",
    player: { cards: [], total: null },
    banker: { cards: [], total: null },
    bets: [],
    bankroll: 100000,
    table_min: 100,
    table_max: 10000,
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
    ...overrides,
  };
}

/** A fake session whose every command returns a fixed result. */
function fakeSession(result: CommandResult, initial?: RoundSnapshot): GameSession {
  const snap = initial ?? snapshotWith();
  return {
    snapshot: () => snap,
    placeBet: () => result,
    clearBets: () => result,
    deal: () => result,
    peek: () => result,
    reveal: () => result,
    settle: () => result,
    newShoe: () => result,
  };
}

test("starts from the session's initial snapshot and first chip", () => {
  const store = createGameStore(fakeSession({ ok: true, snapshot: snapshotWith() }));
  expect(store.getState().snapshot.phase).toBe("Betting");
  expect(store.getState().selectedChip).toBe(CHIP_DENOMINATIONS[0]);
  expect(store.getState().lastError).toBeNull();
});

test("a successful command replaces the snapshot and clears lastError", () => {
  const dealt = snapshotWith({ phase: "Dealing" });
  const store = createGameStore(fakeSession({ ok: true, snapshot: dealt }));
  store.getState().deal();
  expect(store.getState().snapshot.phase).toBe("Dealing");
  expect(store.getState().lastError).toBeNull();
});

test("a rejected command sets lastError and leaves the snapshot unchanged", () => {
  const error: CommandError = { WrongPhase: { expected: "Dealing", found: "Betting" } };
  const store = createGameStore(fakeSession({ ok: false, error }));
  const before = store.getState().snapshot;
  store.getState().settle();
  expect(store.getState().lastError).toEqual(error);
  expect(store.getState().snapshot).toBe(before);
});

test("setSelectedChip updates the active denomination", () => {
  const store = createGameStore(fakeSession({ ok: true, snapshot: snapshotWith() }));
  store.getState().setSelectedChip(50000);
  expect(store.getState().selectedChip).toBe(50000);
});
```

- [ ] **Step 2: Run it — verify it fails**

Run: `cd /home/sabien/Dev/personal/baccarat-simulator && npm --workspace web test -- gameStore 2>&1 | tail -12`
Expected: FAIL — cannot find `./gameStore`.

- [ ] **Step 3: Implement the store**

Create `web/src/store/gameStore.ts`:
```ts
import { createStore, type StoreApi } from "zustand/vanilla";
import type { RoundSnapshot, BetKind, CommandError, Side } from "../engine/types";
import type { GameSession, CommandResult } from "../engine/adapter";

/** Chip denominations in cents: $25 / $100 / $500 / $1,000. */
export const CHIP_DENOMINATIONS = [2500, 10000, 50000, 100000];

export interface GameState {
  snapshot: RoundSnapshot;
  selectedChip: number;
  lastError: CommandError | null;
  setSelectedChip: (cents: number) => void;
  placeSelectedBet: (kind: BetKind) => void;
  clearBets: () => void;
  deal: () => void;
  peek: (side: Side, index: number) => void;
  reveal: (side: Side, index: number) => void;
  settle: () => void;
  newShoe: () => void;
}

export function createGameStore(session: GameSession): StoreApi<GameState> {
  return createStore<GameState>((set, get) => {
    const apply = (result: CommandResult) => {
      if (result.ok) set({ snapshot: result.snapshot, lastError: null });
      else set({ lastError: result.error });
    };
    return {
      snapshot: session.snapshot(),
      selectedChip: CHIP_DENOMINATIONS[0],
      lastError: null,
      setSelectedChip: (cents) => set({ selectedChip: cents }),
      placeSelectedBet: (kind) => apply(session.placeBet(kind, get().selectedChip)),
      clearBets: () => apply(session.clearBets()),
      deal: () => apply(session.deal()),
      peek: (side, index) => apply(session.peek(side, index)),
      reveal: (side, index) => apply(session.reveal(side, index)),
      settle: () => apply(session.settle()),
      newShoe: () => apply(session.newShoe()),
    };
  });
}
```

- [ ] **Step 4: Run it — verify it passes**

Run: `cd /home/sabien/Dev/personal/baccarat-simulator && npm --workspace web test -- gameStore 2>&1 | tail -12`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
cd /home/sabien/Dev/personal/baccarat-simulator
git add web/src/store/gameStore.ts web/src/store/gameStore.test.ts
git commit -m "feat(web): Zustand game store with injected session + error handling

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 5: Snapshot fixtures + Hud + Hand components

Presentational components tested against hand-written fixtures.

**Files:**
- Create: `web/src/test/fixtures.ts`
- Create: `web/src/components/Hud.tsx`, `web/src/components/Hud.test.tsx`
- Create: `web/src/components/Hand.tsx`, `web/src/components/Hand.test.tsx`

- [ ] **Step 1: Create reusable fixtures**

Create `web/src/test/fixtures.ts`:
```ts
import type { RoundSnapshot } from "../engine/types";

export function bettingSnapshot(overrides: Partial<RoundSnapshot> = {}): RoundSnapshot {
  return {
    phase: "Betting",
    player: { cards: [], total: null },
    banker: { cards: [], total: null },
    bets: [],
    bankroll: 100000,
    table_min: 100,
    table_max: 10000,
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
    ...overrides,
  };
}

/** A Dealing snapshot: player has a face-up 9 + a peeked card; banker face-down. */
export function dealingSnapshot(): RoundSnapshot {
  return bettingSnapshot({
    phase: "Dealing",
    player: {
      cards: [
        { FaceUp: { rank: "Nine", suit: "Hearts" } },
        { Peeked: { sliver: { suit: "Spades" } } },
      ],
      total: null,
    },
    banker: { cards: ["FaceDown", "FaceDown"], total: null },
    bets: [{ kind: { Main: "Player" }, amount: 500 }],
  });
}

/** A Settled snapshot: player 9 beats banker 5, with a winning Player payout. */
export function settledSnapshot(): RoundSnapshot {
  return bettingSnapshot({
    phase: "Settled",
    player: {
      cards: [
        { FaceUp: { rank: "Four", suit: "Clubs" } },
        { FaceUp: { rank: "Five", suit: "Diamonds" } },
      ],
      total: 9,
    },
    banker: {
      cards: [
        { FaceUp: { rank: "Two", suit: "Spades" } },
        { FaceUp: { rank: "Three", suit: "Hearts" } },
      ],
      total: 5,
    },
    bets: [{ kind: { Main: "Player" }, amount: 500 }],
    outcome: "PlayerWin",
    payouts: [{ bet: { kind: { Main: "Player" }, amount: 500 }, net: 500 }],
    bankroll: 100500,
  });
}

/** A snapshot whose scoreboard has a few rounds of history. */
export function scoredSnapshot(): RoundSnapshot {
  return bettingSnapshot({
    scoreboard: {
      bead_plate: {
        cells: [
          { outcome: "PlayerWin", player_pair: false, banker_pair: false },
          { outcome: "BankerWin", player_pair: false, banker_pair: false },
          { outcome: "Tie", player_pair: false, banker_pair: false },
        ],
      },
      big_road: {
        columns: [
          [{ side: "Player", ties: 0, player_pair: false, banker_pair: false }],
          [{ side: "Banker", ties: 1, player_pair: false, banker_pair: false }],
        ],
      },
      big_eye_boy: { columns: [["Red", "Blue"]] },
      small_road: { columns: [["Blue"]] },
      cockroach_pig: { columns: [["Red"]] },
    },
  });
}
```

- [ ] **Step 2: Write the failing Hud test**

Create `web/src/components/Hud.test.tsx`:
```tsx
import { render, screen } from "@testing-library/react";
import { Hud } from "./Hud";
import { bettingSnapshot, settledSnapshot } from "../test/fixtures";

test("shows bankroll, phase, and table limits", () => {
  render(<Hud snapshot={bettingSnapshot()} lastError={null} />);
  expect(screen.getByText("$1,000.00")).toBeInTheDocument();
  expect(screen.getByText(/Betting/)).toBeInTheDocument();
});

test("shows outcome and payouts when settled", () => {
  render(<Hud snapshot={settledSnapshot()} lastError={null} />);
  expect(screen.getByText(/PlayerWin/)).toBeInTheDocument();
  expect(screen.getByText("+$5.00")).toBeInTheDocument(); // net payout
});

test("shows an error message when a command was rejected", () => {
  render(
    <Hud
      snapshot={bettingSnapshot()}
      lastError={{ WrongPhase: { expected: "Dealing", found: "Betting" } }}
    />,
  );
  expect(screen.getByRole("alert")).toHaveTextContent(/WrongPhase/);
});
```

- [ ] **Step 3: Run it — verify it fails**

Run: `cd /home/sabien/Dev/personal/baccarat-simulator && npm --workspace web test -- Hud 2>&1 | tail -12`
Expected: FAIL — cannot find `./Hud`.

- [ ] **Step 4: Implement Hud**

Create `web/src/components/Hud.tsx`:
```tsx
import type { RoundSnapshot, CommandError } from "../engine/types";
import { formatCents } from "../format";

interface HudProps {
  snapshot: RoundSnapshot;
  lastError: CommandError | null;
}

/** Format a signed net amount, e.g. 500 -> "+$5.00", -500 -> "-$5.00". */
function formatNet(net: number): string {
  return net >= 0 ? `+${formatCents(net)}` : formatCents(net);
}

export function Hud({ snapshot, lastError }: HudProps) {
  return (
    <section aria-label="HUD">
      <dl>
        <dt>Bankroll</dt>
        <dd>{formatCents(snapshot.bankroll)}</dd>
        <dt>Phase</dt>
        <dd>{snapshot.phase}</dd>
        <dt>Table</dt>
        <dd>
          {formatCents(snapshot.table_min)} – {formatCents(snapshot.table_max)}
        </dd>
      </dl>

      {snapshot.outcome !== null && (
        <p>Outcome: {snapshot.outcome}</p>
      )}

      {snapshot.payouts !== null && (
        <ul aria-label="payouts">
          {snapshot.payouts.map((p, i) => (
            <li key={i}>
              {describeBet(p.bet.kind)}: {formatNet(p.net)}
            </li>
          ))}
        </ul>
      )}

      {lastError !== null && (
        <p role="alert">{JSON.stringify(lastError)}</p>
      )}
    </section>
  );
}

/** A short human label for a BetKind, for now JSON-ish; richer copy comes later. */
function describeBet(kind: RoundSnapshot["bets"][number]["kind"]): string {
  if ("Main" in kind) return kind.Main;
  if (typeof kind.Side === "string") return kind.Side;
  return Object.keys(kind.Side)[0];
}
```

- [ ] **Step 5: Run it — verify it passes**

Run: `cd /home/sabien/Dev/personal/baccarat-simulator && npm --workspace web test -- Hud 2>&1 | tail -12`
Expected: PASS (3 tests).

- [ ] **Step 6: Write the failing Hand test**

Create `web/src/components/Hand.test.tsx`:
```tsx
import { render, screen } from "@testing-library/react";
import { Hand } from "./Hand";
import { dealingSnapshot, settledSnapshot } from "../test/fixtures";

test("renders face-up, peeked, and face-down cards", () => {
  const snap = dealingSnapshot();
  render(<Hand side="Player" hand={snap.player} />);
  expect(screen.getByText(/Nine of Hearts/)).toBeInTheDocument();
  expect(screen.getByText(/Peeked: Spades/)).toBeInTheDocument();
});

test("hides total while cards are not all face-up", () => {
  const snap = dealingSnapshot();
  render(<Hand side="Player" hand={snap.player} />);
  expect(screen.queryByText(/Total:/)).not.toBeInTheDocument();
});

test("shows total when the hand is fully revealed", () => {
  const snap = settledSnapshot();
  render(<Hand side="Player" hand={snap.player} />);
  expect(screen.getByText("Total: 9")).toBeInTheDocument();
});
```

- [ ] **Step 7: Run it — verify it fails**

Run: `cd /home/sabien/Dev/personal/baccarat-simulator && npm --workspace web test -- Hand 2>&1 | tail -12`
Expected: FAIL — cannot find `./Hand`.

- [ ] **Step 8: Implement Hand**

Create `web/src/components/Hand.tsx`:
```tsx
import type { Side, HandView, CardView } from "../engine/types";

interface HandProps {
  side: Side;
  hand: HandView;
}

function describeCard(card: CardView): string {
  if (card === "FaceDown") return "🂠";
  if ("Peeked" in card) return `Peeked: ${card.Peeked.sliver.suit}`;
  return `${card.FaceUp.rank} of ${card.FaceUp.suit}`;
}

export function Hand({ side, hand }: HandProps) {
  return (
    <div aria-label={`${side} hand`}>
      <h3>{side}</h3>
      <ul>
        {hand.cards.map((card, i) => (
          <li key={i}>{describeCard(card)}</li>
        ))}
      </ul>
      {hand.total !== null && <p>Total: {hand.total}</p>}
    </div>
  );
}
```

- [ ] **Step 9: Run it — verify it passes**

Run: `cd /home/sabien/Dev/personal/baccarat-simulator && npm --workspace web test -- Hand 2>&1 | tail -12`
Expected: PASS (3 tests).

- [ ] **Step 10: Commit**

```bash
cd /home/sabien/Dev/personal/baccarat-simulator
git add web/src/test/fixtures.ts web/src/components/Hud.tsx web/src/components/Hud.test.tsx web/src/components/Hand.tsx web/src/components/Hand.test.tsx
git commit -m "feat(web): fixtures + Hud and Hand components

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 6: BetRail + Controls components

Interaction components: chip selector, bet spots, phase-aware controls. Tested with `userEvent` and `vi.fn()` callbacks.

**Files:**
- Create: `web/src/components/BetRail.tsx`, `web/src/components/BetRail.test.tsx`
- Create: `web/src/components/Controls.tsx`, `web/src/components/Controls.test.tsx`

- [ ] **Step 1: Write the failing BetRail test**

Create `web/src/components/BetRail.test.tsx`:
```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { BetRail } from "./BetRail";
import { bettingSnapshot, dealingSnapshot } from "../test/fixtures";
import type { BetKind } from "../engine/types";

test("placing a bet calls onPlaceBet with the spot's BetKind", async () => {
  const onPlaceBet = vi.fn();
  render(
    <BetRail
      snapshot={bettingSnapshot()}
      selectedChip={2500}
      onSelectChip={vi.fn()}
      onPlaceBet={onPlaceBet}
      onClear={vi.fn()}
    />,
  );
  await userEvent.click(screen.getByRole("button", { name: "Bet Player" }));
  const expected: BetKind = { Main: "Player" };
  expect(onPlaceBet).toHaveBeenCalledWith(expected);
});

test("selecting a chip calls onSelectChip with the denomination", async () => {
  const onSelectChip = vi.fn();
  render(
    <BetRail
      snapshot={bettingSnapshot()}
      selectedChip={2500}
      onSelectChip={onSelectChip}
      onPlaceBet={vi.fn()}
      onClear={vi.fn()}
    />,
  );
  await userEvent.click(screen.getByRole("button", { name: "$500.00 chip" }));
  expect(onSelectChip).toHaveBeenCalledWith(50000);
});

test("bet spots are disabled outside the Betting phase", () => {
  render(
    <BetRail
      snapshot={dealingSnapshot()}
      selectedChip={2500}
      onSelectChip={vi.fn()}
      onPlaceBet={vi.fn()}
      onClear={vi.fn()}
    />,
  );
  expect(screen.getByRole("button", { name: "Bet Player" })).toBeDisabled();
});

test("lists staged bets with formatted amounts", () => {
  render(
    <BetRail
      snapshot={dealingSnapshot()}
      selectedChip={2500}
      onSelectChip={vi.fn()}
      onPlaceBet={vi.fn()}
      onClear={vi.fn()}
    />,
  );
  expect(screen.getByText(/Player.*\$5\.00/)).toBeInTheDocument();
});
```

- [ ] **Step 2: Run it — verify it fails**

Run: `cd /home/sabien/Dev/personal/baccarat-simulator && npm --workspace web test -- BetRail 2>&1 | tail -12`
Expected: FAIL — cannot find `./BetRail`.

- [ ] **Step 3: Implement BetRail**

Create `web/src/components/BetRail.tsx`:
```tsx
import type { RoundSnapshot, BetKind } from "../engine/types";
import { formatCents } from "../format";
import { CHIP_DENOMINATIONS } from "../store/gameStore";

interface BetRailProps {
  snapshot: RoundSnapshot;
  selectedChip: number;
  onSelectChip: (cents: number) => void;
  onPlaceBet: (kind: BetKind) => void;
  onClear: () => void;
}

interface Spot {
  label: string;
  kind: BetKind;
}

// A representative set of spots for the foundation (full SideBet family lands later).
const SPOTS: Spot[] = [
  { label: "Player", kind: { Main: "Player" } },
  { label: "Tie", kind: { Main: "Tie" } },
  { label: "Banker", kind: { Main: "Banker" } },
  { label: "Player Pair", kind: { Side: "PlayerPair" } },
  { label: "Banker Pair", kind: { Side: "BankerPair" } },
  { label: "Dragon 7", kind: { Side: "Dragon7" } },
  { label: "Panda 8", kind: { Side: "Panda8" } },
  { label: "Dragon Bonus (P)", kind: { Side: { DragonBonus: "Player" } } },
  { label: "Tiger", kind: { Side: "Tiger" } },
];

function describeBet(kind: BetKind): string {
  if ("Main" in kind) return kind.Main;
  if (typeof kind.Side === "string") return kind.Side;
  return Object.keys(kind.Side)[0];
}

export function BetRail({
  snapshot,
  selectedChip,
  onSelectChip,
  onPlaceBet,
  onClear,
}: BetRailProps) {
  const betting = snapshot.phase === "Betting";
  return (
    <section aria-label="Bet rail">
      <div aria-label="Chips">
        {CHIP_DENOMINATIONS.map((cents) => (
          <button
            key={cents}
            type="button"
            aria-pressed={selectedChip === cents}
            onClick={() => onSelectChip(cents)}
          >
            {formatCents(cents)} chip
          </button>
        ))}
      </div>

      <div aria-label="Spots">
        {SPOTS.map((spot) => (
          <button
            key={spot.label}
            type="button"
            disabled={!betting}
            onClick={() => onPlaceBet(spot.kind)}
          >
            Bet {spot.label}
          </button>
        ))}
      </div>

      <ul aria-label="Staged bets">
        {snapshot.bets.map((bet, i) => (
          <li key={i}>
            {describeBet(bet.kind)} {formatCents(bet.amount)}
          </li>
        ))}
      </ul>

      <button type="button" disabled={!betting} onClick={onClear}>
        Clear bets
      </button>
    </section>
  );
}
```

- [ ] **Step 4: Run it — verify it passes**

Run: `cd /home/sabien/Dev/personal/baccarat-simulator && npm --workspace web test -- BetRail 2>&1 | tail -12`
Expected: PASS (4 tests).

- [ ] **Step 5: Write the failing Controls test**

Create `web/src/components/Controls.test.tsx`:
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
      onReveal={vi.fn()}
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
      onReveal={vi.fn()}
      onSettle={vi.fn()}
      onNewShoe={vi.fn()}
    />,
  );
  expect(screen.getByRole("button", { name: "Deal" })).toBeDisabled();
});

test("Settle is enabled in Dealing and a Reveal button exists per hidden card", () => {
  render(
    <Controls
      snapshot={dealingSnapshot()}
      onDeal={vi.fn()}
      onReveal={vi.fn()}
      onSettle={vi.fn()}
      onNewShoe={vi.fn()}
    />,
  );
  expect(screen.getByRole("button", { name: "Settle" })).toBeEnabled();
  // dealing fixture: player has 1 peeked + banker has 2 face-down = 3 revealable
  expect(screen.getAllByRole("button", { name: /^Reveal / })).toHaveLength(3);
});

test("clicking a Reveal button calls onReveal with that hand and index", async () => {
  const onReveal = vi.fn();
  render(
    <Controls
      snapshot={dealingSnapshot()}
      onDeal={vi.fn()}
      onReveal={onReveal}
      onSettle={vi.fn()}
      onNewShoe={vi.fn()}
    />,
  );
  await userEvent.click(screen.getByRole("button", { name: "Reveal Player 1" }));
  expect(onReveal).toHaveBeenCalledWith("Player", 1);
});
```

- [ ] **Step 6: Run it — verify it fails**

Run: `cd /home/sabien/Dev/personal/baccarat-simulator && npm --workspace web test -- Controls 2>&1 | tail -12`
Expected: FAIL — cannot find `./Controls`.

- [ ] **Step 7: Implement Controls**

Create `web/src/components/Controls.tsx`:
```tsx
import type { RoundSnapshot, Side, CardView } from "../engine/types";

interface ControlsProps {
  snapshot: RoundSnapshot;
  onDeal: () => void;
  onReveal: (side: Side, index: number) => void;
  onSettle: () => void;
  onNewShoe: () => void;
}

/** Indices of cards in a hand that are not yet fully face-up (peek or face-down). */
function hiddenIndices(cards: CardView[]): number[] {
  const out: number[] = [];
  cards.forEach((card, i) => {
    const faceUp = card !== "FaceDown" && typeof card === "object" && "FaceUp" in card;
    if (!faceUp) out.push(i);
  });
  return out;
}

export function Controls({
  snapshot,
  onDeal,
  onReveal,
  onSettle,
  onNewShoe,
}: ControlsProps) {
  const betting = snapshot.phase === "Betting";
  const dealing = snapshot.phase === "Dealing";
  const hasBets = snapshot.bets.length > 0;

  const reveals: Array<{ side: Side; index: number }> = [];
  if (dealing) {
    for (const index of hiddenIndices(snapshot.player.cards)) {
      reveals.push({ side: "Player", index });
    }
    for (const index of hiddenIndices(snapshot.banker.cards)) {
      reveals.push({ side: "Banker", index });
    }
  }

  return (
    <section aria-label="Controls">
      <button type="button" disabled={!betting || !hasBets} onClick={onDeal}>
        Deal
      </button>
      {reveals.map(({ side, index }) => (
        <button
          key={`${side}-${index}`}
          type="button"
          onClick={() => onReveal(side, index)}
        >
          Reveal {side} {index}
        </button>
      ))}
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

- [ ] **Step 8: Run it — verify it passes**

Run: `cd /home/sabien/Dev/personal/baccarat-simulator && npm --workspace web test -- Controls 2>&1 | tail -12`
Expected: PASS (4 tests).

- [ ] **Step 9: Commit**

```bash
cd /home/sabien/Dev/personal/baccarat-simulator
git add web/src/components/BetRail.tsx web/src/components/BetRail.test.tsx web/src/components/Controls.tsx web/src/components/Controls.test.tsx
git commit -m "feat(web): BetRail and Controls interaction components

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 7: Scoreboard component

Renders the five roads from `ScoreboardSnapshot`.

**Files:**
- Create: `web/src/components/Scoreboard.tsx`, `web/src/components/Scoreboard.test.tsx`

- [ ] **Step 1: Write the failing Scoreboard test**

Create `web/src/components/Scoreboard.test.tsx`:
```tsx
import { render, screen, within } from "@testing-library/react";
import { Scoreboard } from "./Scoreboard";
import { scoredSnapshot, bettingSnapshot } from "../test/fixtures";

test("renders one bead per round in the bead plate", () => {
  render(<Scoreboard scoreboard={scoredSnapshot().scoreboard} />);
  const plate = screen.getByLabelText("Bead Plate");
  expect(within(plate).getAllByRole("listitem")).toHaveLength(3);
});

test("renders the Big Road columns", () => {
  render(<Scoreboard scoreboard={scoredSnapshot().scoreboard} />);
  const road = screen.getByLabelText("Big Road");
  // two columns in the fixture
  expect(within(road).getAllByRole("list")).toHaveLength(2);
});

test("renders all three derived roads by name", () => {
  render(<Scoreboard scoreboard={scoredSnapshot().scoreboard} />);
  expect(screen.getByLabelText("Big Eye Boy")).toBeInTheDocument();
  expect(screen.getByLabelText("Small Road")).toBeInTheDocument();
  expect(screen.getByLabelText("Cockroach Pig")).toBeInTheDocument();
});

test("renders empty roads without crashing", () => {
  render(<Scoreboard scoreboard={bettingSnapshot().scoreboard} />);
  expect(screen.getByLabelText("Bead Plate")).toBeInTheDocument();
});
```

- [ ] **Step 2: Run it — verify it fails**

Run: `cd /home/sabien/Dev/personal/baccarat-simulator && npm --workspace web test -- Scoreboard 2>&1 | tail -12`
Expected: FAIL — cannot find `./Scoreboard`.

- [ ] **Step 3: Implement Scoreboard**

Create `web/src/components/Scoreboard.tsx`:
```tsx
import type {
  ScoreboardSnapshot,
  BeadCell,
  BigRoadCell,
  DerivedRoad,
  Mark,
} from "../engine/types";

function beadLabel(cell: BeadCell): string {
  const base =
    cell.outcome === "PlayerWin" ? "P" : cell.outcome === "BankerWin" ? "B" : "T";
  const pairs = `${cell.player_pair ? "ᴾ" : ""}${cell.banker_pair ? "ᴮ" : ""}`;
  return base + pairs;
}

function bigRoadLabel(cell: BigRoadCell): string {
  const base = cell.side === "Player" ? "P" : "B";
  return cell.ties > 0 ? `${base}/${cell.ties}` : base;
}

function DerivedRoadView({ label, road }: { label: string; road: DerivedRoad }) {
  return (
    <div aria-label={label}>
      <h4>{label}</h4>
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
  );
}

export function Scoreboard({ scoreboard }: { scoreboard: ScoreboardSnapshot }) {
  return (
    <section aria-label="Scoreboard">
      <div aria-label="Bead Plate">
        <h4>Bead Plate</h4>
        <ul>
          {scoreboard.bead_plate.cells.map((cell, i) => (
            <li key={i}>{beadLabel(cell)}</li>
          ))}
        </ul>
      </div>

      <div aria-label="Big Road">
        <h4>Big Road</h4>
        {scoreboard.big_road.columns.map((col, ci) => (
          <ul key={ci}>
            {col.map((cell, ri) => (
              <li key={ri}>{bigRoadLabel(cell)}</li>
            ))}
          </ul>
        ))}
      </div>

      <DerivedRoadView label="Big Eye Boy" road={scoreboard.big_eye_boy} />
      <DerivedRoadView label="Small Road" road={scoreboard.small_road} />
      <DerivedRoadView label="Cockroach Pig" road={scoreboard.cockroach_pig} />
    </section>
  );
}
```

- [ ] **Step 4: Run it — verify it passes**

Run: `cd /home/sabien/Dev/personal/baccarat-simulator && npm --workspace web test -- Scoreboard 2>&1 | tail -12`
Expected: PASS (4 tests). Note: the "Big Road renders 2 lists" test relies on the Big Road's two columns each being a `<ul>`; the derived roads also use `<ul>` but are inside their own labelled regions, so `within(road)` scopes correctly.

- [ ] **Step 5: Commit**

```bash
cd /home/sabien/Dev/personal/baccarat-simulator
git add web/src/components/Scoreboard.tsx web/src/components/Scoreboard.test.tsx
git commit -m "feat(web): Scoreboard component rendering all five roads

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 8: App composition + real session wiring

Wire the store (real adapter session) to the components and prove a full round plays in the browser build.

**Files:**
- Create: `web/src/store/useGameStore.ts`
- Modify: `web/src/App.tsx`, `web/src/App.test.tsx`

- [ ] **Step 1: Create the app-wide store hook (real session)**

Create `web/src/store/useGameStore.ts`:
```ts
import { useStore } from "zustand";
import { createGameStore, type GameState } from "./gameStore";
import { createSession } from "../engine/adapter";
import type { SessionConfig } from "../engine/types";

const DEFAULT_CONFIG: SessionConfig = {
  starting_bankroll: 100000,
  table_min: 100,
  table_max: 10000,
  ruleset: "Commission",
  seed: Math.floor(Math.random() * 0xffffffff),
};

// One real session-backed store for the running app.
const store = createGameStore(createSession(DEFAULT_CONFIG));

export function useGameStore<T>(selector: (state: GameState) => T): T {
  return useStore(store, selector);
}
```

- [ ] **Step 2: Update the App render test to the composed layout**

Overwrite `web/src/App.test.tsx`:
```tsx
import { render, screen } from "@testing-library/react";
import { App } from "./App";

// App wires the real wasm-backed store; this verifies it mounts and shows core regions.
// @vitest-environment jsdom

test("mounts the composed table with its core regions", () => {
  render(<App />);
  expect(screen.getByRole("heading", { name: "Baccarat Simulator" })).toBeInTheDocument();
  expect(screen.getByLabelText("HUD")).toBeInTheDocument();
  expect(screen.getByLabelText("Bet rail")).toBeInTheDocument();
  expect(screen.getByLabelText("Scoreboard")).toBeInTheDocument();
  expect(screen.getByLabelText("Player hand")).toBeInTheDocument();
  expect(screen.getByLabelText("Banker hand")).toBeInTheDocument();
});
```
NOTE: `App` imports `useGameStore`, which constructs a real `createSession` (loads wasm). Under Vitest jsdom with `vite-plugin-wasm`, this import must resolve. If the wasm cannot initialize in jsdom, this single mount test may need `// @vitest-environment node` or a store-injection seam; prefer the jsdom path first (the browser is the real target). Do not delete the assertions.

- [ ] **Step 3: Run it — verify it fails**

Run: `cd /home/sabien/Dev/personal/baccarat-simulator && npm --workspace web test -- App 2>&1 | tail -15`
Expected: FAIL — `App` still renders only the `<h1>`; the labelled regions are missing.

- [ ] **Step 4: Implement the composed App**

Overwrite `web/src/App.tsx`:
```tsx
import { useGameStore } from "./store/useGameStore";
import { Hud } from "./components/Hud";
import { Hand } from "./components/Hand";
import { BetRail } from "./components/BetRail";
import { Controls } from "./components/Controls";
import { Scoreboard } from "./components/Scoreboard";

export function App() {
  const snapshot = useGameStore((s) => s.snapshot);
  const selectedChip = useGameStore((s) => s.selectedChip);
  const lastError = useGameStore((s) => s.lastError);
  const setSelectedChip = useGameStore((s) => s.setSelectedChip);
  const placeSelectedBet = useGameStore((s) => s.placeSelectedBet);
  const clearBets = useGameStore((s) => s.clearBets);
  const deal = useGameStore((s) => s.deal);
  const reveal = useGameStore((s) => s.reveal);
  const settle = useGameStore((s) => s.settle);
  const newShoe = useGameStore((s) => s.newShoe);

  return (
    <main>
      <h1>Baccarat Simulator</h1>
      <div style={{ display: "flex", gap: "1rem", alignItems: "flex-start" }}>
        <Hud snapshot={snapshot} lastError={lastError} />
        <div>
          <Hand side="Player" hand={snapshot.player} />
          <Hand side="Banker" hand={snapshot.banker} />
          <Controls
            snapshot={snapshot}
            onDeal={deal}
            onReveal={reveal}
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

- [ ] **Step 5: Run it — verify it passes**

Run: `cd /home/sabien/Dev/personal/baccarat-simulator && npm --workspace web test -- App 2>&1 | tail -15`
Expected: PASS — the composed layout mounts with all labelled regions.

- [ ] **Step 6: Full test suite + typecheck + production build**

Run:
```bash
cd /home/sabien/Dev/personal/baccarat-simulator
npm --workspace web run typecheck 2>&1 | tail -8
npm --workspace web test 2>&1 | tail -15
npm --workspace web run build 2>&1 | tail -8
```
Expected: typecheck clean; all tests pass (App, format, adapter, gameStore, Hud, Hand, BetRail, Controls, Scoreboard); `vite build` succeeds producing `web/dist/`.

- [ ] **Step 7: Manual dev-server sanity (optional but recommended)**

Run (background, then stop): `cd /home/sabien/Dev/personal/baccarat-simulator && timeout 8 npm --workspace web run dev 2>&1 | tail -6`
Expected: Vite prints a `Local: http://localhost:5173/` URL with no compile errors. (The user can open it to click through a round: select chip → Bet Player → Deal → Reveal each → Settle → watch bankroll/scoreboard update.)

- [ ] **Step 8: Commit**

```bash
cd /home/sabien/Dev/personal/baccarat-simulator
git add web/src/store/useGameStore.ts web/src/App.tsx web/src/App.test.tsx package-lock.json
git commit -m "feat(web): compose App with real wasm-backed store — full round playable

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Final verification (whole plan)

- [ ] `npm --workspace web run typecheck` clean.
- [ ] `npm --workspace web test` → all suites green (format, adapter, gameStore, Hud, Hand, BetRail, Controls, Scoreboard, App).
- [ ] `npm --workspace web run build` produces `web/dist/`.
- [ ] Engine untouched: `cd engine && cargo test` still 117 green; existing Node smoke still works.
- [ ] `git status` clean; `node_modules/`, `web/dist/`, `engine-wasm/pkg/` all git-ignored (not tracked).

After all tasks pass, use **superpowers:finishing-a-development-branch** to merge `web-foundation` to `master`, then an Opus review (boundary correctness: adapter is the sole wasm importer, money/bigint handled only at the adapter, snapshot-driven one-directional flow, no game logic in components).
