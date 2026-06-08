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

fn build_big_road(_history: &[RoundRecord]) -> BigRoad {
    BigRoad { columns: Vec::new() }
}

fn derived_road(_big: &BigRoad, _offset: usize) -> DerivedRoad {
    DerivedRoad { columns: Vec::new() }
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
