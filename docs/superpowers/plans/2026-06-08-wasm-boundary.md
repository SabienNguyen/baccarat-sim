# WASM Boundary & Glossary Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expose the pure-Rust `Session` to TypeScript across a wasm-bindgen boundary with typed, serializable snapshots, and ship an engine-side glossary, so the future web (Vite) and CLI (Ink) front-ends import one shared engine.

**Architecture:** Convert the repo to a Cargo workspace with the existing pure `engine` (rlib) plus a new `engine-wasm` (cdylib). The engine's public types get `serde` derives unconditionally (native round-trip tested) and `tsify` + `wasm-bindgen` ABI derives behind an opt-in `wasm` feature, so native `cargo test` stays wasm-free. `engine-wasm` is a thin `WasmSession` marshaling wrapper over `Session` plus a `glossary()` export. Verified by `wasm-bindgen-test` (run under `wasm-pack test --node`) and a minimal Node/TypeScript smoke project consuming the built `--target nodejs` package.

**Tech Stack:** Rust 2021, Cargo workspace, serde 1, tsify-next 0.5, wasm-bindgen 0.2, serde-wasm-bindgen 0.6, console_error_panic_hook 0.1, wasm-bindgen-test 0.3, wasm-pack, Node 25 + tsx.

**Spec:** `docs/superpowers/specs/2026-06-08-wasm-boundary-design.md`

---

## Conventions & gotchas (read once before starting)

- **Absolute paths in shells.** Subagents sometimes leave the cwd at the repo root or in `engine/`. Always `cd /home/sabien/Dev/personal/baccarat-simulator` (or the relevant absolute subdir) at the start of a shell step.
- **Two i64 marshaling paths, by design:**
  - A **direct** `#[wasm_bindgen]` method param typed `i64` (e.g. `place_bet(amount: i64)`) crosses to JS as a **`bigint`**. The smoke test passes `100n`.
  - An `i64` **field inside** a tsify/serde type (e.g. `RoundSnapshot.bankroll`) crosses to JS as a **`number`** (serde-wasm-bindgen default; lossless for values < 2^53, which covers all realistic cent amounts). The smoke test reads `snapshot.bankroll` as a plain number.
  - This asymmetry is expected. Do not try to "fix" it; just honor it in TS.
- **`Vec<TsifyType>` returns are fragile across wasm-bindgen.** `glossary()` therefore returns a newtype wrapper `Glossary(Vec<GlossaryEntry>)` (tsify `into_wasm_abi`), which still emits a clean `GlossaryEntry[]`-shaped `.d.ts`.
- **Warning-clean.** Engine code must stay clean under `cargo clippy --all-targets -- -D warnings`. Don't introduce a public item before the task that first uses it.
- **serde enum shape.** Engine enums use serde's default **externally-tagged** representation. So `Outcome::PlayerWin` serializes as the string `"PlayerWin"`, and `Event::Natural { side, total }` serializes as `{ "Natural": { "side": "Player", "total": 8 } }`. The TS `.d.ts` tsify generates mirrors this. Tests below assume this shape.

---

## Task 0: Toolchain setup (one-time, environment)

**No code. Installs the wasm toolchain the later tasks need.** These are environment mutations; run them once and verify.

- [ ] **Step 1: Add the wasm32 target**

Run: `rustup target add wasm32-unknown-unknown`
Expected: `info: installing component 'rust-std' for 'wasm32-unknown-unknown'` (or "is up to date").

- [ ] **Step 2: Install wasm-pack**

Run: `cargo install wasm-pack --locked`
Expected: builds and installs; ends with `Installed package 'wasm-pack vX.Y.Z'`. (Takes a few minutes.)

- [ ] **Step 3: Verify the toolchain**

Run:
```bash
rustup target list --installed | grep wasm32-unknown-unknown
wasm-pack --version
node --version
```
Expected: the target is listed, `wasm-pack 0.x.y` prints, `v25.x` prints. No commit (nothing changed in-repo).

---

## Task 1: Workspace conversion + unconditional serde derives + native round-trip test

Converts the repo to a Cargo workspace and adds `serde` `Serialize`/`Deserialize` to every public boundary type, guarded by a native JSON round-trip test. No wasm yet — this task must pass with a plain `cargo test`.

**Files:**
- Create: `Cargo.toml` (workspace root)
- Modify: `engine/Cargo.toml`
- Modify: `engine/src/card.rs` (derives on `Suit`, `Rank`, `Card`)
- Modify: `engine/src/round.rs` (derive on `Outcome`)
- Modify: `engine/src/settle.rs` (derives on `BetSpot`, `Ruleset`)
- Modify: `engine/src/sidebets.rs` (derives on `BetSide`, `SideBet`)
- Modify: `engine/src/scoreboard.rs` (derives on `Side`, `BeadCell`, `BeadPlate`, `BigRoadCell`, `BigRoad`, `Mark`, `DerivedRoad`, `ScoreboardSnapshot`)
- Modify: `engine/src/session.rs` (derives on `SessionConfig`, `BetKind`, `PlacedBet`, `BetPayout`, `Pip`, `CardView`, `HandView`, `PhaseTag`, `Event`, `RoundSnapshot`, `CommandError`)
- Test: `engine/src/session.rs` (new `#[cfg(test)]` round-trip test)

