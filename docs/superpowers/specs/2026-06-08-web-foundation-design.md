# Web Foundation — Design (Web Plan 1)

**Date:** 2026-06-08
**Status:** Approved
**Parent spec:** `2026-06-07-baccarat-simulator-design.md` (§3 boundary, §6 layout, §7 testing)
**Predecessor:** `2026-06-08-wasm-boundary-design.md` (the `engine-wasm` package this consumes)

## 1. Purpose

Stand up the web front-end's foundation: a React + Vite + TypeScript app that drives the
real `engine-wasm` package through a **complete round** — place main and side bets, deal,
reveal the squeeze, settle, and watch the bankroll and all five scoreboard roads update.
The UI is **functional but minimally styled**. It proves the engine drives a real browser UI
and establishes the module boundaries (engine adapter, store, snapshot-driven components)
that the later web plans (squeeze polish, retro styling, immersion & teaching) build on.

This is the first of four sequential web plans:
1. **Web foundation (this spec)** — playable, minimal style.
2. Squeeze & card rendering — drag/hold progressive reveal + flip animations.
3. Balatro-retro styling pass — swirl felt, pixel-art cards, left HUD, juicy feedback.
4. Immersion & teaching — dealer narration, glossary hover, explain mode, other players.

## 2. Scope

In scope:
- A new `web/` package: React 18 + Vite + TypeScript.
- Repo becomes an npm workspace (`web`, `smoke`) so `web/` can depend on the built
  `engine-wasm` package by path.
- A `wasm-pack build --target bundler` build of `engine-wasm` consumed via `vite-plugin-wasm`
  + `vite-plugin-top-level-await`.
- An **engine adapter** — the single module that imports `engine-wasm` — exposing a typed,
  plain-number, throw-free session interface.
- A **Zustand store** holding the current `RoundSnapshot` plus UI-only state.
- **Snapshot-driven components**: `Hand`, `BetRail`, `Hud`, `Scoreboard`, `Controls`, and an
  `App` that composes them.
- **Tests** (Vitest + React Testing Library): component/interaction tests against mocked
  snapshot fixtures, plus one integration test that plays a real round through the adapter.

Out of scope (later web plans): retro/Balatro styling, drag-to-squeeze physics, card
animations, dealer narration prose, contextual glossary hover, explain-the-rule readout,
simulated other players, bankroll persistence. The data for these (events, `explain`,
glossary) already crosses the boundary and is simply not yet rendered.

## 3. Architecture

```
baccarat-simulator/
  package.json          # NEW: npm workspace root (members: web, smoke)
  engine/               # unchanged
  engine-wasm/          # unchanged; built to pkg/ via --target bundler for web
  web/                  # NEW React+Vite+TS app
    index.html
    vite.config.ts
    package.json
    tsconfig.json
    src/
      main.tsx          # React root
      App.tsx           # composes the layout
      engine/
        adapter.ts      # ONLY importer of engine-wasm; typed session facade
        types.ts        # re-exports the generated .d.ts types for app-wide use
      store/
        gameStore.ts    # Zustand store: snapshot + UI state + actions
      components/
        Hand.tsx
        BetRail.tsx
        Hud.tsx
        Scoreboard.tsx
        Controls.tsx
      test/
        fixtures.ts     # hand-written RoundSnapshot fixtures for component tests
  smoke/                # unchanged (also a workspace member)
```

### 3.1 npm workspace

Root `package.json` declares `"workspaces": ["web", "smoke"]`. `web/package.json` depends on
the engine package by path: `"engine-wasm": "file:../engine-wasm/pkg"` (same mechanism the
existing `smoke/` package uses). A root script `build:wasm` runs
`wasm-pack build engine-wasm --target bundler` so the pkg exists before `web` builds or tests
the integration path. The existing `smoke/` package keeps using its own `--target nodejs`
build; the `--target bundler` output overwrites `engine-wasm/pkg/` — that is fine because
`pkg/` is git-ignored and regenerated on demand. (Open item 7.1 covers keeping both targets.)

### 3.2 Engine adapter (`web/src/engine/adapter.ts`)

The boundary seam. The ONLY module that imports `engine-wasm`. Responsibilities:
- Initialize the wasm module (the bundler target exposes the `WasmSession` class and
  `glossary()` directly; with `vite-plugin-wasm` the import is a normal ESM import).
- Expose `createSession(config: SessionConfig): GameSession`, a plain object whose methods
  wrap `WasmSession`:
  ```ts
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
  export type CommandResult =
    | { ok: true; snapshot: RoundSnapshot }
    | { ok: false; error: CommandError };
  ```
- Convert money at this seam: the app passes `amountCents: number`; the adapter converts to
  `BigInt` for `WasmSession.place_bet` (the only `bigint` boundary param). All other money
  (`bankroll`, payouts) already crosses as `number`.
- Convert thrown errors to values: each command is wrapped in `try/catch`; a thrown
  `CommandError` (the serialized JS object) becomes `{ ok: false, error }`. No exceptions
  escape the adapter, so the store/components never deal with `try/catch`.
- Also re-export `glossary()` (typed `GlossaryEntry[]`) for later plans; foundation does not
  render it but the adapter is its home.

This makes the adapter the one mock point: component tests never import wasm.

### 3.3 Store (`web/src/store/gameStore.ts`)

A Zustand store. State:
- `snapshot: RoundSnapshot` — the source of truth, replaced wholesale after every command.
- `selectedChip: number` — UI-only, the active chip denomination in cents.
- `lastError: CommandError | null` — the most recent rejected command, for a minimal inline
  message (cleared on the next successful command).

