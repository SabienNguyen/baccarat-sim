# Scoreboard Roads — Engine Design

**Date:** 2026-06-07
**Status:** Approved
**Parent spec:** `2026-06-07-baccarat-simulator-design.md` (§3 Scoreboard roads)

## 1. Purpose

Add engine-side derivation of the full baccarat scoreboard — the five roads a real
Punto Banco table displays — so both front-ends (web + CLI) render identical boards
from the same source of truth. This is the next engine layer after the rules core
(Plan 1) and side bets (Plan 2).

The engine owns all **logic** (what mark goes where, what color, tie counts, derived
red/blue marks). Each front-end owns only **pixel layout** (wrapping columns into
6-row grids, the dragon-tail bend, dot placement).

## 2. Scope

In scope — all five roads, full casino accuracy:

- **Bead Plate** (珠盤路) — round-by-round grid.
- **Big Road** (大路) — the foundational streak board.
- **Big Eye Boy** (大眼仔) — derived road, offset 1.
- **Small Road** (小路) — derived road, offset 2.
- **Cockroach Pig** (曱甴路) — derived road, offset 3.

Pair markers (the small red/blue dots for Player/Banker pairs) are included in the
data model now. Tie handling is included (required by Big Road mechanics).

Out of scope (deferred to front-end plans): pixel rendering, the dragon-tail bend,
column wrapping, dot positioning, "ask the board" prediction markers (the red/blue
hint a player can request for the next hand — a possible later enhancement).

## 3. Architecture

New module `engine/src/scoreboard.rs`, declared `pub mod scoreboard;` in `lib.rs`.
Pure and stateless, matching the existing engine style (`settle`, `sidebets`).

**Derivation strategy: pure recompute from full history (Approach A).** A single
function rebuilds every road from the complete outcome list on each call. Stateless,
trivially testable against published worked examples. A full shoe is ~60–80 rounds,
so recompute cost is irrelevant; efficiency of an incremental builder buys nothing
and would tangle the derived-road look-back logic with append logic.

### Input

One record per completed round. The engine already computes all of this
(`RoundResult.outcome` plus `Hand::is_pair()` on each hand):

```rust
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct RoundRecord {
    pub outcome: Outcome,        // PlayerWin | BankerWin | Tie (from round::Outcome)
    pub player_pair: bool,
    pub banker_pair: bool,
}
```

A convenience constructor `RoundRecord::from_round(&RoundResult) -> RoundRecord` keeps
call sites simple, but the struct is plain data so tests can build records directly.

### Entry point

```rust
pub fn derive_scoreboard(history: &[RoundRecord]) -> ScoreboardSnapshot
```

### Snapshot

```rust
pub struct ScoreboardSnapshot {
    pub bead_plate: BeadPlate,
    pub big_road: BigRoad,
    pub big_eye_boy: DerivedRoad,
    pub small_road: DerivedRoad,
    pub cockroach_pig: DerivedRoad,
}
```

## 4. Road data models

### 4.1 Bead Plate (positional)

One cell per round, in play order. Front-end wraps into 6-row columns (top-to-bottom,
then next column). Ties get their own cell here (unlike the Big Road).

```rust
pub struct BeadCell {
    pub outcome: Outcome,
    pub player_pair: bool,
    pub banker_pair: bool,
}
pub struct BeadPlate { pub cells: Vec<BeadCell> }
```

### 4.2 Big Road (run-based)

The foundation the derived roads read from. Rules:

- Consecutive same-side **wins** stack vertically in a column.
- A change of winning side starts a new column.
- **Ties create no cell.** A tie increments the `ties` counter on the current
  (most recent) cell.
- **Leading ties** (ties before any decision exists) are held in a pending count and
  attach to the first real cell once a decision occurs.
- Pair flags ride on the winning cell (the round that produced that win).

```rust
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Side { Player, Banker }

pub struct BigRoadCell {
    pub side: Side,
    pub ties: u8,             // number of ties resolved on this cell
    pub player_pair: bool,
    pub banker_pair: bool,
}
pub struct BigRoad { pub columns: Vec<Vec<BigRoadCell>> }
```

Columns are **logical** and unbounded in height. The 6-row dragon-tail bend is a
front-end rendering concern and must NOT affect derivation: the derived-road
algorithm reads logical column index and logical depth, never the bent visual
position.

### 4.3 Derived roads (run-based)

Big Eye Boy, Small Road, Cockroach Pig differ only by an **offset** (1, 2, 3) and a
corresponding **start cell** on the Big Road. Each emits a run-based column structure
of red/blue marks (new column when the color changes), mirroring the Big Road's own
columnization:

```rust
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Mark { Red, Blue }
pub struct DerivedRoad { pub columns: Vec<Vec<Mark>> }
```

All three are produced by one parameterized function differing only by offset/start.

**Start points** (standard): Big Eye Boy begins at the 2nd entry of the Big Road's
2nd column, or the 1st entry of the 3rd column if column 2 has only one entry. Small
Road begins one column later (3rd column / 4th column). Cockroach Pig one column later
again (4th / 5th). These correspond to offsets 1, 2, 3.

**Red/blue predicate (to be pinned exactly in the implementation plan):** the derived
mark reflects whether the Big Road is "regular" (red) or "choppy" (blue) at the
compared offset. The two well-known equivalent formulations:

1. *Turn case* — the current Big Road entry started a new column: compare the lengths
   of the previous two columns offset back; equal length → Red, unequal → Blue.
2. *Continuation case* — the current entry extended its column: look `offset` columns
   to the left at the current depth; if that column reaches the current row → Red,
   otherwise → Blue.

The implementation plan will fix one precise per-cell predicate (covering both cases
and the exact behavior at each road's start cell) and verify it cell-for-cell against
a cited published board, rather than relying on self-consistency.

## 5. Testing strategy

- **Bead Plate:** order and pair/tie cell content for hand-built sequences.
- **Big Road:** column breaks on side change; tie counter increments on the current
  cell; leading-tie hold-and-attach; pair flags on the correct cell; a long streak
  stays one logical column (no premature break at 6).
- **Derived roads:** each tested against a **published worked example** (Wizard of
  Odds board) so the offset rule and start cell are verified cell-for-cell — not just
  internally consistent. Include the empty/early-history cases (no marks before the
  start cell).
- **Property tests:** total derived marks for a road equals the number of Big Road
  entries occurring at or after that road's start cell; `derive_scoreboard` is pure
  (same input → same output); a history of all ties produces empty Big Road and empty
  derived roads but a full Bead Plate.

## 6. Integration

`derive_scoreboard` is a pure read over accumulated history; it does not change the
rules core or settlement. Front-ends call it after each round with the running
`Vec<RoundRecord>`. A later WASM-boundary plan will expose the snapshot across the
TS boundary; this plan stops at the pure Rust API and its tests.

## 7. Open items

- Exact derived-road red/blue predicate + edge cases — pinned in the implementation
  plan against a cited worked example (intentionally deferred from this design).
- "Ask the board" next-hand prediction marks — possible later enhancement, not in
  this plan.
