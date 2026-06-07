# Baccarat Engine Core — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a tested Rust library that models the core Vegas (Punto Banco) baccarat rules — card values, hand totals, naturals, the player and banker third-card tableau, round resolution, an 8-deck shoe, and main-bet settlement with banker commission.

**Architecture:** A pure Rust crate (`engine/`) with no UI and no WASM bindings yet (those come in a later plan). Logic is split into small, single-responsibility modules (`card`, `hand`, `rules`, `shoe`, `round`, `settle`). Dealing is decoupled from randomness: round logic consumes any iterator of cards, so tests deal fixed cards deterministically while real play deals from a seeded shoe. Money is integer cents (`i64`) — no floats — so commission and payouts are exact.

**Tech Stack:** Rust 2021, Cargo, `rand` 0.8 (seeded `StdRng` for the shoe). Tests use the built-in test harness.

---

## File Structure

- `engine/Cargo.toml` — crate manifest, `rand` dependency.
- `engine/src/lib.rs` — module declarations and re-exports.
- `engine/src/card.rs` — `Rank`, `Suit`, `Card`, and baccarat card value.
- `engine/src/hand.rs` — `Hand` (cards + total, natural, pair).
- `engine/src/rules.rs` — pure third-card decision functions (`player_draws`, `banker_draws`).
- `engine/src/round.rs` — `Outcome`, `RoundResult`, and `play_round` driven by a card source.
- `engine/src/shoe.rs` — 8-deck `Shoe` with seeded shuffle and `draw`.
- `engine/src/settle.rs` — `BetSpot`, `Bet`, and main-bet settlement with commission.

Each module owns one concern. `rules.rs` is intentionally pure (no shoe, no state) so the tableau can be exhaustively table-tested.

---

### Task 1: Crate scaffold

**Files:**
- Create: `engine/Cargo.toml`
- Create: `engine/src/lib.rs`

- [ ] **Step 1: Write the manifest**

`engine/Cargo.toml`:

```toml
[package]
name = "baccarat-engine"
version = "0.1.0"
edition = "2021"

[dependencies]
rand = "0.8"
```

- [ ] **Step 2: Write a placeholder lib with a smoke test**

`engine/src/lib.rs`:

```rust
//! Baccarat (Punto Banco) rules engine — pure logic, no UI.

#[cfg(test)]
mod smoke {
    #[test]
    fn crate_builds() {
        assert_eq!(2 + 2, 4);
    }
}
```

- [ ] **Step 3: Run the test to verify the crate builds**

Run: `cd engine && cargo test`
Expected: PASS — `test smoke::crate_builds ... ok`

- [ ] **Step 4: Commit**

```bash
git add engine/Cargo.toml engine/src/lib.rs
git commit -m "chore: scaffold baccarat-engine crate"
```

---

### Task 2: Card value

A card's baccarat value: Ace = 1, 2–9 = face, 10/J/Q/K = 0.

**Files:**
- Create: `engine/src/card.rs`
- Modify: `engine/src/lib.rs`
- Test: in `engine/src/card.rs`

- [ ] **Step 1: Declare the module**

Add to top of `engine/src/lib.rs` (above the `smoke` mod):

```rust
pub mod card;
```

- [ ] **Step 2: Write failing tests**

`engine/src/card.rs`:

```rust
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Suit {
    Clubs,
    Diamonds,
    Hearts,
    Spades,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
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

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Card {
    pub rank: Rank,
    pub suit: Suit,
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
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd engine && cargo test card::`
Expected: FAIL — `no method named 'value' found`

- [ ] **Step 4: Implement `value`**

Add to `engine/src/card.rs` (above the `tests` mod):

```rust
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
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd engine && cargo test card::`
Expected: PASS — 3 tests ok

- [ ] **Step 6: Commit**

```bash
git add engine/src/card.rs engine/src/lib.rs
git commit -m "feat: card ranks, suits, and baccarat values"
```

---

### Task 3: Hand total, natural, and pair

A hand's value is the last digit of the sum of card values. A two-card 8 or 9 is a "natural". A pair is two opening cards of the same rank.

**Files:**
- Create: `engine/src/hand.rs`
- Modify: `engine/src/lib.rs`
- Test: in `engine/src/hand.rs`

- [ ] **Step 1: Declare the module**

Add to `engine/src/lib.rs` under the existing `pub mod card;`:

```rust
pub mod hand;
```

