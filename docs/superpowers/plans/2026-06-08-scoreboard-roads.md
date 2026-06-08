# Scoreboard Roads Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add engine-side derivation of all five baccarat scoreboard roads (Bead Plate, Big Road, Big Eye Boy, Small Road, Cockroach Pig) as a single pure function over round history.

**Architecture:** One new pure module `engine/src/scoreboard.rs`. `derive_scoreboard(&[RoundRecord])` rebuilds every road from scratch (stateless recompute). Bead Plate and Big Road are built directly from history; the three derived roads come from one parameterized algorithm that reads the Big Road's logical grid (offset 1/2/3). The engine owns all logic; front-ends own pixel layout (6-row wrapping, dragon-tail bend, dot placement).

**Tech Stack:** Rust 2021, crate `baccarat-engine`, built-in test harness.

**Spec:** `docs/superpowers/specs/2026-06-07-scoreboard-roads-design.md`

**Derived-road rule (verified against livedealer.org / WGM / baccarattraining.com):**
- *Turn* (new Big Road entry is the first in a new column): compare the depth of the column immediately left of the current column with the column `offset` further left. Equal depth → Red, unequal → Blue.
- *Continuation* (entry extends the same column to a deeper row): check the cell `offset` columns to the left at the current row. Present → Red, absent → Blue.
- *Start*: a derived road of offset `k` produces a mark for a Big Road cell at (col, row) (both 0-indexed) when `col > k || (col == k && row >= 1)`.

---

## Existing API this builds on (do not change)

- `round::Outcome { PlayerWin, BankerWin, Tie }` — `Debug, Clone, Copy, PartialEq, Eq`.
- `round::RoundResult { player: Hand, banker: Hand, outcome: Outcome, trace: Vec<String> }`.
- `hand::Hand { cards: Vec<Card> }`, `Hand::is_pair() -> bool`.
- `shoe::Shoe::new_seeded(u64)`, `round::play_round(&mut impl Iterator<Item = Card>) -> RoundResult`.

## File Structure

- `engine/src/scoreboard.rs` — NEW. All road types, `derive_scoreboard`, private builders, and `RoundRecord::from_round`.
- `engine/src/lib.rs` — MODIFY. Add `pub mod scoreboard;`.
- `engine/tests/integration.rs` — MODIFY. Add an end-to-end seeded-shoe scoreboard assertion.

---

### Task 1: Module skeleton — types and empty snapshot

Establish every public type and a `derive_scoreboard` wired to stub builders that return empty roads. This locks the data model; later tasks fill in each builder.

**Files:**
- Create: `engine/src/scoreboard.rs`
- Modify: `engine/src/lib.rs`

- [ ] **Step 1: Declare the module.** Add to `engine/src/lib.rs` alongside the other `pub mod` lines:

```rust
pub mod scoreboard;
```

- [ ] **Step 2: Write the module with types, stubbed builders, and a failing test.** Create `engine/src/scoreboard.rs`:

