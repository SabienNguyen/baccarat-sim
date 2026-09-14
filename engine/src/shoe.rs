use crate::card::{Card, Rank, Suit};
use rand::seq::SliceRandom;
use rand::SeedableRng;
use serde::{Deserialize, Serialize};
// Pinned by name rather than `rand::rngs::StdRng`: StdRng's algorithm may
// change across `rand` releases, which would silently break every
// "same seed ⇒ same shoe" guarantee. ChaCha12 is what rand 0.8's StdRng
// resolves to today, so the streams are bit-identical.
use rand_chacha::ChaCha12Rng;

pub struct Shoe {
    cards: Vec<Card>,
}

const RANKS: [Rank; 13] = [
    Rank::Ace, Rank::Two, Rank::Three, Rank::Four, Rank::Five, Rank::Six,
    Rank::Seven, Rank::Eight, Rank::Nine, Rank::Ten, Rank::Jack, Rank::Queen, Rank::King,
];
const SUITS: [Suit; 4] = [Suit::Clubs, Suit::Diamonds, Suit::Hearts, Suit::Spades];
const DECKS: usize = 8;

/// The cut card sits this many cards from the back of the shoe; once play
/// reaches it, the coup in progress finishes, one more hand is dealt, and
/// then the shoe ends.
pub const CUT_CARD: usize = 14;

/// The cut card flips on at `remaining <= CUT_CARD`; the hand that set it
/// started with at least `CUT_CARD + 1` cards and used at most 6, so at
/// least `CUT_CARD - 5` remain for the one more hand, which itself needs at
/// most 6. Enforce that invariant at compile time so lowering CUT_CARD
/// can't quietly leave too few cards for the final hand.
const _: () = assert!(CUT_CARD >= 12, "CUT_CARD must cover a cut-card hand plus one more hand");

/// Cut position is a fraction of the shoe in `0..=1000`; the pit refuses a
/// cut within roughly a deck of either end.
pub const CUT_MIN: u16 = 50;
pub const CUT_MAX: u16 = 950;

/// Clamp a raw cut position into the range the pit allows.
pub fn clamp_cut(position: u16) -> u16 {
    position.clamp(CUT_MIN, CUT_MAX)
}

/// What the cutter and everyone else saw at the cut: the position cut at,
/// the card turned to start the burn, and how many cards were burned after
/// it.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "wasm", derive(tsify_next::Tsify))]
#[cfg_attr(feature = "wasm", tsify(into_wasm_abi, from_wasm_abi))]
pub struct CutReveal {
    pub position: u16,
    pub turned: Card,
    pub burned: u8,
}

impl Shoe {
    /// Build and shuffle an 8-deck shoe from a fixed seed, then perform the
    /// casino burn ritual: the first card is turned and that many more cards
    /// (face cards counting ten) are discarded before play.
    pub fn new_seeded(seed: u64) -> Self {
        let mut shoe = Shoe {
            cards: Self::built_and_shuffled(seed),
        };
        shoe.burn();
        shoe
    }

    /// Build and shuffle an 8-deck shoe from a fixed seed, then cut it at
    /// `position` (a fraction of the shoe in `0..=1000`, clamped to
    /// `CUT_MIN..=CUT_MAX`) and run the burn ritual. Returns the shoe and a
    /// record of what the cut revealed, for the cut ceremony to replay.
    pub fn new_cut(seed: u64, position: u16) -> (Self, CutReveal) {
        let p = clamp_cut(position);
        let mut cards = Self::built_and_shuffled(seed);
        // The TOP of the shoe is the END of the vector (`draw` pops), so
        // the packet above the cut must move to the bottom: rotating the
        // last `idx` cards (the top packet) to the front.
        let idx = (p as usize * cards.len()) / 1000;
        cards.rotate_right(idx);
        let mut shoe = Shoe { cards };
        let (turned, burned) = shoe.burn();
        (shoe, CutReveal { position: p, turned, burned })
    }

    /// Build a fresh 8-deck shoe and shuffle it deterministically from `seed`.
    fn built_and_shuffled(seed: u64) -> Vec<Card> {
        let mut cards = Vec::with_capacity(DECKS * 52);
        for _ in 0..DECKS {
            for &suit in &SUITS {
                for &rank in &RANKS {
                    cards.push(Card { rank, suit });
                }
            }
        }
        let mut rng = ChaCha12Rng::seed_from_u64(seed);
        cards.shuffle(&mut rng);
        cards
    }

    /// Burn the turned card plus its face value in cards (10/J/Q/K burn ten).
    /// Returns the turned card and how many more were burned after it.
    fn burn(&mut self) -> (Card, u8) {
        let turned = self.draw();
        let count = match turned.value() {
            0 => 10,
            v => v as usize,
        };
        let burned = count.min(self.remaining());
        for _ in 0..burned {
            let _ = self.draw();
        }
        (turned, burned as u8)
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
    fn fresh_shoe_is_eight_decks_minus_the_burn() {
        let shoe = Shoe::new_seeded(42);
        // 416 cards less the turned card and 1-10 burned behind it.
        assert!(shoe.remaining() >= 405 && shoe.remaining() <= 414, "got {}", shoe.remaining());
    }

    #[test]
    fn drawing_reduces_remaining() {
        let mut shoe = Shoe::new_seeded(42);
        let before = shoe.remaining();
        let _ = shoe.draw();
        assert_eq!(shoe.remaining(), before - 1);
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

    #[test]
    fn cut_position_is_clamped_to_the_pit_range() {
        assert_eq!(clamp_cut(0), 50);
        assert_eq!(clamp_cut(1000), 950);
        assert_eq!(clamp_cut(500), 500);
    }

    #[test]
    fn same_seed_different_cut_differs_after_the_cut() {
        let (mut a, reveal_a) = Shoe::new_cut(7, 200);
        let (mut b, reveal_b) = Shoe::new_cut(7, 800);
        // Every card is accounted for on both sides: what's left, plus the
        // turned card, plus the burned cards, sums to a full 8-deck shoe.
        assert_eq!(a.remaining() + 1 + reveal_a.burned as usize, 416);
        assert_eq!(b.remaining() + 1 + reveal_b.burned as usize, 416);
        assert_ne!(a.draw(), b.draw());
    }

    #[test]
    fn cut_reveal_matches_the_burn() {
        let (shoe, reveal) = Shoe::new_cut(42, 500);
        let expected = match reveal.turned.value() {
            0 => 10,
            v => v as usize,
        };
        assert_eq!(reveal.burned as usize, expected);
        assert_eq!(shoe.remaining(), 416 - 1 - reveal.burned as usize);
    }

    #[test]
    fn cut_is_deterministic() {
        let (mut a, reveal_a) = Shoe::new_cut(99, 333);
        let (mut b, reveal_b) = Shoe::new_cut(99, 333);
        assert_eq!(reveal_a, reveal_b);
        for _ in 0..20 {
            assert_eq!(a.draw(), b.draw());
        }
    }
}