- [ ] **Step 2: Write failing tests**

`engine/src/hand.rs`:

```rust
use crate::card::Card;

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Hand {
    pub cards: Vec<Card>,
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
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd engine && cargo test hand::`
Expected: FAIL — `no method named 'total'`

- [ ] **Step 4: Implement the methods**

Add to `engine/src/hand.rs` (above the `tests` mod, below the struct):

```rust
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
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd engine && cargo test hand::`
Expected: PASS — 5 tests ok

- [ ] **Step 6: Commit**

```bash
git add engine/src/hand.rs engine/src/lib.rs
git commit -m "feat: hand total, natural, and pair detection"
```

---

### Task 4: Player third-card rule

Pure function: when neither hand has a natural, the player draws a third card on totals 0–5 and stands on 6–7.

**Files:**
- Create: `engine/src/rules.rs`
- Modify: `engine/src/lib.rs`
- Test: in `engine/src/rules.rs`

- [ ] **Step 1: Declare the module**

Add to `engine/src/lib.rs`:

```rust
pub mod rules;
```

- [ ] **Step 2: Write failing tests**

`engine/src/rules.rs`:

```rust
#[cfg(test)]
mod player_tests {
    use super::*;

    #[test]
    fn player_draws_on_zero_through_five() {
        for total in 0..=5 {
            assert!(player_draws(total), "player should draw on {total}");
        }
    }

    #[test]
    fn player_stands_on_six_and_seven() {
        assert!(!player_draws(6));
        assert!(!player_draws(7));
    }
}
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd engine && cargo test rules::player`
Expected: FAIL — `cannot find function 'player_draws'`

- [ ] **Step 4: Implement `player_draws`**

Add to the top of `engine/src/rules.rs`:

```rust
/// Player draws a third card on totals 0–5, stands on 6–7.
/// Only called when neither hand is a natural.
pub fn player_draws(player_total: u8) -> bool {
    player_total <= 5
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd engine && cargo test rules::player`
Expected: PASS — 2 tests ok

- [ ] **Step 6: Commit**

```bash
git add engine/src/rules.rs engine/src/lib.rs
git commit -m "feat: player third-card rule"
```

---

### Task 5: Banker third-card tableau

The banker's draw decision depends on the banker's total and the value of the player's third card (or whether the player stood). This is the one genuinely fiddly rule — test it exhaustively.

**Files:**
- Modify: `engine/src/rules.rs`
- Test: in `engine/src/rules.rs`

- [ ] **Step 1: Write failing tests (exhaustive table)**

Add to `engine/src/rules.rs` a second test module:

```rust
#[cfg(test)]
mod banker_tests {
    use super::*;

    // When the player STOOD (no third card), banker draws on 0–5, stands 6–7.
    #[test]
    fn banker_when_player_stood() {
        for total in 0..=5 {
            assert!(banker_draws(total, None), "banker draws on {total} when player stood");
        }
        assert!(!banker_draws(6, None));
        assert!(!banker_draws(7, None));
    }

    // Exhaustive: banker total 0..=7 x player third card 0..=9.
    // `expected[bt][pt]` is whether the banker draws.
    #[test]
    fn banker_tableau_is_exhaustive() {
        // pt index = player's third card value 0..=9
        let expected: [[bool; 10]; 8] = [
            // bt 0: always draw
            [true, true, true, true, true, true, true, true, true, true],
            // bt 1: always draw
            [true, true, true, true, true, true, true, true, true, true],
            // bt 2: always draw
            [true, true, true, true, true, true, true, true, true, true],
            // bt 3: draw unless player third card is 8
            [true, true, true, true, true, true, true, true, false, true],
            // bt 4: draw if player third card 2..=7
            [false, false, true, true, true, true, true, true, false, false],
            // bt 5: draw if player third card 4..=7
            [false, false, false, false, true, true, true, true, false, false],
            // bt 6: draw if player third card 6..=7
            [false, false, false, false, false, false, true, true, false, false],
            // bt 7: always stand
            [false, false, false, false, false, false, false, false, false, false],
        ];

        for bt in 0u8..=7 {
            for pt in 0u8..=9 {
                assert_eq!(
                    banker_draws(bt, Some(pt)),
                    expected[bt as usize][pt as usize],
                    "banker total {bt}, player third {pt}"
                );
            }
        }
    }
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd engine && cargo test rules::banker`
Expected: FAIL — `cannot find function 'banker_draws'`

