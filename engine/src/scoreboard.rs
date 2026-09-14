use crate::round::{Outcome, RoundResult};
use serde::{Deserialize, Serialize};

/// One completed round, as the scoreboard needs to see it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct RoundRecord {
    pub outcome: Outcome,
    pub player_pair: bool,
    pub banker_pair: bool,
    /// Banker won with a three-card 7 — the EZ Baccarat "Dragon 7".
    pub dragon7: bool,
    /// Player won with a three-card 8 — the EZ Baccarat "Panda 8".
    pub panda8: bool,
    /// Banker won on a total of 6 — the "Tiger".
    pub tiger: bool,
    /// A natural: an 8 or 9 on exactly the first two cards, ending the coup
    /// with no draws. On a tie, either side having one still counts. Reuses
    /// `Hand::is_natural` (the same check `play_round` uses to skip draws),
    /// so this is never re-derived from totals here.
    pub natural: bool,
}

impl RoundRecord {
    /// Build a record from a finished round.
    pub fn from_round(round: &RoundResult) -> RoundRecord {
        // The animal bonuses a real EZ Baccarat / Tiger display marks on the
        // road. Conditions mirror sidebets.rs (the paytable stays there — these
        // are only the display flags).
        let banker_won = round.outcome == Outcome::BankerWin;
        RoundRecord {
            outcome: round.outcome,
            player_pair: round.player.is_pair(),
            banker_pair: round.banker.is_pair(),
            dragon7: banker_won && round.banker.total() == 7 && round.banker.cards.len() == 3,
            panda8: round.outcome == Outcome::PlayerWin
                && round.player.total() == 8
                && round.player.cards.len() == 3,
            tiger: banker_won && round.banker.total() == 6,
            natural: round.player.is_natural() || round.banker.is_natural(),
        }
    }
}