- [ ] **Step 1: Create the workspace root `Cargo.toml`**

Create `Cargo.toml`:
```toml
[workspace]
resolver = "2"
members = ["engine", "engine-wasm"]
```
(`engine-wasm` does not exist yet; it is created in Task 4. Cargo tolerates a not-yet-present member only if a path exists, so until Task 4 build/test with `-p baccarat-engine` or from inside `engine/`. To avoid that friction, temporarily list only `["engine"]` now and add `"engine-wasm"` in Task 4 Step 2.)

Use this for now:
```toml
[workspace]
resolver = "2"
members = ["engine"]
```

- [ ] **Step 2: Add serde to `engine/Cargo.toml`**

Modify `engine/Cargo.toml` to:
```toml
[package]
name = "baccarat-engine"
version = "0.1.0"
edition = "2021"

[dependencies]
rand = "0.8"
serde = { version = "1", features = ["derive"] }

[dev-dependencies]
serde_json = "1"
```

- [ ] **Step 3: Write the failing round-trip test**

Add to the bottom of `engine/src/session.rs`, inside its existing `#[cfg(test)] mod tests { ... }` block (or a new one if none — check the file; it has session tests already, add within that module):
```rust
    #[test]
    fn round_snapshot_serde_round_trips() {
        // Play a full round so the snapshot is richly populated.
        let mut session = Session::new(SessionConfig {
            starting_bankroll: 100_000,
            table_min: 100,
            table_max: 10_000,
            ruleset: Ruleset::Commission,
            seed: 42,
        });
        session
            .place_bet(BetKind::Main(BetSpot::Player), 500)
            .unwrap();
        session.deal_round().unwrap();
        let snapshot = session.settle().unwrap();

        let json = serde_json::to_string(&snapshot).expect("serialize");
        let back: RoundSnapshot = serde_json::from_str(&json).expect("deserialize");
        assert_eq!(snapshot, back);
    }

    #[test]
    fn command_error_serde_round_trips() {
        let err = CommandError::WrongPhase {
            expected: PhaseTag::Betting,
            found: PhaseTag::Dealing,
        };
        let json = serde_json::to_string(&err).expect("serialize");
        let back: CommandError = serde_json::from_str(&json).expect("deserialize");
        assert_eq!(err, back);
    }
```

- [ ] **Step 4: Run the test to verify it fails to compile**

Run: `cd /home/sabien/Dev/personal/baccarat-simulator/engine && cargo test round_snapshot_serde_round_trips 2>&1 | head -30`
Expected: FAIL — compile error, `the trait bound RoundSnapshot: Serialize is not satisfied` (derives not added yet).

- [ ] **Step 5: Add serde derives to `card.rs`**

In `engine/src/card.rs`, add `Serialize, Deserialize` to each derive and a `use` import at the top.
Add near the top of the file:
```rust
use serde::{Deserialize, Serialize};
```
Change each of the three derive lines from:
```rust
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
```
to:
```rust
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
```
(applies to `Suit`, `Rank`, `Card`).

- [ ] **Step 6: Add serde derives to `round.rs`**

In `engine/src/round.rs`, add at the top:
```rust
use serde::{Deserialize, Serialize};
```
Change the `Outcome` derive line to include `Serialize, Deserialize`:
```rust
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum Outcome {
```
(Leave `RoundResult` alone — it embeds `Hand`, is internal, and is not on the boundary surface.)

- [ ] **Step 7: Add serde derives to `settle.rs`**

In `engine/src/settle.rs`, add at the top:
```rust
use serde::{Deserialize, Serialize};
```
Add `Serialize, Deserialize` to the derive lines for `BetSpot` and `Ruleset`:
```rust
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum BetSpot {
```
```rust
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum Ruleset {
```
(Leave the internal `Bet` struct alone — not on the boundary surface.)

- [ ] **Step 8: Add serde derives to `sidebets.rs`**

In `engine/src/sidebets.rs`, add at the top:
```rust
use serde::{Deserialize, Serialize};
```
Add `Serialize, Deserialize` to the derive lines for `BetSide` and `SideBet`:
```rust
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum BetSide {
```
```rust
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum SideBet {
```

- [ ] **Step 9: Add serde derives to `scoreboard.rs`**