- [ ] **Step 3: Implement `banker_draws`**

Add to `engine/src/rules.rs` (below `player_draws`):

```rust
/// Banker third-card rule.
/// `player_third` is `Some(value)` if the player drew a third card, or `None`
/// if the player stood. Only called when neither hand is a natural and the
/// banker total is 0–7 (banker stands automatically on a two-card 8/9 natural,
/// handled by the round logic before this is consulted).
pub fn banker_draws(banker_total: u8, player_third: Option<u8>) -> bool {
    match player_third {
        None => banker_total <= 5,
        Some(pt) => match banker_total {
            0 | 1 | 2 => true,
            3 => pt != 8,
            4 => (2..=7).contains(&pt),
            5 => (4..=7).contains(&pt),
            6 => (6..=7).contains(&pt),
            _ => false, // 7 (and any higher, defensively) stands
        },
    }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd engine && cargo test rules::banker`
Expected: PASS — 2 tests ok (the exhaustive one covers all 80 combinations)

- [ ] **Step 5: Commit**

```bash
git add engine/src/rules.rs
git commit -m "feat: banker third-card tableau with exhaustive tests"
```

---

### Task 6: Round play and outcome

Drive a full round from a card source: deal P, B, P, B; honor naturals; apply the player then banker draw rules; decide the outcome. Decoupling from the shoe (any `Iterator<Item = Card>`) makes rounds deterministically testable.

**Files:**
- Create: `engine/src/round.rs`
- Modify: `engine/src/lib.rs`
- Test: in `engine/src/round.rs`

- [ ] **Step 1: Declare the module**

Add to `engine/src/lib.rs`:

```rust
pub mod round;
```

- [ ] **Step 2: Write failing tests**

`engine/src/round.rs`:

```rust
use crate::card::Card;
use crate::hand::Hand;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Outcome {
    PlayerWin,
    BankerWin,
    Tie,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RoundResult {
    pub player: Hand,
    pub banker: Hand,
    pub outcome: Outcome,
    /// Human-readable trace of each drawing decision, for explain-the-rule mode.
    pub trace: Vec<String>,
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::card::{Card, Rank, Suit};

    fn c(rank: Rank) -> Card {
        Card { rank, suit: Suit::Clubs }
    }

    // Deal order is P, B, P, B, then player's third, then banker's third.
    #[test]
    fn natural_nine_ends_immediately() {
        // Player: 4,5 = 9 (natural). Banker: 2,3 = 5. No draws.
        let cards = vec![c(Rank::Four), c(Rank::Two), c(Rank::Five), c(Rank::Three)];
        let r = play_round(&mut cards.into_iter());
        assert_eq!(r.player.cards.len(), 2);
        assert_eq!(r.banker.cards.len(), 2);
        assert_eq!(r.outcome, Outcome::PlayerWin);
    }

    #[test]
    fn player_draws_then_banker_stands_on_seven() {
        // Player: 2,3 = 5 -> draws. Banker: 3,4 = 7 -> stands.
        // Player third: 4 -> player total 9. Banker stays 7. Player wins.
        let cards = vec![
            c(Rank::Two), c(Rank::Three), // P
            c(Rank::Three), c(Rank::Four), // B
            c(Rank::Four),                 // P third
        ];
        let r = play_round(&mut cards.into_iter());
        assert_eq!(r.player.cards.len(), 3);
        assert_eq!(r.banker.cards.len(), 2);
        assert_eq!(r.player.total(), 9);
        assert_eq!(r.banker.total(), 7);
        assert_eq!(r.outcome, Outcome::PlayerWin);
    }

    #[test]
    fn both_draw_and_tie() {
        // Player: 2,2 = 4 -> draws. Banker: 2,2 = 4 -> with player third 2, bt4 draws.
        // Player third: 2 -> player 6. Banker third: 2 -> banker 6. Tie.
        let cards = vec![
            c(Rank::Two), c(Rank::Two), // P = 4
            c(Rank::Two), c(Rank::Two), // B = 4
            c(Rank::Two),               // P third -> 6
            c(Rank::Two),               // B third -> 6
        ];
        let r = play_round(&mut cards.into_iter());
        assert_eq!(r.player.total(), 6);
        assert_eq!(r.banker.total(), 6);
        assert_eq!(r.outcome, Outcome::Tie);
    }
}
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd engine && cargo test round::`
Expected: FAIL — `cannot find function 'play_round'`

