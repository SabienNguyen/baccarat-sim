use crate::card::Card;

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Hand {
    pub cards: Vec<Card>,
}

impl Hand {
    /// Hand value: sum of card values, modulo 10.
    pub fn total(&self) -> u8 {
        let sum: u32 = self.cards.iter().map(|c| c.value() as u32).sum();
        (sum % 10) as u8
    }

    /// A natural is a total of 8 or 9 on exactly the first two cards.
    pub fn is_natural(&self) -> bool {
        self.cards.len() == 2 && matches!(self.total(), 8 | 9)
    }

    /// A pair is the first two cards sharing a rank (for Pair side bets).
    pub fn is_pair(&self) -> bool {
        self.cards.len() >= 2 && self.cards[0].rank == self.cards[1].rank
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::card::{Card, Rank, Suit};

    fn c(rank: Rank) -> Card {
        Card { rank, suit: Suit::Hearts }
    }

    #[test]
    fn total_is_last_digit_of_sum() {
        // 7 + 8 = 15 -> 5
        let h = Hand { cards: vec![c(Rank::Seven), c(Rank::Eight)] };
        assert_eq!(h.total(), 5);
    }

    #[test]
    fn faces_count_as_zero_in_total() {
        // King(0) + Nine(9) = 9
        let h = Hand { cards: vec![c(Rank::King), c(Rank::Nine)] };
        assert_eq!(h.total(), 9);
    }

    #[test]
    fn natural_is_two_card_eight_or_nine() {
        let nine = Hand { cards: vec![c(Rank::Four), c(Rank::Five)] };
        assert!(nine.is_natural());
        let seven = Hand { cards: vec![c(Rank::Three), c(Rank::Four)] };
        assert!(!seven.is_natural());
    }

    #[test]
    fn three_card_eight_is_not_a_natural() {
        let h = Hand { cards: vec![c(Rank::Two), c(Rank::Two), c(Rank::Four)] };
        assert_eq!(h.total(), 8);
        assert!(!h.is_natural());
    }

    #[test]
    fn pair_is_matching_first_two_ranks() {
        let pair = Hand { cards: vec![c(Rank::Seven), c(Rank::Seven)] };
        assert!(pair.is_pair());
        let non_pair = Hand { cards: vec![c(Rank::Seven), c(Rank::Eight)] };
        assert!(!non_pair.is_pair());
    }
}