```rust
use crate::round::{Outcome, RoundResult};

/// One completed round, as the scoreboard needs to see it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct RoundRecord {
    pub outcome: Outcome,
    pub player_pair: bool,
    pub banker_pair: bool,
}

impl RoundRecord {
    /// Build a record from a finished round.
    pub fn from_round(round: &RoundResult) -> RoundRecord {
        RoundRecord {
            outcome: round.outcome,
            player_pair: round.player.is_pair(),
            banker_pair: round.banker.is_pair(),
        }
    }
}

/// Winning side of a decided round (no Tie — ties never occupy a Big Road cell).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Side {
    Player,
    Banker,
}

/// Bead Plate: one cell per round, in play order (ties included).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct BeadCell {
    pub outcome: Outcome,
    pub player_pair: bool,
    pub banker_pair: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BeadPlate {
    pub cells: Vec<BeadCell>,
}

/// Big Road: a win cell. Ties resolved on this cell bump `ties`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct BigRoadCell {
    pub side: Side,
    pub ties: u8,
    pub player_pair: bool,
    pub banker_pair: bool,
}

/// Logical columns (unbounded height); the 6-row dragon-tail bend is front-end layout.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BigRoad {
    pub columns: Vec<Vec<BigRoadCell>>,
}

/// A derived-road mark. Red = pattern, Blue = choppy. Not tied to Player/Banker.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Mark {
    Red,
    Blue,
}

/// Derived road: run-based columns (new column when the color changes).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DerivedRoad {
    pub columns: Vec<Vec<Mark>>,
}

/// The full scoreboard derived from a round history.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ScoreboardSnapshot {
    pub bead_plate: BeadPlate,
    pub big_road: BigRoad,
    pub big_eye_boy: DerivedRoad,
    pub small_road: DerivedRoad,
    pub cockroach_pig: DerivedRoad,
}

/// Rebuild all five roads from the complete round history (pure recompute).
pub fn derive_scoreboard(history: &[RoundRecord]) -> ScoreboardSnapshot {
    let big_road = build_big_road(history);
    ScoreboardSnapshot {
        bead_plate: build_bead_plate(history),
        big_eye_boy: derived_road(&big_road, 1),
        small_road: derived_road(&big_road, 2),
        cockroach_pig: derived_road(&big_road, 3),
        big_road,
    }
}

fn build_bead_plate(_history: &[RoundRecord]) -> BeadPlate {
    BeadPlate { cells: Vec::new() }
}

fn build_big_road(_history: &[RoundRecord]) -> BigRoad {
    BigRoad { columns: Vec::new() }
}

fn derived_road(_big: &BigRoad, _offset: usize) -> DerivedRoad {
    DerivedRoad { columns: Vec::new() }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn empty_history_yields_empty_roads() {
        let s = derive_scoreboard(&[]);
        assert!(s.bead_plate.cells.is_empty());
        assert!(s.big_road.columns.is_empty());
        assert!(s.big_eye_boy.columns.is_empty());
        assert!(s.small_road.columns.is_empty());
        assert!(s.cockroach_pig.columns.is_empty());
    }
}
```

- [ ] **Step 3: Run to verify it passes.** `cd engine && cargo test scoreboard::tests::empty` — Expected PASS: 1 test ok. (The stubs satisfy the empty case; real behavior is tested in later tasks.)

- [ ] **Step 4: Whole-crate check.** `cd engine && cargo test` and `cd engine && cargo clippy --all-targets -- -D warnings`. Expected: all green, no warnings. If clippy flags the unused `_offset`/`_history` params, the leading underscore already silences it; do not add `#[allow]`.

- [ ] **Step 5: Commit.**

```bash
git add engine/src/scoreboard.rs engine/src/lib.rs
git commit -m "feat: scoreboard module skeleton and road types"
```

---

### Task 2: Bead Plate

One cell per round in play order, ties included, carrying pair flags.

**Files:**
- Modify: `engine/src/scoreboard.rs`

- [ ] **Step 1: Write failing tests.** Add a new test module at the end of `engine/src/scoreboard.rs`:

```rust
#[cfg(test)]
mod bead_plate_tests {
    use super::*;

    fn rec(outcome: Outcome, pp: bool, bp: bool) -> RoundRecord {
        RoundRecord { outcome, player_pair: pp, banker_pair: bp }
    }

    #[test]
    fn one_cell_per_round_in_order_including_ties() {
        let history = vec![
            rec(Outcome::PlayerWin, false, false),
            rec(Outcome::Tie, false, false),
            rec(Outcome::BankerWin, false, false),
        ];
        let s = derive_scoreboard(&history);
        assert_eq!(s.bead_plate.cells.len(), 3);
        assert_eq!(s.bead_plate.cells[0].outcome, Outcome::PlayerWin);
        assert_eq!(s.bead_plate.cells[1].outcome, Outcome::Tie);
        assert_eq!(s.bead_plate.cells[2].outcome, Outcome::BankerWin);
    }

    #[test]
    fn pair_flags_carry_onto_cells() {
        let history = vec![rec(Outcome::PlayerWin, true, false)];
        let s = derive_scoreboard(&history);
        assert!(s.bead_plate.cells[0].player_pair);
        assert!(!s.bead_plate.cells[0].banker_pair);
    }
}
```

- [ ] **Step 2: Run to verify it fails.** `cd engine && cargo test scoreboard::bead_plate` — Expected FAIL: lengths are 0 (stub returns empty).

- [ ] **Step 3: Implement `build_bead_plate`.** Replace the stub body in `engine/src/scoreboard.rs`:

```rust
fn build_bead_plate(history: &[RoundRecord]) -> BeadPlate {
    let cells = history
        .iter()
        .map(|r| BeadCell {
            outcome: r.outcome,
            player_pair: r.player_pair,
            banker_pair: r.banker_pair,
        })
        .collect();
    BeadPlate { cells }
}
```

- [ ] **Step 4: Run to verify it passes.** `cd engine && cargo test scoreboard::bead_plate` — Expected PASS: 2 tests ok.

- [ ] **Step 5: Commit.**

```bash
git add engine/src/scoreboard.rs
git commit -m "feat: scoreboard bead plate"
```

---

### Task 3: Big Road core (sides, columns, streaks)

Consecutive same-side wins stack in a column; a side change starts a new column. Ties are handled in Task 4 — this task only sees Player/Banker histories.

**Files:**
- Modify: `engine/src/scoreboard.rs`

- [ ] **Step 1: Write failing tests.** Add a new test module at the end of `engine/src/scoreboard.rs`:

```rust
#[cfg(test)]
mod big_road_core_tests {
    use super::*;

    fn win(outcome: Outcome) -> RoundRecord {
        RoundRecord { outcome, player_pair: false, banker_pair: false }
    }

    #[test]
    fn side_change_starts_new_column() {
        // B, P, P -> column0 = [B], column1 = [P, P]
        let history = vec![win(Outcome::BankerWin), win(Outcome::PlayerWin), win(Outcome::PlayerWin)];
        let s = derive_scoreboard(&history);
        assert_eq!(s.big_road.columns.len(), 2);
        assert_eq!(s.big_road.columns[0].len(), 1);
        assert_eq!(s.big_road.columns[0][0].side, Side::Banker);
        assert_eq!(s.big_road.columns[1].len(), 2);
        assert_eq!(s.big_road.columns[1][0].side, Side::Player);
        assert_eq!(s.big_road.columns[1][1].side, Side::Player);
    }

    #[test]
    fn long_streak_stays_one_logical_column() {
        // Seven straight Banker wins -> one column of height 7 (no break at 6).
        let history = vec![win(Outcome::BankerWin); 7];
        let s = derive_scoreboard(&history);
        assert_eq!(s.big_road.columns.len(), 1);
        assert_eq!(s.big_road.columns[0].len(), 7);
    }
}
```

- [ ] **Step 2: Run to verify it fails.** `cd engine && cargo test scoreboard::big_road_core` — Expected FAIL: 0 columns (stub).

- [ ] **Step 3: Implement `build_big_road` (wins only for now).** Replace the stub body in `engine/src/scoreboard.rs`:

```rust
fn build_big_road(history: &[RoundRecord]) -> BigRoad {
    let mut columns: Vec<Vec<BigRoadCell>> = Vec::new();

    for r in history {
        let side = match r.outcome {
            Outcome::PlayerWin => Side::Player,
            Outcome::BankerWin => Side::Banker,
            Outcome::Tie => continue, // ties handled in a later task
        };
        let cell = BigRoadCell {
            side,
            ties: 0,
            player_pair: r.player_pair,
            banker_pair: r.banker_pair,
        };
        match columns.last() {
            Some(col) if col[0].side == side => columns.last_mut().unwrap().push(cell),
            _ => columns.push(vec![cell]),
        }
    }

    BigRoad { columns }
}
```

- [ ] **Step 4: Run to verify it passes.** `cd engine && cargo test scoreboard::big_road_core` — Expected PASS: 2 tests ok.

- [ ] **Step 5: Commit.**

```bash
git add engine/src/scoreboard.rs
git commit -m "feat: big road streak columns (wins only)"
```

---

### Task 4: Big Road ties and pair flags

A tie bumps the `ties` counter on the current (most recent) cell. Leading ties (before any decision) are held and attach to the first real cell. Pair flags already ride on each win cell (Task 3) — add a test to lock that.

**Files:**
- Modify: `engine/src/scoreboard.rs`

- [ ] **Step 1: Write failing tests.** Add a new test module at the end of `engine/src/scoreboard.rs`:

```rust
#[cfg(test)]
mod big_road_tie_tests {
    use super::*;

    fn rec(outcome: Outcome, pp: bool, bp: bool) -> RoundRecord {
        RoundRecord { outcome, player_pair: pp, banker_pair: bp }
    }
    fn win(outcome: Outcome) -> RoundRecord {
        rec(outcome, false, false)
    }

    #[test]
    fn tie_bumps_counter_on_current_cell_not_a_new_cell() {
        // B, T, T -> still one column, one cell, ties = 2.
        let history = vec![win(Outcome::BankerWin), win(Outcome::Tie), win(Outcome::Tie)];
        let s = derive_scoreboard(&history);
        assert_eq!(s.big_road.columns.len(), 1);
        assert_eq!(s.big_road.columns[0].len(), 1);
        assert_eq!(s.big_road.columns[0][0].ties, 2);
    }

    #[test]
    fn leading_ties_attach_to_first_real_cell() {
        // T, T, P -> one cell (Player) carrying ties = 2.
        let history = vec![win(Outcome::Tie), win(Outcome::Tie), win(Outcome::PlayerWin)];
        let s = derive_scoreboard(&history);
        assert_eq!(s.big_road.columns.len(), 1);
        assert_eq!(s.big_road.columns[0][0].side, Side::Player);
        assert_eq!(s.big_road.columns[0][0].ties, 2);
    }

    #[test]
    fn same_side_after_tie_stacks_in_same_column() {
        // B, T, B -> one column [B(ties=1), B(ties=0)].
        let history = vec![win(Outcome::BankerWin), win(Outcome::Tie), win(Outcome::BankerWin)];
        let s = derive_scoreboard(&history);
        assert_eq!(s.big_road.columns.len(), 1);
        assert_eq!(s.big_road.columns[0].len(), 2);
        assert_eq!(s.big_road.columns[0][0].ties, 1);
        assert_eq!(s.big_road.columns[0][1].ties, 0);
    }

    #[test]
    fn pair_flags_ride_on_win_cell() {
        let history = vec![rec(Outcome::BankerWin, false, true)];
        let s = derive_scoreboard(&history);
        assert!(s.big_road.columns[0][0].banker_pair);
        assert!(!s.big_road.columns[0][0].player_pair);
    }
}
```

- [ ] **Step 2: Run to verify it fails.** `cd engine && cargo test scoreboard::big_road_tie` — Expected FAIL: the tie tests fail (current code `continue`s on ties, never recording them; leading-tie test finds ties = 0).

- [ ] **Step 3: Implement ties in `build_big_road`.** Replace the whole `build_big_road` function in `engine/src/scoreboard.rs` with this version:

```rust
fn build_big_road(history: &[RoundRecord]) -> BigRoad {
    let mut columns: Vec<Vec<BigRoadCell>> = Vec::new();
    let mut pending_ties: u8 = 0; // ties seen before any decision exists yet

    for r in history {
        let side = match r.outcome {
            Outcome::PlayerWin => Side::Player,
            Outcome::BankerWin => Side::Banker,
            Outcome::Tie => {
                match columns.last_mut() {
                    Some(col) => col.last_mut().unwrap().ties += 1,
                    None => pending_ties += 1,
                }
                continue;
            }
        };

        let cell = BigRoadCell {
            side,
            ties: pending_ties, // attach any held leading ties to this first cell
            player_pair: r.player_pair,
            banker_pair: r.banker_pair,
        };
        pending_ties = 0;

        match columns.last() {
            Some(col) if col[0].side == side => columns.last_mut().unwrap().push(cell),
            _ => columns.push(vec![cell]),
        }
    }

    BigRoad { columns }
}
```

- [ ] **Step 4: Run to verify it passes.** `cd engine && cargo test scoreboard::big_road` — Expected PASS: core tests (Task 3) and tie tests all green. Note `pending_ties` only ever attaches to the very first cell, so it does not affect mid-shoe stacking.

- [ ] **Step 5: Commit.**

```bash
git add engine/src/scoreboard.rs
git commit -m "feat: big road tie counts, leading ties, pair flags"
```

---

### Task 5: Derived roads (Big Eye Boy, Small Road, Cockroach Pig)

One parameterized algorithm over the Big Road's logical grid, plus a `columnize` helper. Verified cell-for-cell against a hand-derived worked example for all three offsets.

**Worked example** — history (wins only) `B B P P P B P B B` builds this Big Road (0-indexed `[col][row]`):

```
col0 = [B, B]        (height 2)
col1 = [P, P, P]     (height 3)
col2 = [B]           (height 1)
col3 = [P]           (height 1)
col4 = [B, B]        (height 2)
```