- [ ] **Step 4: Implement `play_round`**

Add to `engine/src/round.rs` (above the `tests` mod):

```rust
use crate::rules::{banker_draws, player_draws};

fn decide_outcome(player: &Hand, banker: &Hand) -> Outcome {
    match player.total().cmp(&banker.total()) {
        std::cmp::Ordering::Greater => Outcome::PlayerWin,
        std::cmp::Ordering::Less => Outcome::BankerWin,
        std::cmp::Ordering::Equal => Outcome::Tie,
    }
}

/// Play one round, drawing cards from `source` in dealing order.
/// Panics if the source runs dry (callers guarantee a sufficiently full shoe).
pub fn play_round(source: &mut impl Iterator<Item = Card>) -> RoundResult {
    let mut next = || source.next().expect("card source exhausted mid-round");
    let mut trace: Vec<String> = Vec::new();

    let mut player = Hand { cards: vec![next(), next()] };
    let mut banker = Hand { cards: vec![next(), next()] };

    // Naturals end the round immediately, no third cards.
    if player.is_natural() || banker.is_natural() {
        trace.push(format!(
            "Natural — player {} vs banker {}, no draws.",
            player.total(),
            banker.total()
        ));
        let outcome = decide_outcome(&player, &banker);
        return RoundResult { player, banker, outcome, trace };
    }

    // Player draws on 0–5.
    let player_third: Option<u8> = if player_draws(player.total()) {
        let card = next();
        trace.push(format!(
            "Player {} -> draws a third card ({}).",
            player.total() - card.value().min(player.total()), // pre-draw total is descriptive only
            card.value()
        ));
        player.cards.push(card);
        Some(card.value())
    } else {
        trace.push(format!("Player stands on {}.", player.total()));
        None
    };

    // Banker draws per the tableau.
    if banker_draws(banker.total(), player_third) {
        let card = next();
        trace.push(format!(
            "Banker {} -> draws a third card ({}) per tableau.",
            banker.total(),
            card.value()
        ));
        banker.cards.push(card);
    } else {
        trace.push(format!("Banker stands on {}.", banker.total()));
    }

    let outcome = decide_outcome(&player, &banker);
    RoundResult { player, banker, outcome, trace }
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd engine && cargo test round::`
Expected: PASS — 3 tests ok

- [ ] **Step 6: Commit**

```bash
git add engine/src/round.rs engine/src/lib.rs
git commit -m "feat: full round play with naturals, draws, and outcome"
```

---

### Task 7: The shoe

An 8-deck shoe (416 cards) with a seeded shuffle for reproducibility, plus `draw`. Seeding makes shoe-driven play testable.

**Files:**
- Create: `engine/src/shoe.rs`
- Modify: `engine/src/lib.rs`
- Test: in `engine/src/shoe.rs`

- [ ] **Step 1: Declare the module**

Add to `engine/src/lib.rs`:

```rust
pub mod shoe;
```

- [ ] **Step 2: Write failing tests**

`engine/src/shoe.rs`:

```rust
use crate::card::Card;

pub struct Shoe {
    cards: Vec<Card>,
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
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd engine && cargo test shoe::`
Expected: FAIL — `no function 'new_seeded'`

- [ ] **Step 4: Implement the shoe**

Add to `engine/src/shoe.rs` (above the `tests` mod, below the struct):

```rust
use crate::card::{Rank, Suit};
use rand::seq::SliceRandom;
use rand::{rngs::StdRng, SeedableRng};

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
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd engine && cargo test shoe::`
Expected: PASS — 4 tests ok

- [ ] **Step 6: Commit**

```bash
git add engine/src/shoe.rs engine/src/lib.rs
git commit -m "feat: seeded 8-deck shoe with shuffle and draw"
```

---

### Task 8: Main-bet settlement with commission

Settle the three main bets against an outcome, returning the **net change** to the bettor's bankroll in cents. Banker wins pay 0.95:1 (5% commission); Tie pays 8:1; Player/Banker wagers push on a Tie.

**Files:**
- Create: `engine/src/settle.rs`
- Modify: `engine/src/lib.rs`
- Test: in `engine/src/settle.rs`

- [ ] **Step 1: Declare the module**

Add to `engine/src/lib.rs`:

```rust
pub mod settle;
```

- [ ] **Step 2: Write failing tests**

`engine/src/settle.rs`:

```rust
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
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd engine && cargo test settle::`
Expected: FAIL — `cannot find function 'settle'`

- [ ] **Step 4: Implement `settle`**

Add to `engine/src/settle.rs` (above the `tests` mod):

```rust
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
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd engine && cargo test settle::`
Expected: PASS — 8 tests ok

- [ ] **Step 6: Commit**

```bash
git add engine/src/settle.rs engine/src/lib.rs
git commit -m "feat: main-bet settlement with banker commission"
```

---

### Task 9: Integration — play a shoe-driven round and settle a bet

Tie the pieces together end to end: deal a real round from a seeded shoe and settle a bet against its outcome. This guards against module-boundary regressions.

**Files:**
- Create: `engine/tests/integration.rs`

- [ ] **Step 1: Write the failing integration test**

`engine/tests/integration.rs`:

```rust
use baccarat_engine::round::play_round;
use baccarat_engine::settle::{settle, Bet, BetSpot};
use baccarat_engine::shoe::Shoe;

#[test]
fn seeded_round_is_deterministic_and_settles() {
    let mut shoe = Shoe::new_seeded(12345);
    let result = play_round(&mut shoe);

    // Both hands always have 2 or 3 cards.
    assert!((2..=3).contains(&result.player.cards.len()));
    assert!((2..=3).contains(&result.banker.cards.len()));

    // Settling a Player bet must yield exactly one of: +stake, -stake, or 0 (push).
    let bet = Bet { spot: BetSpot::Player, amount: 5_000 };
    let delta = settle(bet, result.outcome);
    assert!(delta == 5_000 || delta == -5_000 || delta == 0);

    // Determinism: same seed, same outcome.
    let mut shoe2 = Shoe::new_seeded(12345);
    let result2 = play_round(&mut shoe2);
    assert_eq!(result.outcome, result2.outcome);
    assert_eq!(result.player.cards, result2.player.cards);
    assert_eq!(result.banker.cards, result2.banker.cards);
}
```

- [ ] **Step 2: Run the test to verify it fails (or surfaces missing re-exports)**

Run: `cd engine && cargo test --test integration`
Expected: FAIL — items not accessible / not yet passing.

- [ ] **Step 3: Ensure the public API is re-exported**

Confirm `engine/src/lib.rs` declares all modules as `pub mod` (card, hand, rules, round, shoe, settle). The integration test uses `baccarat_engine::round`, `::settle`, `::shoe`. No code change needed if they are already `pub mod`; otherwise make them public.

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd engine && cargo test --test integration`
Expected: PASS — 1 test ok

- [ ] **Step 5: Run the full suite**

Run: `cd engine && cargo test`
Expected: PASS — all unit tests + integration test green.

- [ ] **Step 6: Commit**

```bash
git add engine/tests/integration.rs engine/src/lib.rs
git commit -m "test: end-to-end shoe round and settlement integration"
```

---

## Self-Review

**Spec coverage (against the engine-relevant parts of the design spec §3):**
- Card values, totals, naturals → Tasks 2–3. ✓
- Player rule → Task 4. ✓
- Banker tableau (exhaustive) → Task 5. ✓
- Round resolution + outcome + explain trace seed → Task 6. ✓
- 8-deck shoe → Task 7. ✓
- Main bets + 5% commission → Task 8. ✓
- Pair detection (needed later for Pair side bets) → Task 3 (`is_pair`). ✓
- Side bets (EZ/Dragon 7/Panda 8/Dragon Bonus/Tiger), scoreboard roads, WASM boundary, glossary, dealer text, other players → **deliberately deferred to Plans 2–5** per the decomposition. Not gaps in this plan.

**Placeholder scan:** No TBD/TODO; every code step contains complete code; every run step states an expected result. ✓

**Type consistency:** `Card`/`Rank`/`Suit` (Task 2) used unchanged in hand/round/shoe. `Hand { cards }` (Task 3) used in `round.rs`. `Outcome` (Task 6) consumed by `settle.rs` (Task 8) and the integration test (Task 9). `Bet`/`BetSpot` names match between Task 8 and Task 9. Crate name `baccarat-engine` → import path `baccarat_engine` (hyphen→underscore) used correctly in the integration test. ✓

**Note on the trace string in Task 6:** the player pre-draw total is reconstructed for display only and is cosmetic; the explain-the-rule mode in Plan 2 will replace these ad-hoc strings with a structured `ExplainTrace`. Left simple here intentionally.
