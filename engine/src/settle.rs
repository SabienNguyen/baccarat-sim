use crate::round::Outcome;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum BetSpot {
    Player,
    Banker,
    Tie,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Bet {
    pub spot: BetSpot,
    /// Stake in cents.
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

#[cfg(test)]
mod tests {
    use super::*;

    fn bet(spot: BetSpot, amount: i64) -> Bet {
        Bet { spot, amount }
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
}