Applying the rule (start: `col > k || (col == k && row >= 1)`; turn: equal depth of col-1 vs col-1-k → Red; continuation: cell `k` left at this row present → Red):

- **Big Eye Boy (k=1):** marks in order `R, B, B, B, R, B` → columns `[[R], [B,B,B], [R], [B]]`.
- **Small Road (k=2):** marks `B, B, B` → columns `[[B,B,B]]`.
- **Cockroach Pig (k=3):** marks `B, R` → columns `[[B], [R]]`.

**Files:**
- Modify: `engine/src/scoreboard.rs`

- [ ] **Step 1: Write failing tests.** Add a new test module at the end of `engine/src/scoreboard.rs`:

```rust
#[cfg(test)]
mod derived_road_tests {
    use super::*;

    fn win(outcome: Outcome) -> RoundRecord {
        RoundRecord { outcome, player_pair: false, banker_pair: false }
    }

    // B B P P P B P B B
    fn worked_example() -> Vec<RoundRecord> {
        use Outcome::*;
        vec![
            win(BankerWin), win(BankerWin),
            win(PlayerWin), win(PlayerWin), win(PlayerWin),
            win(BankerWin),
            win(PlayerWin),
            win(BankerWin), win(BankerWin),
        ]
    }

    #[test]
    fn big_eye_boy_matches_worked_example() {
        let s = derive_scoreboard(&worked_example());
        use Mark::*;
        assert_eq!(
            s.big_eye_boy.columns,
            vec![vec![Red], vec![Blue, Blue, Blue], vec![Red], vec![Blue]]
        );
    }

    #[test]
    fn small_road_matches_worked_example() {
        let s = derive_scoreboard(&worked_example());
        use Mark::*;
        assert_eq!(s.small_road.columns, vec![vec![Blue, Blue, Blue]]);
    }

    #[test]
    fn cockroach_pig_matches_worked_example() {
        let s = derive_scoreboard(&worked_example());
        use Mark::*;
        assert_eq!(s.cockroach_pig.columns, vec![vec![Blue], vec![Red]]);
    }

    #[test]
    fn no_marks_before_the_start_cell() {
        // Two short columns: B, P -> heights [1,1]. Big Eye Boy (k=1) start is
        // (col=1,row=1) or (col=2,row=0); neither exists, so no marks.
        let s = derive_scoreboard(&[win(Outcome::BankerWin), win(Outcome::PlayerWin)]);
        assert!(s.big_eye_boy.columns.is_empty());
        assert!(s.small_road.columns.is_empty());
        assert!(s.cockroach_pig.columns.is_empty());
    }
}
```

- [ ] **Step 2: Run to verify it fails.** `cd engine && cargo test scoreboard::derived_road` — Expected FAIL: derived roads are empty (stub).

- [ ] **Step 3: Implement `derived_road` and `columnize`.** Replace the `derived_road` stub in `engine/src/scoreboard.rs` and add `columnize` directly below it:

```rust
fn derived_road(big: &BigRoad, offset: usize) -> DerivedRoad {
    let heights: Vec<usize> = big.columns.iter().map(|c| c.len()).collect();
    let mut marks: Vec<Mark> = Vec::new();

    for (col, column) in big.columns.iter().enumerate() {
        for row in 0..column.len() {
            // This road only starts producing once the Big Road is deep/wide enough.
            let started = col > offset || (col == offset && row >= 1);
            if !started {
                continue;
            }

            let mark = if row == 0 {
                // Turn: compare the depth of the previous column with the one `offset`
                // columns further left. Both indices are valid because col > offset here.
                if heights[col - 1] == heights[col - 1 - offset] {
                    Mark::Red
                } else {
                    Mark::Blue
                }
            } else {
                // Continuation: is there a cell `offset` columns left at this row?
                if heights[col - offset] > row {
                    Mark::Red
                } else {
                    Mark::Blue
                }
            };
            marks.push(mark);
        }
    }

    DerivedRoad { columns: columnize(&marks) }
}

/// Group a flat mark sequence into run-based columns (new column on color change).
fn columnize(marks: &[Mark]) -> Vec<Vec<Mark>> {
    let mut columns: Vec<Vec<Mark>> = Vec::new();
    for &m in marks {
        match columns.last_mut() {
            Some(col) if col[0] == m => col.push(m),
            _ => columns.push(vec![m]),
        }
    }
    columns
}
```

