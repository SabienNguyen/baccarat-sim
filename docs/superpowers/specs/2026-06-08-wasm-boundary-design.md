# WASM Boundary & Glossary — Design (Plan 5)

**Date:** 2026-06-08
**Status:** Approved
**Parent spec:** `2026-06-07-baccarat-simulator-design.md` (§2 boundary, §5 glossary)
**Predecessor:** `2026-06-08-game-session-design.md` (the `Session` this exposes)

## 1. Purpose

Expose the pure-Rust engine `Session` to TypeScript across a wasm-bindgen boundary, with
typed, serializable snapshots, so the web (Vite) and CLI (Ink) front-ends import one shared
engine. Also ship the engine-side **glossary** term data so both front-ends teach identical
terminology. This is the last engine-side plan before the front-ends.

## 2. Scope

In scope:
- Convert the repo to a Cargo **workspace**: `engine` (pure rlib) + `engine-wasm` (cdylib).
- Add `serde` derives to the engine's public snapshot/command/data types (unconditional).
- Add **tsify** + **wasm-bindgen** ABI derives behind an engine `wasm` feature so native
  builds stay wasm-free.
- A new engine `glossary` module: curated term data.
- `engine-wasm`: a `WasmSession` wrapper mirroring the session commands, plus a `glossary()`
  export. Typed JS in/out via tsify; `CommandError` surfaces as a thrown JS value.
- Verification: `wasm-bindgen-test` (run with `wasm-pack test --node`) for binding logic,
  plus a minimal Node/TypeScript smoke project consuming the built package.

Out of scope (front-end plans): the Vite web app, the Ink CLI, any `--target web`/`bundler`
build wiring (Plan 5 builds the `nodejs` target for its smoke test; the web plan configures
its own target), rendering, narration prose, simulated other players.

## 3. Architecture

```
baccarat-simulator/
  Cargo.toml          # [workspace] members = ["engine", "engine-wasm"]
  engine/             # pure rlib; serde (default) + wasm-gated tsify derives; glossary module
  engine-wasm/        # cdylib; #[wasm_bindgen] WasmSession + glossary()
  smoke/              # tiny npm project: TS/Node smoke test of the built pkg
```

### 3.1 Engine dependency & feature plan

`engine/Cargo.toml`:
- `serde = { version = "1", features = ["derive"] }` — **default** dependency. All public
  data types derive `Serialize` + `Deserialize` unconditionally (lightweight; also enables a
  native serde round-trip test).
- `tsify-next` and `wasm-bindgen` — **optional**, enabled by a new `wasm` feature:
  `[features] wasm = ["dep:tsify-next", "dep:wasm-bindgen"]`.
- Public types get `#[derive(Serialize, Deserialize)]` always, and the tsify ABI derives only
  under the feature:

```rust
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "wasm", derive(tsify_next::Tsify))]
#[cfg_attr(feature = "wasm", tsify(into_wasm_abi, from_wasm_abi))]
pub struct RoundSnapshot { /* ... */ }
```

Result: `cargo test` in `engine` (default features) compiles exactly as today — no
wasm-bindgen, no tsify — keeping native tests fast and the engine logically pure. `engine-wasm`
turns the feature on.

Types needing these derives (the boundary surface): `SessionConfig`, `BetKind`, `PlacedBet`,
`BetPayout`, `Pip`, `CardView`, `HandView`, `PhaseTag`, `Event`, `RoundSnapshot`,
`CommandError`, and the types they embed — `card::{Card, Rank, Suit}`,
`round::Outcome`, `scoreboard::{Side, BeadCell, BeadPlate, BigRoadCell, BigRoad, Mark, DerivedRoad, ScoreboardSnapshot}`,
`settle::{BetSpot, Ruleset}`, `sidebets::{SideBet, BetSide}`, and the new `GlossaryEntry`.

### 3.2 Glossary module (`engine/src/glossary.rs`)

```rust
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "wasm", derive(tsify_next::Tsify))]
#[cfg_attr(feature = "wasm", tsify(into_wasm_abi))]
pub struct GlossaryEntry {
    pub term: String,    // canonical key, e.g. "monkey"
    pub label: String,   // display name, e.g. "Monkey"
    pub short: String,   // one-line gloss for hover
    pub long: String,    // full explanation for the teaching panel
}

pub fn glossary() -> Vec<GlossaryEntry> { /* curated static list */ }
```

Curated v1 terms (~20): player, banker, tie, natural, monkey, pair, commission, ez-baccarat,
dragon-7, panda-8, dragon-bonus, tiger, big-tiger, small-tiger, tiger-pair, squeeze, shoe,
bead-plate, big-road, big-eye-boy, small-road, cockroach-pig. Pure data; no logic. The `term`
keys are stable so front-ends can map `Event` tags (e.g. `Monkey`) to a glossary entry.