/// Build a round history from a bare outcome sequence (e.g. from a photographed
/// pit display or a worked example). Accepts `B`/`P`/`T` case-insensitively,
/// ignores whitespace and any other character, and sets every flag false —
/// there is no pair/animal/natural information in a bare outcome letter.
pub fn records_from_outcomes(seq: &str) -> Vec<RoundRecord> {
    seq.chars()
        .filter_map(|c| {
            let outcome = match c.to_ascii_uppercase() {
                'B' => Outcome::BankerWin,
                'P' => Outcome::PlayerWin,
                'T' => Outcome::Tie,
                _ => return None,
            };
            Some(RoundRecord {
                outcome,
                player_pair: false,
                banker_pair: false,
                dragon7: false,
                panda8: false,
                tiger: false,
                natural: false,
            })
        })
        .collect()
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
    /// Animal-bonus marks a real display stamps on the winning cell.
    pub dragon7: bool,
    pub panda8: bool,
    pub tiger: bool,
    /// Gold-dot mark: the winning side's two-card total was 8 or 9.
    pub natural: bool,
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
            dragon7: r.dragon7,
            panda8: r.panda8,
            tiger: r.tiger,
            natural: r.natural,
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
                // Continuation: look `offset` columns left at this row and at the
                // row above it. Both cells present → Red; the one above present
                // but this one missing → Blue (the reference column just ended);
                // both missing → Red again (nothing changed, the reference
                // column was already over). Checking only "is this row present"
                // called every deep run Blue from its third cell on, when a
                // real display shows one Blue at the break and then Red.
                let reference = heights[col - offset];
                if reference > row {
                    Mark::Red
                } else if reference == row {
                    Mark::Blue
                } else {
                    Mark::Red
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
        RoundRecord { outcome, player_pair: false, banker_pair: false, dragon7: false, panda8: false, tiger: false, natural: false }
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
    fn a_deep_run_beside_a_short_column_breaks_once_then_holds() {
        // Big Road [B], [P,P,P,P]: Big Eye Boy reads column 0 (one cell) while
        // column 1 grows. Row 1: the cell beside is missing but the one above
        // it exists → Blue. Rows 2 and 3: both the cell beside and the one
        // above are missing → nothing changed → Red. The old rule marked all
        // three Blue.
        use Outcome::*;
        let s = derive_scoreboard(&[
            win(BankerWin), win(PlayerWin), win(PlayerWin), win(PlayerWin), win(PlayerWin),
        ]);
        use Mark::*;
        assert_eq!(s.big_eye_boy.columns, vec![vec![Blue], vec![Red, Red]]);
    }

    #[test]
    fn small_road_and_cockroach_pig_hold_red_past_a_finished_reference_column() {
        // Big Road [B,B], [P], [B,B,B,B]: heights [2,1,4].
        // Small Road (offset 2) reads column 0 for column 2: row 1 Red (2 > 1),
        // row 2 Blue (2 == 2, the reference just ended), row 3 Red (both gone).
        use Outcome::*;
        let s = derive_scoreboard(&[
            win(BankerWin), win(BankerWin), win(PlayerWin),
            win(BankerWin), win(BankerWin), win(BankerWin), win(BankerWin),
        ]);
        use Mark::*;
        assert_eq!(s.small_road.columns, vec![vec![Red], vec![Blue], vec![Red]]);

        // Big Road [B], [P], [B], [P,P,P,P]: heights [1,1,1,4]. Cockroach Pig
        // (offset 3) reads column 0 for column 3: row 1 Blue, rows 2-3 Red.
        let s = derive_scoreboard(&[
            win(BankerWin), win(PlayerWin), win(BankerWin),
            win(PlayerWin), win(PlayerWin), win(PlayerWin), win(PlayerWin),
        ]);
        assert_eq!(s.cockroach_pig.columns, vec![vec![Blue], vec![Red, Red]]);
    }

    #[test]
    fn no_marks_before_the_start_cell() {
        // Two short columns: B, P -> heights [1,1]. No derived road has started.
        let s = derive_scoreboard(&[win(Outcome::BankerWin), win(Outcome::PlayerWin)]);
        assert!(s.big_eye_boy.columns.is_empty());
        assert!(s.small_road.columns.is_empty());
        assert!(s.cockroach_pig.columns.is_empty());
    }

    // Renders a Big Road column vector as "B1 P1 B2 P1 …" — side + column height.
    fn render_big_road(columns: &[Vec<BigRoadCell>]) -> String {
        columns
            .iter()
            .map(|col| {
                let letter = match col[0].side {
                    Side::Banker => 'B',
                    Side::Player => 'P',
                };
                format!("{letter}{}", col.len())
            })
            .collect::<Vec<_>>()
            .join(" ")
    }

    // Renders a derived-road column vector as "R1 b4 R2 …" — Red/blue + column height.
    fn render_derived_road(columns: &[Vec<Mark>]) -> String {
        columns
            .iter()
            .map(|col| {
                let letter = match col[0] {
                    Mark::Red => 'R',
                    Mark::Blue => 'b',
                };
                format!("{letter}{}", col.len())
            })
            .collect::<Vec<_>>()
            .join(" ")
    }

    #[test]
    fn real_pit_display_68_hand_shoe_matches_every_road() {
        // Source: Wizard of Odds "Baccarat Score Boards" page photos
        // (bac-display-*.jpg) and its Big Road / Big Eye Boy example grids,
        // 2012 pit display, 68 hands, verified 2026-09-14. Bead plate read
        // top-to-bottom, column by column, no ties in this shoe. Note: the
        // pit display's Small Road grid had scrolled four columns by hand
        // 68, so the photo shows columns 5-42 of the full 42-column road
        // (its first visible mark is the `b1` of column 5) — Big Eye Boy and
        // Cockroach Pig had not scrolled and match in full.
        let seq = "BPBBPB BBBPBP BBPPPB BBPPBP PPBBPP BPBBBP PPBBPP BPBBBP BBPBBB PBBBBP BPBPPP BP";
        let history = records_from_outcomes(seq);
        assert_eq!(history.len(), 68);

        let s = derive_scoreboard(&history);

        assert_eq!(
            render_big_road(&s.big_road.columns),
            "B1 P1 B2 P1 B4 P1 B1 P1 B2 P3 B3 P2 B1 P3 B2 P2 B1 P1 B3 P3 B2 P2 B1 P1 B3 P1 B2 P1 B3 P1 B4 P1 B1 P1 B1 P3 B1 P1"
        );
        assert_eq!(s.big_road.columns.len(), 38);

        assert_eq!(
            render_derived_road(&s.big_eye_boy.columns),
            "R1 b4 R2 b2 R2 b2 R1 b2 R4 b3 R1 b1 R1 b1 R2 b1 R1 b1 R1 b1 R4 b1 R2 b1 R1 b1 R1 b6 R1 b3 R2 b2 R3 b1 R1 b2"
        );
        assert_eq!(s.big_eye_boy.columns.len(), 36);

        assert_eq!(
            render_derived_road(&s.small_road.columns),
            "b2 R2 b1 R1 b1 R1 b1 R1 b3 R1 b1 R1 b2 R1 b2 R1 b4 R1 b4 R1 b2 R1 b1 R1 b1 R1 b4 R1 b1 R2 b1 R2 b2 R3 b2 R1 b1 R2 b1 R1 b1 R1"
        );
        assert_eq!(s.small_road.columns.len(), 42);

        assert_eq!(
            render_derived_road(&s.cockroach_pig.columns),
            "R1 b1 R2 b2 R1 b4 R1 b2 R1 b1 R2 b1 R5 b4 R1 b3 R1 b3 R1 b3 R1 b2 R1 b4 R1 b3 R2 b2 R1 b1 R1 b1 R1 b1 R1"
        );
        assert_eq!(s.cockroach_pig.columns.len(), 35);

        let banker = history.iter().filter(|r| r.outcome == Outcome::BankerWin).count();
        let player = history.iter().filter(|r| r.outcome == Outcome::PlayerWin).count();
        let tie = history.iter().filter(|r| r.outcome == Outcome::Tie).count();
        assert_eq!((banker, player, tie, history.len()), (38, 30, 0, 68));
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
        RoundRecord { outcome, player_pair: pp, banker_pair: bp, dragon7: false, panda8: false, tiger: false, natural: false }
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
        RoundRecord { outcome, player_pair: false, banker_pair: false, dragon7: false, panda8: false, tiger: false, natural: false }
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
        RoundRecord { outcome, player_pair: false, banker_pair: false, dragon7: false, panda8: false, tiger: false, natural: false }
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
        RoundRecord { outcome, player_pair: pp, banker_pair: bp, dragon7: false, panda8: false, tiger: false, natural: false }
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
    fn animal_bonus_flags_land_on_the_winning_cell() {
        use crate::card::{Card, Rank, Suit};
        use crate::hand::Hand;
        let c = |rank: Rank| Card { rank, suit: Suit::Spades };
        let rr = |player: Vec<Card>, banker: Vec<Card>, outcome| RoundResult {
            player: Hand { cards: player },
            banker: Hand { cards: banker },
            outcome,
            trace: Vec::new(),
        };

        // Dragon 7: banker wins with a THREE-card 7 (2+2+3).
        let d7 = RoundRecord::from_round(&rr(
            vec![c(Rank::Two), c(Rank::Four)],
            vec![c(Rank::Two), c(Rank::Two), c(Rank::Three)],
            Outcome::BankerWin,
        ));
        assert!(d7.dragon7 && !d7.panda8);
        // a TWO-card banker 7 is an ordinary win, not a Dragon
        let plain7 = RoundRecord::from_round(&rr(
            vec![c(Rank::Two), c(Rank::Four)],
            vec![c(Rank::Three), c(Rank::Four)],
            Outcome::BankerWin,
        ));
        assert!(!plain7.dragon7);

        // Panda 8: player wins with a three-card 8.
        let p8 = RoundRecord::from_round(&rr(
            vec![c(Rank::Two), c(Rank::Three), c(Rank::Three)],
            vec![c(Rank::Two), c(Rank::Five)],
            Outcome::PlayerWin,
        ));
        assert!(p8.panda8 && !p8.dragon7);

        // Tiger: banker wins on 6 (any card count).
        let tiger = RoundRecord::from_round(&rr(
            vec![c(Rank::Two), c(Rank::Three)],
            vec![c(Rank::Two), c(Rank::Four)],
            Outcome::BankerWin,
        ));
        assert!(tiger.tiger);

        // and the flags ride onto the Big Road cell for that coup
        let road = derive_scoreboard(&[d7]);
        assert!(road.big_road.columns[0][0].dragon7);
        assert!(!road.big_road.columns[0][0].panda8);
    }

    #[test]
    fn pair_flags_ride_on_win_cell() {
        let history = vec![rec(Outcome::BankerWin, false, true)];
        let s = derive_scoreboard(&history);
        assert!(s.big_road.columns[0][0].banker_pair);
        assert!(!s.big_road.columns[0][0].player_pair);
    }

    #[test]
    fn natural_flag_lands_on_player_and_banker_wins() {
        use crate::card::{Card, Rank, Suit};
        use crate::hand::Hand;
        let c = |rank: Rank| Card { rank, suit: Suit::Spades };
        let rr = |player: Vec<Card>, banker: Vec<Card>, outcome| RoundResult {
            player: Hand { cards: player },
            banker: Hand { cards: banker },
            outcome,
            trace: Vec::new(),
        };

        // Player natural: two-card 9 beats a two-card 5.
        let player_nine = RoundRecord::from_round(&rr(
            vec![c(Rank::Four), c(Rank::Five)],
            vec![c(Rank::Two), c(Rank::Three)],
            Outcome::PlayerWin,
        ));
        assert!(player_nine.natural);

        // Banker natural: two-card 8 beats a two-card 6.
        let banker_eight = RoundRecord::from_round(&rr(
            vec![c(Rank::Two), c(Rank::Four)],
            vec![c(Rank::Three), c(Rank::Five)],
            Outcome::BankerWin,
        ));
        assert!(banker_eight.natural);

        // Both flags ride onto the win cell, same as the animal-bonus flags.
        let road = derive_scoreboard(&[player_nine, banker_eight]);
        assert!(road.big_road.columns[0][0].natural);
        assert!(road.big_road.columns[1][0].natural);
    }

    #[test]
    fn natural_flag_set_on_a_tie_when_either_side_had_one() {
        use crate::card::{Card, Rank, Suit};
        use crate::hand::Hand;
        let c = |rank: Rank| Card { rank, suit: Suit::Spades };
        let rr = |player: Vec<Card>, banker: Vec<Card>, outcome| RoundResult {
            player: Hand { cards: player },
            banker: Hand { cards: banker },
            outcome,
            trace: Vec::new(),
        };

        // 9-9 tie: both sides natural.
        let tie = RoundRecord::from_round(&rr(
            vec![c(Rank::Four), c(Rank::Five)],
            vec![c(Rank::Three), c(Rank::Six)],
            Outcome::Tie,
        ));
        assert!(tie.natural);
    }

    #[test]
    fn three_card_eight_or_nine_is_not_a_natural() {
        use crate::card::{Card, Rank, Suit};
        use crate::hand::Hand;
        let c = |rank: Rank| Card { rank, suit: Suit::Spades };
        let rr = |player: Vec<Card>, banker: Vec<Card>, outcome| RoundResult {
            player: Hand { cards: player },
            banker: Hand { cards: banker },
            outcome,
            trace: Vec::new(),
        };

        // Player wins with a three-card 8 (2+2+4) — a Panda 8, not a natural.
        let panda = RoundRecord::from_round(&rr(
            vec![c(Rank::Two), c(Rank::Two), c(Rank::Four)],
            vec![c(Rank::Two), c(Rank::Five)],
            Outcome::PlayerWin,
        ));
        assert!(panda.panda8);
        assert!(!panda.natural);
    }

    // Microbenchmark for the view-layer scoreboard memo (E2): a full recompute
    // (the old per-view cost) vs. a clone of an already-derived snapshot (the
    // cache-hit cost). Run: cargo test -p baccarat-engine --release
    //   scoreboard_recompute_vs_clone -- --ignored --nocapture
    #[test]
    #[ignore = "microbenchmark"]
    fn scoreboard_recompute_vs_clone() {
        use std::time::Instant;
        let history: Vec<RoundRecord> = (0..800)
            .map(|i| {
                win(match i % 3 {
                    0 => Outcome::BankerWin,
                    1 => Outcome::PlayerWin,
                    _ => Outcome::Tie,
                })
            })
            .collect();
        let iters = 5000;
        let mut sink = 0usize;
        let t0 = Instant::now();
        for _ in 0..iters {
            sink += derive_scoreboard(&history).bead_plate.cells.len();
        }
        let recompute = t0.elapsed();
        let snap = derive_scoreboard(&history);
        let t1 = Instant::now();
        for _ in 0..iters {
            sink += snap.clone().bead_plate.cells.len();
        }
        let clone = t1.elapsed();
        eprintln!(
            "recompute {:?} vs clone {:?}  ({:.1}x faster on a cache hit)  [{}]",
            recompute,
            clone,
            recompute.as_secs_f64() / clone.as_secs_f64().max(1e-9),
            sink
        );
    }
}