- [ ] **Step 4: Run to verify it passes.** `cd engine && cargo test scoreboard::derived_road` — Expected PASS: 4 tests ok.

- [ ] **Step 5: Whole-crate check.** `cd engine && cargo test` and `cd engine && cargo clippy --all-targets -- -D warnings`. Expected: all green, no warnings.

- [ ] **Step 6: Commit.**

```bash
git add engine/src/scoreboard.rs
git commit -m "feat: derived roads (big eye boy, small road, cockroach pig)"
```

---

### Task 6: `from_round` wiring, property tests, and integration

Lock the `RoundRecord::from_round` convenience constructor, add property tests for purity and the derived-length invariant, and prove the scoreboard works end-to-end from a seeded shoe.

**Files:**
- Modify: `engine/src/scoreboard.rs`
- Modify: `engine/tests/integration.rs`

- [ ] **Step 1: Write failing tests.** Add a new test module at the end of `engine/src/scoreboard.rs`:

```rust
#[cfg(test)]
mod invariants_tests {
    use super::*;
    use crate::card::{Card, Rank, Suit};
    use crate::hand::Hand;
    use crate::round::RoundResult;

    fn win(outcome: Outcome) -> RoundRecord {
        RoundRecord { outcome, player_pair: false, banker_pair: false }
    }

    #[test]
    fn from_round_reads_outcome_and_pairs() {
        let round = RoundResult {
            player: Hand {
                cards: vec![
                    Card { rank: Rank::Seven, suit: Suit::Clubs },
                    Card { rank: Rank::Seven, suit: Suit::Hearts },
                ],
            },
            banker: Hand {
                cards: vec![
                    Card { rank: Rank::Two, suit: Suit::Spades },
                    Card { rank: Rank::Three, suit: Suit::Diamonds },
                ],
            },
            outcome: Outcome::PlayerWin,
            trace: Vec::new(),
        };
        let rec = RoundRecord::from_round(&round);
        assert_eq!(rec.outcome, Outcome::PlayerWin);
        assert!(rec.player_pair);
        assert!(!rec.banker_pair);
    }

    #[test]
    fn derivation_is_pure() {
        let history = vec![
            win(Outcome::BankerWin), win(Outcome::PlayerWin), win(Outcome::PlayerWin),
            win(Outcome::Tie), win(Outcome::BankerWin),
        ];
        assert_eq!(derive_scoreboard(&history), derive_scoreboard(&history));
    }

    #[test]
    fn all_ties_give_full_bead_plate_but_empty_big_and_derived() {
        let history = vec![win(Outcome::Tie); 5];
        let s = derive_scoreboard(&history);
        assert_eq!(s.bead_plate.cells.len(), 5);
        assert!(s.big_road.columns.is_empty());
        assert!(s.big_eye_boy.columns.is_empty());
        assert!(s.small_road.columns.is_empty());
        assert!(s.cockroach_pig.columns.is_empty());
    }

    #[test]
    fn big_eye_boy_length_equals_big_road_entries_past_start() {
        // Reuse the worked example: 9 wins, Big Road has 9 cells.
        // Big Eye Boy (offset 1) produces a mark for every cell except the first
        // two (col0 row0/row1 are before its start), i.e. 9 - 2 = 7... but the
        // start excludes col0 entirely (2 cells) AND (col1,row0). Count directly.
        use Outcome::*;
        let history = vec![
            win(BankerWin), win(BankerWin),
            win(PlayerWin), win(PlayerWin), win(PlayerWin),
            win(BankerWin), win(PlayerWin), win(BankerWin), win(BankerWin),
        ];
        let s = derive_scoreboard(&history);
        let total_marks: usize = s.big_eye_boy.columns.iter().map(|c| c.len()).sum();
        // From the worked example, Big Eye Boy has 6 marks (R,B,B,B,R,B).
        assert_eq!(total_marks, 6);
    }
}
```

- [ ] **Step 2: Run to verify it fails or passes appropriately.** `cd engine && cargo test scoreboard::invariants` — `from_round_reads_outcome_and_pairs`, `derivation_is_pure`, `all_ties_*`, and the length test should all PASS immediately, because `from_round` and `derive_scoreboard` already exist from earlier tasks. If any fail, fix the implementation (not the test) before continuing. (These tests guard invariants rather than introduce new production code.)