Actions wrap the adapter session and replace `snapshot` (or set `lastError`):
`placeSelectedBet(kind)`, `clearBets()`, `deal()`, `peek(side,i)`, `reveal(side,i)`,
`settle()`, `newShoe()`, `setSelectedChip(cents)`. The store is created with an injected
`GameSession` so tests can supply a fake; production wires the real adapter session.

Chip denominations for v1: `[2500, 10000, 50000, 100000]` cents (= $25 / $100 / $500 / $1k),
matching the original design's chip set.

### 3.4 Components (snapshot-driven, presentational)

All components read from the store (or props in tests) and render the snapshot. No game logic.

- **`Hud`** — bankroll (cents → `$` display), table min/max, current `phase`, and, when
  present, `outcome` and a list of `payouts` (each bet + net). Shows `lastError` text if set.
- **`Hand`** (`side: "Player" | "Banker"`, `hand: HandView`) — renders each `CardView`:
  `FaceDown` → a back placeholder; `Peeked` → shows the suit sliver from `Pip`; `FaceUp` →
  rank + suit. Shows `hand.total` when not `null`.
- **`BetRail`** — chip selector (the four denominations; highlights `selectedChip`); the main
  spots `Player` / `Tie` / `Banker` (`BetKind.Main(BetSpot)`); side-bet spots `PlayerPair`,
  `BankerPair`, `Dragon7`, `Panda8`, `DragonBonus(Player|Banker)`, `Tiger` (the rest of the
  `SideBet` family may be listed but v1 wires this representative set). Clicking a spot calls
  `placeSelectedBet`. Lists currently staged `bets` with amounts; a `Clear` button. Spots are
  disabled when `phase !== "Betting"`.
- **`Controls`** — phase-aware buttons: `Deal` (enabled in `Betting` with ≥1 bet), `Reveal`
  for each still-hidden card (foundation reveals via simple buttons; drag is Plan 2), `Settle`
  (enabled in `Dealing`), `New Shoe`. Disabled states derive from `phase` and the hands.
- **`Scoreboard`** — renders `ScoreboardSnapshot`: the Bead Plate (`cells`), the Big Road
  (`columns` of `BigRoadCell`), and the three derived roads (`big_eye_boy`, `small_road`,
  `cockroach_pig`) as grids of colored marks. Minimal CSS: colored dots/letters, no pixel art.
- **`App`** — composes `Hud`, the two `Hand`s (center), `Controls`, `BetRail`, `Scoreboard`
  in a plain fl/grid layout approximating the final spatial arrangement (HUD left, hands
  center, rail bottom, scoreboard right) but unstyled.

## 4. Data flow

```
user event → store action → adapter command (WasmSession) → RoundSnapshot
           → store replaces snapshot → React re-renders components
```

Strictly one-directional. The snapshot is the only game state in the UI; commands are the
only way to change it; rejected commands surface as `lastError` without mutating the snapshot
(the engine guarantees no state change on `Err`).

## 5. Build & tooling

- `vite.config.ts`: React plugin + `vite-plugin-wasm` + `vite-plugin-top-level-await`.
- Scripts (web/package.json): `dev` (vite), `build` (`tsc && vite build`), `test` (vitest),
  `typecheck` (`tsc --noEmit`). Root script `build:wasm` runs
  `wasm-pack build engine-wasm --target bundler`.
- TypeScript strict mode on, consistent with the smoke project.

## 6. Testing strategy

- **Component/interaction tests (mocked snapshots):** Vitest + React Testing Library. Each
  component is rendered against hand-written `RoundSnapshot` fixtures from `test/fixtures.ts`
  (a Betting-phase snapshot, a mid-Dealing snapshot with a peeked card, a Settled snapshot
  with an outcome + payouts, and a snapshot whose scoreboard has a few rounds of history).
  Assert: bet spots place the selected chip and disable off-phase; `Hand` renders the three
  `CardView` states and hides `total` until face-up; `Hud` formats money and shows payouts;
  `Scoreboard` renders the right number of bead cells and Big Road columns; `Controls` enable/
  disable by phase. The store is tested with a **fake `GameSession`** to assert action →
  snapshot-replacement and error → `lastError` without wasm.
- **Integration test (real adapter):** one test imports the real adapter, creates a session,
  and plays a full round (place bet → deal → settle), asserting the final snapshot's
  `phase === "Settled"` and that `outcome`/`payouts` are present. Mirrors the existing Node
  smoke test but through the web adapter, proving the bundler-target wiring. Runs in the
  Vitest environment that can load the wasm (node-based); if the bundler target cannot load
  under Vitest, this single test may instead be a thin script — but the goal is to exercise
  the adapter, not the components.
- Existing engine (117) and wasm-bindgen (4) tests and the Node smoke remain untouched and green.

## 7. Open items

- **7.1 Two wasm targets share `pkg/`.** `smoke/` uses `--target nodejs`; `web/` needs
  `--target bundler`. Both write `engine-wasm/pkg/`. For v1 they coexist by rebuilding the
  needed target on demand (pkg/ is git-ignored). If this becomes friction, a later change can
  output to separate dirs (`pkg-node/`, `pkg-bundler/`); deferred until it actually hurts.
- **7.2 Vitest + wasm loading.** The real-adapter integration test depends on Vitest being
  able to load the bundler-target wasm. The implementation plan will pin the exact Vite/Vitest
  config; if loading the bundler target in Vitest proves troublesome, fall back to the
  `--target nodejs` pkg for that one integration test (the component tests are wasm-free
  regardless).
- **7.3 Asset placeholders.** Cards are CSS-drawn rank+suit; no pixel art or bitmap font yet.
  Real assets arrive in the styling pass (web Plan 3).
- **7.4 Side-bet coverage in the rail.** Foundation wires a representative set of spots; the
  full `SideBet` family (BigTiger, SmallTiger, TigerTie, TigerPair) can be added in the
  styling/immersion plans without engine changes.
