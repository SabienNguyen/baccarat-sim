use crate::card::{Card, Rank, Suit};
use rand::seq::SliceRandom;
use rand::{rngs::StdRng, SeedableRng};

pub struct Shoe {
    cards: Vec<Card>,
}

const RANKS: [Rank; 13] = [
    Rank::Ace, Rank::Two, Rank::Three, Rank::Four, Rank::Five, Rank::Six,
    Rank::Seven, Rank::Eight, Rank::Nine, Rank::Ten, Rank::Jack, Rank::Queen, Rank::King,
];
const SUITS: [Suit; 4] = [Suit::Clubs, Suit::Diamonds, Suit::Hearts, Suit::Spades];
const DECKS: usize = 8;

impl Shoe {
    /// Build and shuffle an 8-deck shoe from a fixed seed.
    pub fn new_seeded(seed: u64) -> Self {
        let mut cards = Vec::with_capacity(DECKS * 52);
        for _ in 0..DECKS {
            for &suit in &SUITS {
                for &rank in &RANKS {
                    cards.push(Card { rank, suit });
                }
            }
        }
        let mut rng = StdRng::seed_from_u64(seed);
        cards.shuffle(&mut rng);
        Shoe { cards }
    }

    /// Cards left in the shoe.
    pub fn remaining(&self) -> usize {
        self.cards.len()
    }

    /// Draw the next card. Panics if empty.
    pub fn draw(&mut self) -> Card {
        self.cards.pop().expect("drew from an empty shoe")
    }
}

impl Iterator for Shoe {
    type Item = Card;
    fn next(&mut self) -> Option<Card> {
        self.cards.pop()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fresh_shoe_has_416_cards() {
        let shoe = Shoe::new_seeded(42);
        assert_eq!(shoe.remaining(), 416);
    }

    #[test]
    fn drawing_reduces_remaining() {
        let mut shoe = Shoe::new_seeded(42);
        let _ = shoe.draw();
        assert_eq!(shoe.remaining(), 415);
    }

    #[test]
    fn same_seed_gives_same_order() {
        let mut a = Shoe::new_seeded(7);
        let mut b = Shoe::new_seeded(7);
        for _ in 0..20 {
            assert_eq!(a.draw(), b.draw());
        }
    }

    #[test]
    fn different_seeds_differ() {
        let mut a = Shoe::new_seeded(1);
        let mut b = Shoe::new_seeded(2);
        // Collect first 30 draws; overwhelmingly likely to differ somewhere.
        let av: Vec<_> = (0..30).map(|_| a.draw()).collect();
        let bv: Vec<_> = (0..30).map(|_| b.draw()).collect();
        assert_ne!(av, bv);
    }
}