- [ ] **Step 3: Add the integration test.** Append to `engine/tests/integration.rs`:

```rust
use baccarat_engine::scoreboard::{derive_scoreboard, RoundRecord};

#[test]
fn seeded_shoe_builds_a_consistent_scoreboard() {
    let mut shoe = baccarat_engine::shoe::Shoe::new_seeded(2024);
    let mut history: Vec<RoundRecord> = Vec::new();

    // Play 20 rounds, reshuffling is not needed (8 decks easily covers this).
    for _ in 0..20 {
        let round = baccarat_engine::round::play_round(&mut shoe);
        history.push(RoundRecord::from_round(&round));
    }

    let board = derive_scoreboard(&history);

    // Bead Plate has exactly one cell per round.
    assert_eq!(board.bead_plate.cells.len(), 20);

    // Big Road cell count equals the number of non-tie rounds.
    let non_ties = history
        .iter()
        .filter(|r| r.outcome != baccarat_engine::round::Outcome::Tie)
        .count();
    let big_road_cells: usize = board.big_road.columns.iter().map(|c| c.len()).sum();
    assert_eq!(big_road_cells, non_ties);

    // Determinism: same seed, same board.
    let mut shoe2 = baccarat_engine::shoe::Shoe::new_seeded(2024);
    let mut history2: Vec<RoundRecord> = Vec::new();
    for _ in 0..20 {
        history2.push(RoundRecord::from_round(&baccarat_engine::round::play_round(&mut shoe2)));
    }
    assert_eq!(board, derive_scoreboard(&history2));
}
```

- [ ] **Step 4: Run the full suite.** `cd engine && cargo test` — Expected PASS: all unit + integration tests green.

- [ ] **Step 5: Lint.** `cd engine && cargo clippy --all-targets -- -D warnings` — Expected: no warnings.

- [ ] **Step 6: Commit.**

```bash
git add engine/src/scoreboard.rs engine/tests/integration.rs
git commit -m "feat: scoreboard from_round, invariants, end-to-end integration"
```

---

## Self-Review

**Spec coverage (design spec §2 scope):**
- Bead Plate → Task 2. ✓
- Big Road (streaks, ties, leading ties, pairs) → Tasks 3–4. ✓
- Big Eye Boy / Small Road / Cockroach Pig, full accuracy → Task 5, with cell-for-cell worked example for all three. ✓
- Pair markers in the model → `BeadCell` + `BigRoadCell` fields, Tasks 2 & 4. ✓
- Pure recompute (Approach A) → single `derive_scoreboard`, purity property test in Task 6. ✓
- `RoundRecord::from_round` convenience → defined Task 1, tested Task 6. ✓
- Logical unbounded columns (bend is front-end) → Task 3 `long_streak_stays_one_logical_column`. ✓
- Testing strategy (worked example, property tests, all-ties case) → Tasks 5–6. ✓
- WASM boundary → explicitly out of scope (later plan), not a gap.

**Placeholder scan:** No TBD/TODO. Every code step shows complete code; every run step states an expected result. The derived-road predicate is fully specified (not deferred) and locked to a hand-computed example.

**Type consistency:** `RoundRecord`, `Side`, `BeadCell`, `BeadPlate`, `BigRoadCell`, `BigRoad`, `Mark`, `DerivedRoad`, `ScoreboardSnapshot` are defined once in Task 1 and used unchanged thereafter. `derive_scoreboard(&[RoundRecord]) -> ScoreboardSnapshot`, `build_bead_plate`, `build_big_road`, `derived_road(&BigRoad, usize)`, and `columnize(&[Mark])` signatures match across all tasks. `Outcome` variants (`PlayerWin`, `BankerWin`, `Tie`) and `Hand::is_pair()` match the engine core. Field names (`columns`, `cells`, `side`, `ties`, `player_pair`, `banker_pair`, `outcome`) are consistent between definitions, builders, and tests.

**Algorithm correctness:** The turn/continuation predicate and the per-road offsets/start cells were verified against external descriptions (livedealer.org, WGM, baccarattraining.com) and hand-computed cell-for-cell for all three derived roads on the `B B P P P B P B B` sequence.