### 3.3 `engine-wasm` binding

`engine-wasm/Cargo.toml`: `crate-type = ["cdylib"]`; deps `baccarat-engine` (path,
`features = ["wasm"]`), `wasm-bindgen`, `serde-wasm-bindgen`, `console_error_panic_hook`.

A thin wrapper holds a `Session` and mirrors its commands. Because the engine types are
tsify `into_wasm_abi`/`from_wasm_abi`, methods take and return them directly — wasm-bindgen
marshals to/from typed JS with no hand-written serde calls:

```rust
#[wasm_bindgen]
pub struct WasmSession {
    inner: baccarat_engine::session::Session,
}

#[wasm_bindgen]
impl WasmSession {
    #[wasm_bindgen(constructor)]
    pub fn new(config: SessionConfig) -> WasmSession { /* set panic hook; build Session */ }

    pub fn snapshot(&self) -> RoundSnapshot { /* ... */ }
    pub fn place_bet(&mut self, kind: BetKind, amount: i64) -> Result<RoundSnapshot, JsValue>;
    pub fn clear_bets(&mut self) -> Result<RoundSnapshot, JsValue>;
    pub fn deal_round(&mut self) -> Result<RoundSnapshot, JsValue>;
    pub fn peek(&mut self, hand: Side, index: usize) -> Result<RoundSnapshot, JsValue>;
    pub fn reveal(&mut self, hand: Side, index: usize) -> Result<RoundSnapshot, JsValue>;
    pub fn settle(&mut self) -> Result<RoundSnapshot, JsValue>;
    pub fn new_shoe(&mut self) -> Result<RoundSnapshot, JsValue>;
}

#[wasm_bindgen]
pub fn glossary() -> Vec<GlossaryEntry> { baccarat_engine::glossary::glossary() }
```

**Error mapping:** the engine returns `Result<RoundSnapshot, CommandError>`. The wrapper maps
`Err(CommandError)` into a thrown JS value via `serde_wasm_bindgen::to_value(&err)` (so the
front-end `catch`es a typed object). `CommandError` also derives tsify so its TypeScript shape
is generated. (Returning `Result<RoundSnapshot, JsValue>` keeps the throw semantics; the value
thrown is the serialized `CommandError`.)

`i64` crosses the boundary as JS `BigInt` under wasm-bindgen. The smoke test and front-ends use
`BigInt` for cents; this is acceptable and documented (alternatively a later refactor could move
to `f64` cents, but i64 is kept for engine integer-money integrity).

## 4. Data flow

Front-end → `new WasmSession(config)` → typed command calls → typed `RoundSnapshot` (or a
thrown `CommandError` to `catch`). `glossary()` is called once at startup. No game logic in
the front-end; the wrapper is pure marshaling over the existing `Session`.

## 5. Build & packaging

- Workspace `cargo build` / `cargo test` build the native engine as today.
- `engine-wasm` builds with `wasm-pack build --target nodejs` into `engine-wasm/pkg`, producing
  the `.wasm`, JS glue, and the tsify-generated `.d.ts`.
- The web front-end plan will add the appropriate `--target web`/`bundler` build; the `.d.ts`
  is target-independent so types are shared.

## 6. Testing strategy

- **Engine (native):** a serde round-trip test — serialize a representative `RoundSnapshot`
  (and a `CommandError`) to JSON and back with `serde_json`, asserting equality. Guards the
  unconditional serde derives without any wasm toolchain. Existing 100+ tests remain green.
- **engine-wasm binding (`wasm-bindgen-test`, `wasm-pack test --node`):** construct a
  `WasmSession`, play a full round (place_bet → deal_round → reveal → settle), and assert the
  returned snapshots' shape/fields; assert a wrong-phase command throws; assert `glossary()`
  returns a non-empty list including the `monkey` term.
- **Node/TS smoke (`smoke/`):** a minimal npm project (package.json + tsconfig + one script)
  that imports the `--target nodejs` package, runs a scripted round, asserts the snapshot is
  typed and correct (e.g. `snapshot.phase === "Settled"`), and that `glossary()` is typed and
  non-empty. Run via `node` (compiled TS) or `tsx`. Proves the generated `.d.ts` is usable.

## 7. Open items

- Exact `tsify-next` / `wasm-bindgen` / `serde-wasm-bindgen` version pins — fixed in the
  implementation plan against current releases.
- Whether `Deserialize` is needed on output-only types — the plan derives both `Serialize`
  and `Deserialize` uniformly for simplicity and to enable the native round-trip test.
- `i64` ↔ `BigInt` ergonomics for front-ends — documented; revisit only if a front-end finds
  it painful.
