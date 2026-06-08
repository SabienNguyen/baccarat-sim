use crate::hand::Hand;
use crate::round::{Outcome, RoundResult};

/// Which main hand a side bet refers to.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum BetSide {
    Player,
    Banker,
}

/// Pair side bet: pays 11:1 if the given hand's first two cards are a pair.
pub fn pair_pays(hand: &Hand, stake: i64) -> i64 {
    if hand.is_pair() {
        stake * 11
    } else {
        -stake
    }
}

/// Dragon 7 (EZ Baccarat): 40:1 if the Banker wins with a three-card total of 7.
pub fn dragon7_pays(round: &RoundResult, stake: i64) -> i64 {
    let hit = round.outcome == Outcome::BankerWin
        && round.banker.total() == 7
        && round.banker.cards.len() == 3;
    if hit {
        stake * 40
    } else {
        -stake
    }
}

/// Panda 8 (EZ Baccarat): 25:1 if the Player wins with a three-card total of 8.
pub fn panda8_pays(round: &RoundResult, stake: i64) -> i64 {
    let hit = round.outcome == Outcome::PlayerWin
        && round.player.total() == 8
        && round.player.cards.len() == 3;
    if hit {
        stake * 25
    } else {
        -stake
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::card::{Card, Rank, Suit};
    use crate::hand::Hand;

    fn card(rank: Rank, suit: Suit) -> Card {
        Card { rank, suit }
    }

    fn hand(cards: Vec<Card>) -> Hand {
        Hand { cards }
    }

    #[test]
    fn pair_pays_eleven_to_one() {
        let h = hand(vec![
            card(Rank::Seven, Suit::Clubs),
            card(Rank::Seven, Suit::Hearts),
        ]);
        assert_eq!(pair_pays(&h, 1_000), 11_000);
    }

    #[test]
    fn non_pair_loses_stake() {
        let h = hand(vec![
            card(Rank::Seven, Suit::Clubs),
            card(Rank::Eight, Suit::Hearts),
        ]);
        assert_eq!(pair_pays(&h, 1_000), -1_000);
    }
}

#[cfg(test)]
mod ez_side_tests {
    use super::*;
    use crate::card::{Card, Rank, Suit};
    use crate::hand::Hand;
    use crate::round::{Outcome, RoundResult};

    fn c(rank: Rank) -> Card {
        Card { rank, suit: Suit::Spades }
    }

    fn rr(player: Vec<Card>, banker: Vec<Card>, outcome: Outcome) -> RoundResult {
        RoundResult {
            player: Hand { cards: player },
            banker: Hand { cards: banker },
            outcome,
            trace: Vec::new(),
        }
    }

    #[test]
    fn dragon7_pays_forty_on_three_card_banker_seven() {
        let r = rr(
            vec![c(Rank::Five), c(Rank::Two)],
            vec![c(Rank::Two), c(Rank::Two), c(Rank::Three)],
            Outcome::BankerWin,
        );
        assert_eq!(dragon7_pays(&r, 100), 4_000);
    }

    #[test]
    fn dragon7_loses_on_two_card_banker_seven() {
        let r = rr(vec![c(Rank::Five), c(Rank::Two)], vec![c(Rank::Three), c(Rank::Four)], Outcome::BankerWin);
        assert_eq!(dragon7_pays(&r, 100), -100);
    }

    #[test]
    fn panda8_pays_twentyfive_on_three_card_player_eight() {
        let r = rr(
            vec![c(Rank::Two), c(Rank::Two), c(Rank::Four)],
            vec![c(Rank::Three), c(Rank::Four)],
            Outcome::PlayerWin,
        );
        assert_eq!(panda8_pays(&r, 100), 2_500);
    }

    #[test]
    fn panda8_loses_on_two_card_player_eight() {
        let r = rr(vec![c(Rank::Three), c(Rank::Five)], vec![c(Rank::Two), c(Rank::Four)], Outcome::PlayerWin);
        assert_eq!(panda8_pays(&r, 100), -100);
    }
}