In `engine/src/scoreboard.rs`, add at the top:
```rust
use serde::{Deserialize, Serialize};
```
Add `Serialize, Deserialize` to the derive lines for these public types: `Side`, `BeadCell`, `BeadPlate`, `BigRoadCell`, `BigRoad`, `Mark`, `DerivedRoad`, `ScoreboardSnapshot`. For example:
```rust
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum Side {
```
…and likewise for each of the others (keep each type's existing derive set, just append `, Serialize, Deserialize`).
(Leave the internal `RoundRecord` alone — not on the boundary surface.)

- [ ] **Step 10: Add serde derives to `session.rs`**

In `engine/src/session.rs`, add near the existing `use` block at the top:
```rust
use serde::{Deserialize, Serialize};
```
`SessionConfig` currently has **no** derive line — add one above it:
```rust
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct SessionConfig {
```
Append `, Serialize, Deserialize` to the existing derive lines for: `BetKind`, `PlacedBet`, `BetPayout`, `Pip`, `CardView`, `HandView`, `PhaseTag`, `Event`, `RoundSnapshot`, `CommandError`. For example:
```rust
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum Event {
```
(Do **not** touch the private `CardStatus`, `RevealState`, `Phase`, or `Session` — they are not serialized.)

- [ ] **Step 11: Run the round-trip tests — verify they pass**

Run: `cd /home/sabien/Dev/personal/baccarat-simulator/engine && cargo test 2>&1 | tail -20`
Expected: PASS — all existing tests plus `round_snapshot_serde_round_trips` and `command_error_serde_round_trips` green (116 tests).

- [ ] **Step 12: Clippy clean**

Run: `cd /home/sabien/Dev/personal/baccarat-simulator/engine && cargo clippy --all-targets -- -D warnings 2>&1 | tail -10`
Expected: no warnings, finishes clean.

- [ ] **Step 13: Commit**

```bash
cd /home/sabien/Dev/personal/baccarat-simulator
git add Cargo.toml engine/Cargo.toml engine/src
git commit -m "feat: cargo workspace + unconditional serde on engine boundary types

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: Engine `wasm` feature + gated tsify/wasm-bindgen ABI derives

Adds the opt-in `wasm` feature and the feature-gated tsify derives to every boundary type. Native `cargo test` (default features) is unchanged; the new surface is validated by `cargo check --features wasm`.

**Files:**
- Modify: `engine/Cargo.toml`
- Modify: the same seven source files from Task 1 (add two `#[cfg_attr(feature = "wasm", ...)]` lines above each boundary type)

- [ ] **Step 1: Add the optional deps and `wasm` feature to `engine/Cargo.toml`**

Modify `engine/Cargo.toml` to:
```toml
[package]
name = "baccarat-engine"
version = "0.1.0"
edition = "2021"

[features]
wasm = ["dep:tsify-next", "dep:wasm-bindgen"]

[dependencies]
rand = "0.8"
serde = { version = "1", features = ["derive"] }
tsify-next = { version = "0.5", optional = true }
wasm-bindgen = { version = "0.2", optional = true }

[dev-dependencies]
serde_json = "1"
```

- [ ] **Step 2: Add gated tsify derives to every boundary type**

For **each** public boundary type in `card.rs`, `round.rs`, `settle.rs`, `sidebets.rs`, `scoreboard.rs`, and `session.rs` (the exact same types that got `Serialize, Deserialize` in Task 1), insert these two attribute lines **immediately below** the existing `#[derive(...)]` line and above the `pub struct`/`pub enum`:
```rust
#[cfg_attr(feature = "wasm", derive(tsify_next::Tsify))]
#[cfg_attr(feature = "wasm", tsify(into_wasm_abi, from_wasm_abi))]
```
Concretely, e.g. in `round.rs`:
```rust
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "wasm", derive(tsify_next::Tsify))]
#[cfg_attr(feature = "wasm", tsify(into_wasm_abi, from_wasm_abi))]
pub enum Outcome {
```
Apply uniformly to all of: `Suit`, `Rank`, `Card`, `Outcome`, `BetSpot`, `Ruleset`, `BetSide`, `SideBet`, `Side`, `BeadCell`, `BeadPlate`, `BigRoadCell`, `BigRoad`, `Mark`, `DerivedRoad`, `ScoreboardSnapshot`, `SessionConfig`, `BetKind`, `PlacedBet`, `BetPayout`, `Pip`, `CardView`, `HandView`, `PhaseTag`, `Event`, `RoundSnapshot`, `CommandError`.

- [ ] **Step 3: Native default build still clean**

Run: `cd /home/sabien/Dev/personal/baccarat-simulator/engine && cargo test 2>&1 | tail -5`
Expected: PASS — 116 tests, identical to Task 1 (default features compile with no tsify/wasm-bindgen).

- [ ] **Step 4: The `wasm` feature compiles (native check)**

Run: `cd /home/sabien/Dev/personal/baccarat-simulator/engine && cargo check --features wasm 2>&1 | tail -15`
Expected: compiles clean. (wasm-bindgen and tsify build on the native target; the ABI glue only activates under a real wasm build, but the code compiles here. This proves the derives are well-formed.)

- [ ] **Step 5: Clippy clean (both feature sets)**

Run:
```bash
cd /home/sabien/Dev/personal/baccarat-simulator/engine
cargo clippy --all-targets -- -D warnings 2>&1 | tail -5
cargo clippy --all-targets --features wasm -- -D warnings 2>&1 | tail -5
```
Expected: both finish with no warnings.

- [ ] **Step 6: Commit**

```bash
cd /home/sabien/Dev/personal/baccarat-simulator
git add engine/Cargo.toml engine/src
git commit -m "feat: wasm feature with gated tsify ABI derives on boundary types

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: Glossary module

Adds `engine/src/glossary.rs` with `GlossaryEntry` and a curated `glossary()` returning ~20 stable-keyed terms. Native test guards content; serde + gated tsify derives match the rest of the boundary.

**Files:**
- Create: `engine/src/glossary.rs`
- Modify: `engine/src/lib.rs` (add `pub mod glossary;`)
- Test: `engine/src/glossary.rs` (inline `#[cfg(test)]`)

- [ ] **Step 1: Write the failing test**

Create `engine/src/glossary.rs` with only the type, a stub, and the tests so it fails:
```rust
//! Curated baccarat terminology shared by all front-ends.

use serde::{Deserialize, Serialize};

/// One glossary term. `term` is a stable canonical key (e.g. "monkey") that
/// front-ends map `Event` tags and UI highlights to; the other fields are display copy.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "wasm", derive(tsify_next::Tsify))]
#[cfg_attr(feature = "wasm", tsify(into_wasm_abi))]
pub struct GlossaryEntry {
    pub term: String,
    pub label: String,
    pub short: String,
    pub long: String,
}

/// The curated v1 glossary. Pure data, no logic.
pub fn glossary() -> Vec<GlossaryEntry> {
    Vec::new()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashSet;

    #[test]
    fn glossary_is_populated_and_keyed() {
        let entries = glossary();
        assert!(entries.len() >= 20, "expected ~20 terms, got {}", entries.len());

        // Keys are unique.
        let keys: HashSet<&str> = entries.iter().map(|e| e.term.as_str()).collect();
        assert_eq!(keys.len(), entries.len(), "duplicate term keys");

        // Every entry has non-empty copy.
        for e in &entries {
            assert!(!e.term.is_empty() && !e.label.is_empty());
            assert!(!e.short.is_empty() && !e.long.is_empty(), "empty copy for {}", e.term);
        }

        // A few stable keys front-ends depend on must exist.
        for required in ["monkey", "player", "banker", "natural", "big-eye-boy"] {
            assert!(keys.contains(required), "missing required term '{required}'");
        }
    }
}
```

- [ ] **Step 2: Register the module**

In `engine/src/lib.rs`, add `pub mod glossary;` to the module list (alphabetical-ish, next to the others):
```rust
pub mod glossary;
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `cd /home/sabien/Dev/personal/baccarat-simulator/engine && cargo test glossary_is_populated_and_keyed 2>&1 | tail -15`
Expected: FAIL — `expected ~20 terms, got 0`.

- [ ] **Step 4: Fill in the curated glossary**

Replace the `glossary()` body in `engine/src/glossary.rs` with the curated list. A small helper keeps it terse:
```rust
pub fn glossary() -> Vec<GlossaryEntry> {
    fn e(term: &str, label: &str, short: &str, long: &str) -> GlossaryEntry {
        GlossaryEntry {
            term: term.to_string(),
            label: label.to_string(),
            short: short.to_string(),
            long: long.to_string(),
        }
    }
    vec![
        e("player", "Player", "One of the two hands you can bet on.",
          "The Player (Punto) is one of the two hands dealt each round. Betting Player pays even money on a win."),
        e("banker", "Banker", "The other bettable hand; wins pay even money minus commission.",
          "The Banker (Banco) hand wins slightly more often, so a winning Banker bet pays even money minus a 5% commission (in commission play)."),
        e("tie", "Tie", "Both hands finish with the same total.",
          "A Tie occurs when Player and Banker reach equal totals. Player and Banker bets push; a Tie side bet typically pays 8:1."),
        e("natural", "Natural", "An 8 or 9 on the first two cards — an instant stand.",
          "A two-card total of 8 or 9 is a Natural. Both hands stand immediately and no third card is drawn; the higher natural wins."),
        e("monkey", "Monkey", "Slang for any 10, J, Q, or K — a zero-value card.",
          "A Monkey is any ten-value card (10, Jack, Queen, King). It counts as zero, so drawing one never changes a hand's total. Pure table slang players call out when hoping to land a zero."),
        e("pair", "Pair", "First two cards of a hand share the same rank.",
          "When a hand's first two cards are the same rank, that hand has a pair — the basis for the Player Pair and Banker Pair side bets, usually paying 11:1."),
        e("commission", "Commission", "The 5% fee on winning Banker bets.",
          "In traditional baccarat a winning Banker bet pays even money minus a 5% commission, offsetting the Banker's statistical edge."),
        e("ez-baccarat", "EZ Baccarat", "Commission-free variant; a 3-card Banker 7 pushes.",
          "EZ Baccarat pays winning Banker bets even money with no commission. Instead, a Banker win on a three-card total of 7 (the Dragon 7 condition) pushes the Banker bet."),
        e("dragon-7", "Dragon 7", "Side bet: Banker wins with a three-card total of 7.",
          "The Dragon 7 is an EZ Baccarat side bet that pays 40:1 when the Banker wins with exactly three cards totaling 7."),
        e("panda-8", "Panda 8", "Side bet: Player wins with a three-card total of 8.",
          "The Panda 8 is an EZ Baccarat side bet that pays 25:1 when the Player wins with exactly three cards totaling 8."),
        e("dragon-bonus", "Dragon Bonus", "Side bet on a big or natural win margin.",
          "The Dragon Bonus pays on the chosen hand winning by a large margin (up to 30:1 for a 9-point gap) or winning with a natural; a non-natural win for the other side loses."),
        e("tiger", "Tiger", "Side bet: Banker wins on a total of 6.",
          "The Tiger pays 12:1 when the Banker wins with a two-card 6 and 20:1 with a three-card 6."),
        e("big-tiger", "Big Tiger", "Side bet: Banker wins with a three-card 6.",
          "The Big Tiger pays 50:1 when the Banker wins with a three-card total of 6."),
        e("small-tiger", "Small Tiger", "Side bet: Banker wins with a two-card 6.",
          "The Small Tiger pays 22:1 when the Banker wins with a two-card total of 6."),
        e("tiger-tie", "Tiger Tie", "Side bet: the round ties on 6.",
          "The Tiger Tie pays 35:1 when the round is a Tie with both hands totaling 6."),
        e("tiger-pair", "Tiger Pair", "Side bet on either hand's first-two-card pair.",
          "The Tiger Pair pays on a pair in either hand, with bigger payouts for a double pair or twin identical pairs."),
        e("squeeze", "Squeeze", "Slowly revealing a card by its edge for suspense.",
          "The squeeze is the ritual of bending and slowly exposing a card edge-first, revealing the suit sliver before the full rank — pure drama, no effect on the result."),
        e("shoe", "Shoe", "The dealing box holding the shuffled decks.",
          "A shoe holds several shuffled decks (commonly eight) from which cards are dealt until the cut card ends the shoe."),
        e("bead-plate", "Bead Plate", "Scoreboard: one bead per round in play order.",
          "The Bead Plate records every round as a colored bead in order — red for Banker, blue for Player, green for Tie — filling top-to-bottom then left-to-right."),
        e("big-road", "Big Road", "Scoreboard: wins in columns, ties as slashes.",
          "The Big Road is the primary grid: each Player/Banker win starts or extends a column of the same color, ties mark a slash, and pairs add corner dots. The derived roads are computed from it."),
        e("big-eye-boy", "Big Eye Boy", "Derived road tracking the Big Road's regularity.",
          "The Big Eye Boy starts after the Big Road's second column and marks red for orderly repetition or blue for choppiness — a trend-of-the-trend road."),
        e("small-road", "Small Road", "Derived road skipping the column one left.",
          "The Small Road is like the Big Eye Boy but compares against the column two back, offering a coarser read of the Big Road's pattern."),
        e("cockroach-pig", "Cockroach Pig", "Derived road skipping two columns left.",
          "The Cockroach Pig (Cockroach Road) compares against the column three back — the longest-range of the three derived pattern roads."),
    ]
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd /home/sabien/Dev/personal/baccarat-simulator/engine && cargo test glossary 2>&1 | tail -10`
Expected: PASS — `glossary_is_populated_and_keyed` green.

- [ ] **Step 6: Full suite + clippy (both feature sets)**

Run:
```bash
cd /home/sabien/Dev/personal/baccarat-simulator/engine
cargo test 2>&1 | tail -5
cargo clippy --all-targets -- -D warnings 2>&1 | tail -3
cargo check --features wasm 2>&1 | tail -3
```
Expected: tests green (117 tests), clippy clean, wasm-feature check compiles.

- [ ] **Step 7: Commit**

```bash
cd /home/sabien/Dev/personal/baccarat-simulator
git add engine/src/glossary.rs engine/src/lib.rs
git commit -m "feat: curated glossary module (~22 stable-keyed terms)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4: `engine-wasm` crate — WasmSession + glossary export + first binding test

Scaffolds the cdylib, the `WasmSession` wrapper mirroring all eight session commands, the `glossary()` export (via a `Glossary` newtype), and a first `wasm-bindgen-test` that constructs a session and reads a snapshot. Run under `wasm-pack test --node`.

**Files:**
- Modify: `Cargo.toml` (add `engine-wasm` to workspace members)
- Create: `engine-wasm/Cargo.toml`
- Create: `engine-wasm/src/lib.rs`
- Modify: `.gitignore`

- [ ] **Step 1: Add `engine-wasm` to the workspace**

Modify the root `Cargo.toml`:
```toml
[workspace]
resolver = "2"
members = ["engine", "engine-wasm"]
```

- [ ] **Step 2: Create `engine-wasm/Cargo.toml`**

Create `engine-wasm/Cargo.toml`:
```toml
[package]
name = "engine-wasm"
version = "0.1.0"
edition = "2021"

[lib]
crate-type = ["cdylib", "rlib"]

[dependencies]
baccarat-engine = { path = "../engine", features = ["wasm"] }
wasm-bindgen = "0.2"
serde-wasm-bindgen = "0.6"
console_error_panic_hook = "0.1"
tsify-next = "0.5"
serde = { version = "1", features = ["derive"] }

[dev-dependencies]
wasm-bindgen-test = "0.3"
```
(`rlib` is included in `crate-type` so `wasm-bindgen-test` can also build it for the test harness; `cdylib` is what `wasm-pack build` packages.)

- [ ] **Step 3: Write the `engine-wasm/src/lib.rs` wrapper + first test**

Create `engine-wasm/src/lib.rs`:
```rust
//! TypeScript-facing wasm boundary over the pure `baccarat-engine` Session.
//!
//! Money note: a direct `i64` method param (e.g. `place_bet(amount)`) crosses to
//! JS as a `bigint`. An `i64` *field* inside a returned snapshot (e.g.
//! `RoundSnapshot.bankroll`) crosses as a JS `number` (serde-wasm-bindgen default;
//! lossless below 2^53, which covers all realistic cent amounts).

use baccarat_engine::glossary::{glossary as engine_glossary, GlossaryEntry};
use baccarat_engine::scoreboard::Side;
use baccarat_engine::session::{
    BetKind, CommandError, RoundSnapshot, Session, SessionConfig,
};
use serde::Serialize;
use tsify_next::Tsify;
use wasm_bindgen::prelude::*;

/// Newtype so `glossary()` returns a single tsify ABI type (a `GlossaryEntry[]`)
/// rather than a bare `Vec`, which wasm-bindgen marshals less reliably.
#[derive(Serialize, Tsify)]
#[tsify(into_wasm_abi)]
pub struct Glossary(pub Vec<GlossaryEntry>);

/// Map an engine `CommandError` into a thrown JS value (a typed object the
/// front-end `catch`es).
fn to_js_err(err: CommandError) -> JsValue {
    serde_wasm_bindgen::to_value(&err).unwrap_or(JsValue::NULL)
}

#[wasm_bindgen]
pub struct WasmSession {
    inner: Session,
}

#[wasm_bindgen]
impl WasmSession {
    #[wasm_bindgen(constructor)]
    pub fn new(config: SessionConfig) -> WasmSession {
        console_error_panic_hook::set_once();
        WasmSession {
            inner: Session::new(config),
        }
    }

    pub fn snapshot(&self) -> RoundSnapshot {
        self.inner.snapshot()
    }

    pub fn place_bet(&mut self, kind: BetKind, amount: i64) -> Result<RoundSnapshot, JsValue> {
        self.inner.place_bet(kind, amount).map_err(to_js_err)
    }

    pub fn clear_bets(&mut self) -> Result<RoundSnapshot, JsValue> {
        self.inner.clear_bets().map_err(to_js_err)
    }

    pub fn deal_round(&mut self) -> Result<RoundSnapshot, JsValue> {
        self.inner.deal_round().map_err(to_js_err)
    }

    pub fn peek(&mut self, hand: Side, index: usize) -> Result<RoundSnapshot, JsValue> {
        self.inner.peek(hand, index).map_err(to_js_err)
    }

    pub fn reveal(&mut self, hand: Side, index: usize) -> Result<RoundSnapshot, JsValue> {
        self.inner.reveal(hand, index).map_err(to_js_err)
    }

    pub fn settle(&mut self) -> Result<RoundSnapshot, JsValue> {
        self.inner.settle().map_err(to_js_err)
    }

    pub fn new_shoe(&mut self) -> Result<RoundSnapshot, JsValue> {
        self.inner.new_shoe().map_err(to_js_err)
    }
}

#[wasm_bindgen]
pub fn glossary() -> Glossary {
    Glossary(engine_glossary())
}

#[cfg(test)]
mod tests {
    use super::*;
    use baccarat_engine::session::PhaseTag;
    use wasm_bindgen_test::*;

    #[wasm_bindgen_test]
    fn new_session_starts_in_betting() {
        let session = WasmSession::new(SessionConfig {
            starting_bankroll: 100_000,
            table_min: 100,
            table_max: 10_000,
            ruleset: baccarat_engine::settle::Ruleset::Commission,
            seed: 7,
        });
        let snap = session.snapshot();
        assert_eq!(snap.phase, PhaseTag::Betting);
        assert_eq!(snap.bankroll, 100_000);
    }
}
```
**Before writing, verify the real signatures** of `Session::snapshot/place_bet/clear_bets/deal_round/peek/reveal/settle/new_shoe` and the import paths in `engine/src/session.rs`. If `snapshot()` returns by value it matches; if any command name or arity differs, adapt the wrapper to the actual engine API (the engine is the source of truth).

- [ ] **Step 4: Ignore build artifacts**

Append to `.gitignore`:
```
/target
engine-wasm/pkg/
smoke/node_modules/
smoke/dist/
```
(Confirm `/target` isn't already present before adding a duplicate.)

- [ ] **Step 5: Native workspace still builds**

Run: `cd /home/sabien/Dev/personal/baccarat-simulator && cargo build 2>&1 | tail -10`
Expected: builds `baccarat-engine` and `engine-wasm` for the native target (the cdylib compiles natively too). No errors.

- [ ] **Step 6: Run the first binding test under Node**

Run: `cd /home/sabien/Dev/personal/baccarat-simulator/engine-wasm && wasm-pack test --node 2>&1 | tail -25`
Expected: compiles to wasm and runs; `new_session_starts_in_betting ... ok`, `test result: ok. 1 passed`.

- [ ] **Step 7: Commit**

```bash
cd /home/sabien/Dev/personal/baccarat-simulator
git add Cargo.toml engine-wasm/Cargo.toml engine-wasm/src/lib.rs .gitignore
git commit -m "feat: engine-wasm cdylib with WasmSession wrapper + glossary export

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 5: Full wasm-bindgen-test suite

Adds binding tests that exercise a full round, the error-throw path, and the glossary export.

**Files:**
- Modify: `engine-wasm/src/lib.rs` (extend the `#[cfg(test)] mod tests`)

- [ ] **Step 1: Write the failing tests**

Add to the `#[cfg(test)] mod tests` block in `engine-wasm/src/lib.rs`:
```rust
    #[wasm_bindgen_test]
    fn full_round_reaches_settled() {
        use baccarat_engine::settle::{BetSpot, Ruleset};
        let mut session = WasmSession::new(SessionConfig {
            starting_bankroll: 100_000,
            table_min: 100,
            table_max: 10_000,
            ruleset: Ruleset::Commission,
            seed: 7,
        });
        session
            .place_bet(BetKind::Main(BetSpot::Player), 500)
            .expect("bet accepted");
        session.deal_round().expect("deal");
        let snap = session.settle().expect("settle");
        assert_eq!(snap.phase, PhaseTag::Settled);
        assert!(snap.outcome.is_some());
        assert!(snap.payouts.is_some());
    }

    #[wasm_bindgen_test]
    fn wrong_phase_command_throws() {
        let mut session = WasmSession::new(SessionConfig {
            starting_bankroll: 100_000,
            table_min: 100,
            table_max: 10_000,
            ruleset: baccarat_engine::settle::Ruleset::Commission,
            seed: 7,
        });
        // settle() before any deal is the wrong phase -> Err -> thrown JsValue.
        let result = session.settle();
        assert!(result.is_err(), "expected a thrown error for wrong-phase settle");
    }

    #[wasm_bindgen_test]
    fn glossary_export_is_nonempty_and_has_monkey() {
        let Glossary(entries) = glossary();
        assert!(entries.len() >= 20);
        assert!(entries.iter().any(|e| e.term == "monkey"));
    }
```

- [ ] **Step 2: Run the suite under Node**

Run: `cd /home/sabien/Dev/personal/baccarat-simulator/engine-wasm && wasm-pack test --node 2>&1 | tail -25`
Expected: PASS — `test result: ok. 4 passed`. (If `wrong_phase_command_throws` fails because the engine permits `settle()` pre-deal, adjust the test to a genuinely invalid command per the real `Session` state machine — e.g. `peek` before `deal_round`. The engine's actual `CommandError` cases are the source of truth.)

- [ ] **Step 3: Commit**

```bash
cd /home/sabien/Dev/personal/baccarat-simulator
git add engine-wasm/src/lib.rs
git commit -m "test: wasm-bindgen-test suite — full round, error throw, glossary

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 6: Node/TypeScript smoke project

Builds the `--target nodejs` package and proves the generated `.d.ts` is usable from real TypeScript: a scripted round plus a typed glossary read.

**Files:**
- Create: `smoke/package.json`
- Create: `smoke/tsconfig.json`
- Create: `smoke/smoke.ts`
- (Generated, git-ignored) `engine-wasm/pkg/`

- [ ] **Step 1: Build the nodejs package**

Run: `cd /home/sabien/Dev/personal/baccarat-simulator/engine-wasm && wasm-pack build --target nodejs 2>&1 | tail -15`
Expected: produces `engine-wasm/pkg/` containing `engine_wasm.js`, `engine_wasm_bg.wasm`, `engine_wasm.d.ts`, and `package.json`. Inspect `engine_wasm.d.ts` and confirm it declares `class WasmSession`, `function glossary(): Glossary`, and the `RoundSnapshot`/`SessionConfig`/etc. types.

- [ ] **Step 2: Create `smoke/package.json`**

Create `smoke/package.json`:
```json
{
  "name": "baccarat-wasm-smoke",
  "private": true,
  "type": "module",
  "scripts": {
    "smoke": "tsx smoke.ts"
  },
  "dependencies": {
    "engine-wasm": "file:../engine-wasm/pkg"
  },
  "devDependencies": {
    "tsx": "^4",
    "typescript": "^5"
  }
}
```

- [ ] **Step 3: Create `smoke/tsconfig.json`**

Create `smoke/tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ES2022",
    "moduleResolution": "bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "noEmit": true
  },
  "include": ["smoke.ts"]
}
```

- [ ] **Step 4: Write the smoke script**

Create `smoke/smoke.ts`. It uses the generated types; note the i64 marshaling rule — the `amount` arg is a `bigint` (`500n`), while `snapshot.bankroll` is a `number`:
```ts
import { WasmSession, glossary } from "engine-wasm";
import type { SessionConfig, BetKind, RoundSnapshot } from "engine-wasm";

function assert(cond: boolean, msg: string): void {
  if (!cond) {
    console.error(`SMOKE FAIL: ${msg}`);
    process.exit(1);
  }
}

const config: SessionConfig = {
  starting_bankroll: 100000,
  table_min: 100,
  table_max: 10000,
  ruleset: "Commission",
  seed: 7,
};

const session = new WasmSession(config);

const start: RoundSnapshot = session.snapshot();
assert(start.phase === "Betting", `expected Betting, got ${start.phase}`);
assert(typeof start.bankroll === "number", "bankroll should marshal as a number");

const playerBet: BetKind = { Main: "Player" };
session.place_bet(playerBet, 500n); // i64 param -> bigint
session.deal_round();
const settled: RoundSnapshot = session.settle();
assert(settled.phase === "Settled", `expected Settled, got ${settled.phase}`);
assert(settled.outcome != null, "settled snapshot should carry an outcome");
assert(settled.payouts != null, "settled snapshot should carry payouts");

const terms = glossary();
assert(Array.isArray(terms), "glossary() should be an array");
assert(terms.length >= 20, `expected >=20 terms, got ${terms.length}`);
assert(
  terms.some((t) => t.term === "monkey"),
  "glossary should contain the 'monkey' term",
);

console.log(
  `SMOKE OK: settled outcome=${settled.outcome}, bankroll=${settled.bankroll}, terms=${terms.length}`,
);
```
**Note on the `BetKind`/`ruleset` literal shapes:** these depend on the exact serde representation tsify emits. After Step 1, open `engine_wasm.d.ts` and confirm: `Ruleset` should be `"Commission" | "EzBaccarat"`, `BetSpot` should be `"Player" | "Banker" | "Tie"`, and `BetKind` should be `{ Main: BetSpot } | { Side: SideBet }`. If the generated shapes differ, adjust the literals in `smoke.ts` to match the `.d.ts` (the generated types are the source of truth).

- [ ] **Step 5: Install and run the smoke test**

Run:
```bash
cd /home/sabien/Dev/personal/baccarat-simulator/smoke
npm install 2>&1 | tail -5
npx tsc --noEmit 2>&1 | tail -20
npm run smoke 2>&1 | tail -10
```
Expected: `npm install` succeeds; `tsc --noEmit` reports **no type errors** (proves the `.d.ts` is consumable and the literals match); `npm run smoke` prints `SMOKE OK: ...` and exits 0.

- [ ] **Step 6: Commit**

```bash
cd /home/sabien/Dev/personal/baccarat-simulator
git add smoke/package.json smoke/tsconfig.json smoke/smoke.ts
git commit -m "test: Node/TypeScript smoke test of the built wasm package

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Final verification (whole plan)

- [ ] Native engine suite: `cd engine && cargo test` → all green (117+ tests), `cargo clippy --all-targets -- -D warnings` clean.
- [ ] Wasm feature compiles: `cd engine && cargo check --features wasm` clean.
- [ ] Binding tests: `cd engine-wasm && wasm-pack test --node` → 4 passed.
- [ ] Smoke: `cd smoke && npx tsc --noEmit && npm run smoke` → `SMOKE OK`.
- [ ] `git status` clean; `engine-wasm/pkg/`, `smoke/node_modules/`, `target/` are git-ignored.

After all tasks pass, use **superpowers:finishing-a-development-branch** to merge `engine-wasm` to `master`, then an Opus correctness review of the boundary (signatures match the engine, error mapping throws typed values, i64 marshaling documented).
