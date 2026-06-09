use crate::round::{Outcome, RoundResult};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum BetSpot {
    Player,
    Banker,
    Tie,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Bet {
    pub spot: BetSpot,
    /// Stake in cents. Callers must pass a non-negative amount; settlement
    /// assumes a positive stake (a negative amount would invert win/loss).
    pub amount: i64,
}

/// Net change to the bettor's bankroll, in cents, for one bet against an outcome.
/// Positive = profit (stake already returned conceptually), negative = stake lost,
/// zero = push.
pub fn settle(bet: Bet, outcome: Outcome) -> i64 {
    match (bet.spot, outcome) {
        // Player bet.
        (BetSpot::Player, Outcome::PlayerWin) => bet.amount,
        (BetSpot::Player, Outcome::BankerWin) => -bet.amount,
        (BetSpot::Player, Outcome::Tie) => 0,

        // Banker bet: 5% commission on a win (integer cents, rounded down).
        (BetSpot::Banker, Outcome::BankerWin) => {
            let commission = bet.amount * 5 / 100;
            bet.amount - commission
        }
        (BetSpot::Banker, Outcome::PlayerWin) => -bet.amount,
        (BetSpot::Banker, Outcome::Tie) => 0,

        // Tie bet pays 8:1, loses otherwise.
        (BetSpot::Tie, Outcome::Tie) => bet.amount * 8,
        (BetSpot::Tie, _) => -bet.amount,
    }
}

/// Which commission rules apply to the main Banker bet.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum Ruleset {
    /// Traditional: 5% commission on banker wins.
    Commission,
    /// EZ Baccarat: no commission, but a banker win with a three-card total
    /// of 7 ("Dragon 7") pushes the Banker bet.
    EzBaccarat,
}

/// Settle a main bet using the chosen ruleset. Needs the full round to detect
/// the EZ Baccarat three-card-7 bar.
pub fn settle_with(bet: Bet, round: &RoundResult, ruleset: Ruleset) -> i64 {
    match ruleset {
        Ruleset::Commission => settle(bet, round.outcome),
        Ruleset::EzBaccarat => match (bet.spot, round.outcome) {
            (BetSpot::Banker, Outcome::BankerWin) => {
                let dragon7 = round.banker.total() == 7 && round.banker.cards.len() == 3;
                if dragon7 {
                    0 // Dragon 7 bar: banker bet pushes
                } else {
                    bet.amount // no commission in EZ
                }
            }
            _ => settle(bet, round.outcome),
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    use crate::card::{Card, Rank, Suit};
    use crate::hand::Hand;
    use crate::round::RoundResult;

    fn bet(spot: BetSpot, amount: i64) -> Bet {
        Bet { spot, amount }
    }

    fn rr(player: Vec<Card>, banker: Vec<Card>, outcome: Outcome) -> RoundResult {
        RoundResult {
            player: Hand { cards: player },
            banker: Hand { cards: banker },
            outcome,
            trace: Vec::new(),
        }
    }

    fn c(rank: Rank) -> Card {
        Card { rank, suit: Suit::Spades }
    }

    #[test]
    fn player_bet_wins_even_money() {
        let b = bet(BetSpot::Player, 10_000); // $100.00
        assert_eq!(settle(b, Outcome::PlayerWin), 10_000);
    }

    #[test]
    fn player_bet_loses_stake() {
        let b = bet(BetSpot::Player, 10_000);
        assert_eq!(settle(b, Outcome::BankerWin), -10_000);
    }

    #[test]
    fn player_and_banker_push_on_tie() {
        assert_eq!(settle(bet(BetSpot::Player, 10_000), Outcome::Tie), 0);
        assert_eq!(settle(bet(BetSpot::Banker, 10_000), Outcome::Tie), 0);
    }

    #[test]
    fn banker_bet_wins_minus_five_percent_commission() {
        // $100 stake -> $95 net profit (5% = $5 commission).
        let b = bet(BetSpot::Banker, 10_000);
        assert_eq!(settle(b, Outcome::BankerWin), 9_500);
    }

    #[test]
    fn banker_commission_rounds_down_to_the_cent() {
        // $25 stake -> 5% = $1.25 -> net +$23.75.
        let b = bet(BetSpot::Banker, 2_500);
        assert_eq!(settle(b, Outcome::BankerWin), 2_375);
    }

    #[test]
    fn banker_bet_loses_stake_on_player_win() {
        assert_eq!(settle(bet(BetSpot::Banker, 10_000), Outcome::PlayerWin), -10_000);
    }

    #[test]
    fn tie_bet_pays_eight_to_one() {
        assert_eq!(settle(bet(BetSpot::Tie, 1_000), Outcome::Tie), 8_000);
    }

    #[test]
    fn tie_bet_loses_when_not_a_tie() {
        assert_eq!(settle(bet(BetSpot::Tie, 1_000), Outcome::PlayerWin), -1_000);
        assert_eq!(settle(bet(BetSpot::Tie, 1_000), Outcome::BankerWin), -1_000);
    }

    #[test]
    fn ez_banker_win_pays_even_money_no_commission() {
        let r = rr(vec![c(Rank::Five), c(Rank::Two)], vec![c(Rank::Six), c(Rank::Three)], Outcome::BankerWin);
        let b = Bet { spot: BetSpot::Banker, amount: 10_000 };
        assert_eq!(settle_with(b, &r, Ruleset::EzBaccarat), 10_000);
    }

    #[test]
    fn ez_banker_three_card_seven_is_a_push() {
        let r = rr(
            vec![c(Rank::Five), c(Rank::Two)],
            vec![c(Rank::Two), c(Rank::Two), c(Rank::Three)], // 3-card total 7
            Outcome::BankerWin,
        );
        let b = Bet { spot: BetSpot::Banker, amount: 10_000 };
        assert_eq!(settle_with(b, &r, Ruleset::EzBaccarat), 0);
    }

    #[test]
    fn ez_player_bet_unaffected_by_bar() {
        let r = rr(
            vec![c(Rank::Five), c(Rank::Two)],
            vec![c(Rank::Two), c(Rank::Two), c(Rank::Three)],
            Outcome::BankerWin,
        );
        let b = Bet { spot: BetSpot::Player, amount: 10_000 };
        assert_eq!(settle_with(b, &r, Ruleset::EzBaccarat), -10_000);
    }

    #[test]
    fn commission_ruleset_matches_legacy_settle() {
        let r = rr(vec![c(Rank::Five), c(Rank::Two)], vec![c(Rank::Six), c(Rank::Three)], Outcome::BankerWin);
        let b = Bet { spot: BetSpot::Banker, amount: 10_000 };
        assert_eq!(settle_with(b, &r, Ruleset::Commission), settle(b, Outcome::BankerWin));
    }
}
