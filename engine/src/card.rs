use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum Suit {
    Clubs,
    Diamonds,
    Hearts,
    Spades,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum Rank {
    Ace,
    Two,
    Three,
    Four,
    Five,
    Six,
    Seven,
    Eight,
    Nine,
    Ten,
    Jack,
    Queen,
    King,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct Card {
    pub rank: Rank,
    pub suit: Suit,
}

impl Card {
    /// Baccarat value: Ace = 1, 2–9 = face value, 10/J/Q/K = 0.
    pub fn value(self) -> u8 {
        match self.rank {
            Rank::Ace => 1,
            Rank::Two => 2,
            Rank::Three => 3,
            Rank::Four => 4,
            Rank::Five => 5,
            Rank::Six => 6,
            Rank::Seven => 7,
            Rank::Eight => 8,
            Rank::Nine => 9,
            Rank::Ten | Rank::Jack | Rank::Queen | Rank::King => 0,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn card(rank: Rank) -> Card {
        Card { rank, suit: Suit::Spades }
    }

    #[test]
    fn ace_is_one() {
        assert_eq!(card(Rank::Ace).value(), 1);
    }

    #[test]
    fn pip_cards_are_face_value() {
        assert_eq!(card(Rank::Five).value(), 5);
        assert_eq!(card(Rank::Nine).value(), 9);
    }

    #[test]
    fn ten_and_faces_are_zero() {
        assert_eq!(card(Rank::Ten).value(), 0);
        assert_eq!(card(Rank::Jack).value(), 0);
        assert_eq!(card(Rank::Queen).value(), 0);
        assert_eq!(card(Rank::King).value(), 0);
    }
}
