use crate::round::{Outcome, RoundResult};
use serde::{Deserialize, Serialize};

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
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "wasm", derive(tsify_next::Tsify))]
#[cfg_attr(feature = "wasm", tsify(into_wasm_abi, from_wasm_abi))]
pub enum Side {
    Player,
    Banker,
}

/// Bead Plate: one cell per round, in play order (ties included).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "wasm", derive(tsify_next::Tsify))]
#[cfg_attr(feature = "wasm", tsify(into_wasm_abi, from_wasm_abi))]
pub struct BeadCell {
    pub outcome: Outcome,
    pub player_pair: bool,
    pub banker_pair: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "wasm", derive(tsify_next::Tsify))]
#[cfg_attr(feature = "wasm", tsify(into_wasm_abi, from_wasm_abi))]
pub struct BeadPlate {
    pub cells: Vec<BeadCell>,
}

/// Big Road: a win cell. Ties resolved on this cell bump `ties`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "wasm", derive(tsify_next::Tsify))]
#[cfg_attr(feature = "wasm", tsify(into_wasm_abi, from_wasm_abi))]
pub struct BigRoadCell {
    pub side: Side,
    pub ties: u8,
    pub player_pair: bool,
    pub banker_pair: bool,
}

/// Logical columns (unbounded height); the 6-row dragon-tail bend is front-end layout.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "wasm", derive(tsify_next::Tsify))]
#[cfg_attr(feature = "wasm", tsify(into_wasm_abi, from_wasm_abi))]
pub struct BigRoad {
    pub columns: Vec<Vec<BigRoadCell>>,
}

/// A derived-road mark. Red = pattern, Blue = choppy. Not tied to Player/Banker.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "wasm", derive(tsify_next::Tsify))]
#[cfg_attr(feature = "wasm", tsify(into_wasm_abi, from_wasm_abi))]
pub enum Mark {
    Red,
    Blue,
}

/// Derived road: run-based columns (new column when the color changes).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "wasm", derive(tsify_next::Tsify))]
#[cfg_attr(feature = "wasm", tsify(into_wasm_abi, from_wasm_abi))]
pub struct DerivedRoad {
    pub columns: Vec<Vec<Mark>>,
}

/// The full scoreboard derived from a round history.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "wasm", derive(tsify_next::Tsify))]
#[cfg_attr(feature = "wasm", tsify(into_wasm_abi, from_wasm_abi))]
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
        // Two short columns: B, P -> heights [1,1]. No derived road has started.
        let s = derive_scoreboard(&[win(Outcome::BankerWin), win(Outcome::PlayerWin)]);
        assert!(s.big_eye_boy.columns.is_empty());
        assert!(s.small_road.columns.is_empty());
        assert!(s.cockroach_pig.columns.is_empty());
    }

    #[test]
    fn interspersed_ties_do_not_change_derived_roads() {
        // Ties never occupy a Big Road cell, so they cannot change column heights
        // and must leave the derived roads identical to the tie-free worked example.
        use Outcome::*;
        let with_ties = vec![
            win(BankerWin), win(Tie), win(BankerWin),
            win(PlayerWin), win(PlayerWin), win(Tie), win(PlayerWin),
            win(BankerWin),
            win(Tie), win(PlayerWin),
            win(BankerWin), win(BankerWin),
        ];
        let tied = derive_scoreboard(&with_ties);
        let clean = derive_scoreboard(&worked_example());
        assert_eq!(tied.big_eye_boy, clean.big_eye_boy);
        assert_eq!(tied.small_road, clean.small_road);
        assert_eq!(tied.cockroach_pig, clean.cockroach_pig);
    }
}

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
    fn big_eye_boy_length_equals_worked_example_count() {
        use Outcome::*;
        let history = vec![
            win(BankerWin), win(BankerWin),
            win(PlayerWin), win(PlayerWin), win(PlayerWin),
            win(BankerWin), win(PlayerWin), win(BankerWin), win(BankerWin),
        ];
        let s = derive_scoreboard(&history);
        let total_marks: usize = s.big_eye_boy.columns.iter().map(|c| c.len()).sum();
        assert_eq!(total_marks, 6);
    }
}

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
