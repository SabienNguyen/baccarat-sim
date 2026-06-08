# Baccarat Engine — Side Bets Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the baccarat engine with all v1 side bets and the EZ Baccarat variant — Player/Banker Pairs, no-commission (EZ) main settlement with the Dragon-7 bar, Dragon 7 & Panda 8, the Dragon Bonus margin ladder, and the Tiger family — each as an independently tested pure function over a `RoundResult`.

**Architecture:** A new `sidebets` module holds pure functions that take an immutable `&RoundResult` (already produced by `round::play_round`) plus a stake in cents and return the net bankroll change in cents — exactly mirroring the convention of `settle::settle`. The EZ main-bet settlement lives in `settle` alongside the existing commission settlement, selected by a `Ruleset` enum. No floats; integer cents throughout. Each side bet is a separate function so it can be unit-tested in isolation; a final dispatcher maps a `SideBet` enum to the right function.

**Tech Stack:** Rust 2021, existing crate `baccarat-engine`. Built-in test harness.

**Payout reference (cited):** Wizard of Odds — https://wizardofodds.com/games/baccarat/side-bets/ and https://wizardofodds.com/games/tiger-no-commission-baccarat/

---

## Existing API this builds on (do not change)

- `card::Card { rank: Rank, suit: Suit }`, `Card::value() -> u8`, `Rank`/`Suit` are `PartialEq`.
- `hand::Hand { cards: Vec<Card> }`, `Hand::total() -> u8`, `Hand::is_natural() -> bool`, `Hand::is_pair() -> bool`.
- `round::Outcome { PlayerWin, BankerWin, Tie }`, `round::RoundResult { player: Hand, banker: Hand, outcome: Outcome, trace: Vec<String> }`.
- `settle::{BetSpot, Bet, settle}` — main-bet settlement with 5% banker commission, returns net cents `i64`.

## File Structure

- `engine/src/sidebets.rs` — NEW. `BetSide` enum, `SideBet` enum, one pure function per side bet, and a `settle_side` dispatcher.
- `engine/src/settle.rs` — MODIFY. Add `Ruleset` enum and `settle_with` (EZ-aware main settlement) beside the existing `settle`.
- `engine/src/lib.rs` — MODIFY. Add `pub mod sidebets;`.
- `engine/tests/integration.rs` — MODIFY. Add an end-to-end side-bet settlement assertion.

---

### Task 1: BetSide + Pair side bets

Player Pair / Banker Pair pay **11:1** when that hand's first two cards match rank; otherwise lose the stake.

**Files:**
- Create: `engine/src/sidebets.rs`
- Modify: `engine/src/lib.rs`

- [ ] **Step 1: Declare the module.** Add to `engine/src/lib.rs` (with the other `pub mod` lines):

```rust
pub mod sidebets;
```

- [ ] **Step 2: Write failing tests.** `engine/src/sidebets.rs`:

```rust
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
```

- [ ] **Step 3: Run to verify it fails.** `cd engine && cargo test sidebets::tests::pair` — Expected FAIL (module/function not found until step 2 saved; if step 2 is in place this compiles — run anyway to confirm green path is not yet reached). If it already passes because `pair_pays` is defined in step 2, that is acceptable here since the function and tests are added together; the meaningful check is step 4 PASS.

- [ ] **Step 4: Run to verify it passes.** `cd engine && cargo test sidebets::` — Expected PASS: 2 tests ok.

- [ ] **Step 5: Commit.**

```bash
git add engine/src/sidebets.rs engine/src/lib.rs
git commit -m "feat: pair side bets (11:1) and BetSide enum"
```

---

### Task 2: EZ Baccarat main settlement (Ruleset + Dragon-7 bar)

In EZ Baccarat there is **no commission**, but a Banker win with a **three-card total of 7** is a **push** ("Dragon 7 bar") for Banker bets. Player and Tie bets behave as in the commission game. Add a `Ruleset` enum and a `settle_with` function that needs the full `RoundResult` (to see the banker's card count and total).

**Files:**
- Modify: `engine/src/settle.rs`

- [ ] **Step 1: Write failing tests.** Append to the `tests` module in `engine/src/settle.rs` (inside the existing `#[cfg(test)] mod tests { ... }`):

```rust
    use crate::card::{Card, Rank, Suit};
    use crate::hand::Hand;
    use crate::round::RoundResult;

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
    fn ez_banker_win_pays_even_money_no_commission() {
        // Banker wins with a normal (non 3-card-7) hand: full even money, no 5% cut.
        let r = rr(vec![c(Rank::Five), c(Rank::Two)], vec![c(Rank::Six), c(Rank::Three)], Outcome::BankerWin);
        let bet = Bet { spot: BetSpot::Banker, amount: 10_000 };
        assert_eq!(settle_with(bet, &r, Ruleset::EzBaccarat), 10_000);
    }

    #[test]
    fn ez_banker_three_card_seven_is_a_push() {
        // Banker wins with three cards totaling 7 -> Dragon 7 bar -> banker bet pushes.
        let r = rr(
            vec![c(Rank::Five), c(Rank::Two)],
            vec![c(Rank::Two), c(Rank::Two), c(Rank::Three)], // 3-card total 7
            Outcome::BankerWin,
        );
        let bet = Bet { spot: BetSpot::Banker, amount: 10_000 };
        assert_eq!(settle_with(bet, &r, Ruleset::EzBaccarat), 0);
    }

    #[test]
    fn ez_player_bet_unaffected_by_bar() {
        let r = rr(
            vec![c(Rank::Five), c(Rank::Two)],
            vec![c(Rank::Two), c(Rank::Two), c(Rank::Three)],
            Outcome::BankerWin,
        );
        let bet = Bet { spot: BetSpot::Player, amount: 10_000 };
        assert_eq!(settle_with(bet, &r, Ruleset::EzBaccarat), -10_000);
    }

    #[test]
    fn commission_ruleset_matches_legacy_settle() {
        // settle_with(.., Commission) must equal settle(..) for a banker win.
        let r = rr(vec![c(Rank::Five), c(Rank::Two)], vec![c(Rank::Six), c(Rank::Three)], Outcome::BankerWin);
        let bet = Bet { spot: BetSpot::Banker, amount: 10_000 };
        assert_eq!(settle_with(bet, &r, Ruleset::Commission), settle(bet, Outcome::BankerWin));
    }
```

- [ ] **Step 2: Run to verify it fails.** `cd engine && cargo test settle::tests::ez` — Expected FAIL: `cannot find type 'Ruleset'` / `function 'settle_with'`.

- [ ] **Step 3: Implement.** Add to `engine/src/settle.rs` (below the existing `settle` function, above the `tests` mod). Note the `use` of `RoundResult`:

```rust
use crate::round::RoundResult;

/// Which commission rules apply to the main Banker bet.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
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
            // Everything else is identical to the commission game's non-banker-win cases.
            _ => settle(bet, round.outcome),
        },
    }
}
```

- [ ] **Step 4: Run to verify it passes.** `cd engine && cargo test settle::` — Expected PASS: all prior settle tests + 4 new ones.

- [ ] **Step 5: Commit.**

```bash
git add engine/src/settle.rs
git commit -m "feat: EZ Baccarat main settlement with Dragon-7 bar"
```

---

### Task 3: Dragon 7 and Panda 8 side bets

**Dragon 7:** pays **40:1** if the Banker wins with a three-card total of 7. **Panda 8:** pays **25:1** if the Player wins with a three-card total of 8. Otherwise each loses its stake.

**Files:**
- Modify: `engine/src/sidebets.rs`

- [ ] **Step 1: Write failing tests.** Add a second test module to `engine/src/sidebets.rs` (after the existing `tests` mod):

```rust
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
            vec![c(Rank::Two), c(Rank::Two), c(Rank::Three)], // banker 3-card 7
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
            vec![c(Rank::Two), c(Rank::Two), c(Rank::Four)], // player 3-card 8
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
```

- [ ] **Step 2: Run to verify it fails.** `cd engine && cargo test sidebets::ez_side` — Expected FAIL: `cannot find function 'dragon7_pays'`.

- [ ] **Step 3: Implement.** Add to `engine/src/sidebets.rs` (below `pair_pays`):

```rust
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
```

- [ ] **Step 4: Run to verify it passes.** `cd engine && cargo test sidebets::ez_side` — Expected PASS: 4 tests ok.

- [ ] **Step 5: Commit.**

```bash
git add engine/src/sidebets.rs
git commit -m "feat: Dragon 7 and Panda 8 side bets"
```

---

### Task 4: Dragon Bonus margin ladder

The Dragon Bonus (separately for the Player or Banker side) pays on the chosen side winning:
- **Natural win** (chosen side wins and that hand is a two-card 8 or 9) → **1:1**, regardless of margin.
- **Non-natural win** by margin: 4→1:1, 5→2:1, 6→4:1, 7→6:1, 8→10:1, 9→30:1. A non-natural win by 1–3 wins nothing (lose).
- **Natural tie** (tie at 8 or 9) → **push** (0).
- Any other tie or a loss → lose the stake.

(Margin = the chosen side's total minus the other side's total.)

**Files:**
- Modify: `engine/src/sidebets.rs`

- [ ] **Step 1: Write failing tests.** Add a third test module to `engine/src/sidebets.rs`:

```rust
#[cfg(test)]
mod dragon_bonus_tests {
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
    fn natural_win_pays_one_to_one() {
        // Player natural 9 (4+5) beats banker 7 (3+4). Player side Dragon Bonus.
        let r = rr(vec![c(Rank::Four), c(Rank::Five)], vec![c(Rank::Three), c(Rank::Four)], Outcome::PlayerWin);
        assert_eq!(dragon_bonus_pays(BetSide::Player, &r, 100), 100);
    }

    #[test]
    fn non_natural_win_by_nine_pays_thirty() {
        // Player 9 (3 cards: 2+3+4) vs Banker 0. Margin 9, not natural.
        let r = rr(
            vec![c(Rank::Two), c(Rank::Three), c(Rank::Four)],
            vec![c(Rank::Ten), c(Rank::King)],
            Outcome::PlayerWin,
        );
        assert_eq!(dragon_bonus_pays(BetSide::Player, &r, 100), 3_000);
    }

    #[test]
    fn non_natural_win_by_four_pays_one_to_one() {
        // Player 7 (3 cards 2+2+3) vs Banker 3. Margin 4, not natural.
        let r = rr(
            vec![c(Rank::Two), c(Rank::Two), c(Rank::Three)],
            vec![c(Rank::King), c(Rank::Three)],
            Outcome::PlayerWin,
        );
        assert_eq!(dragon_bonus_pays(BetSide::Player, &r, 100), 100);
    }

    #[test]
    fn non_natural_win_by_three_loses() {
        // Player 7 vs Banker 4 (3 cards) -> margin 3 -> lose.
        let r = rr(
            vec![c(Rank::Two), c(Rank::Two), c(Rank::Three)],
            vec![c(Rank::King), c(Rank::Two), c(Rank::Two)],
            Outcome::PlayerWin,
        );
        assert_eq!(dragon_bonus_pays(BetSide::Player, &r, 100), -100);
    }

    #[test]
    fn natural_tie_pushes() {
        // Both natural 8 -> tie -> push.
        let r = rr(vec![c(Rank::Three), c(Rank::Five)], vec![c(Rank::Four), c(Rank::Four)], Outcome::Tie);
        assert_eq!(dragon_bonus_pays(BetSide::Player, &r, 100), 0);
    }

    #[test]
    fn non_natural_tie_loses() {
        // Tie at 6 -> lose.
        let r = rr(vec![c(Rank::Two), c(Rank::Four)], vec![c(Rank::Three), c(Rank::Three)], Outcome::Tie);
        assert_eq!(dragon_bonus_pays(BetSide::Player, &r, 100), -100);
    }

    #[test]
    fn banker_side_loses_when_player_wins() {
        let r = rr(vec![c(Rank::Four), c(Rank::Five)], vec![c(Rank::Three), c(Rank::Four)], Outcome::PlayerWin);
        assert_eq!(dragon_bonus_pays(BetSide::Banker, &r, 100), -100);
    }
}
```

- [ ] **Step 2: Run to verify it fails.** `cd engine && cargo test sidebets::dragon_bonus` — Expected FAIL: `cannot find function 'dragon_bonus_pays'`.

- [ ] **Step 3: Implement.** Add to `engine/src/sidebets.rs`:

```rust
/// Dragon Bonus for the chosen side. See plan for the full pay rules.
pub fn dragon_bonus_pays(side: BetSide, round: &RoundResult, stake: i64) -> i64 {
    let (mine, theirs, my_win) = match side {
        BetSide::Player => (&round.player, &round.banker, round.outcome == Outcome::PlayerWin),
        BetSide::Banker => (&round.banker, &round.player, round.outcome == Outcome::BankerWin),
    };

    if round.outcome == Outcome::Tie {
        // Natural tie pushes; any other tie loses.
        return if mine.is_natural() && theirs.is_natural() { 0 } else { -stake };
    }

    if !my_win {
        return -stake;
    }

    // My side won.
    if mine.is_natural() {
        return stake; // natural win pays 1:1 regardless of margin
    }

    let margin = mine.total() as i64 - theirs.total() as i64;
    let multiplier = match margin {
        9 => 30,
        8 => 10,
        7 => 6,
        6 => 4,
        5 => 2,
        4 => 1,
        _ => return -stake, // win by 1–3 pays nothing
    };
    stake * multiplier
}
```

- [ ] **Step 4: Run to verify it passes.** `cd engine && cargo test sidebets::dragon_bonus` — Expected PASS: 7 tests ok.

- [ ] **Step 5: Commit.**

```bash
git add engine/src/sidebets.rs
git commit -m "feat: Dragon Bonus margin ladder"
```

---

### Task 5: Tiger, Big Tiger, Small Tiger, Tiger Tie

All key off the **Banker** having a **6**. Tiger: Banker wins with 6 → 12:1 (two cards) or 20:1 (three cards). Big Tiger: Banker wins with a three-card 6 → 50:1. Small Tiger: Banker wins with a two-card 6 → 22:1. Tiger Tie: the hand is a 6–6 tie → 35:1. Otherwise each loses.

**Files:**
- Modify: `engine/src/sidebets.rs`

- [ ] **Step 1: Write failing tests.** Add a fourth test module to `engine/src/sidebets.rs`:

```rust
#[cfg(test)]
mod tiger_tests {
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

    // Banker wins with a two-card 6.
    fn banker_two_card_six_win() -> RoundResult {
        rr(vec![c(Rank::Two), c(Rank::Three)], vec![c(Rank::Two), c(Rank::Four)], Outcome::BankerWin)
    }
    // Banker wins with a three-card 6.
    fn banker_three_card_six_win() -> RoundResult {
        rr(vec![c(Rank::Two), c(Rank::Three)], vec![c(Rank::Two), c(Rank::Two), c(Rank::Two)], Outcome::BankerWin)
    }

    #[test]
    fn tiger_two_card_six_pays_twelve() {
        assert_eq!(tiger_pays(&banker_two_card_six_win(), 100), 1_200);
    }

    #[test]
    fn tiger_three_card_six_pays_twenty() {
        assert_eq!(tiger_pays(&banker_three_card_six_win(), 100), 2_000);
    }

    #[test]
    fn tiger_loses_when_banker_does_not_win_with_six() {
        let r = rr(vec![c(Rank::Five), c(Rank::Four)], vec![c(Rank::Two), c(Rank::Three)], Outcome::PlayerWin);
        assert_eq!(tiger_pays(&r, 100), -100);
    }

    #[test]
    fn big_tiger_only_three_card_six() {
        assert_eq!(big_tiger_pays(&banker_three_card_six_win(), 100), 5_000);
        assert_eq!(big_tiger_pays(&banker_two_card_six_win(), 100), -100);
    }

    #[test]
    fn small_tiger_only_two_card_six() {
        assert_eq!(small_tiger_pays(&banker_two_card_six_win(), 100), 2_200);
        assert_eq!(small_tiger_pays(&banker_three_card_six_win(), 100), -100);
    }

    #[test]
    fn tiger_tie_pays_thirtyfive_on_six_six() {
        let r = rr(vec![c(Rank::Two), c(Rank::Four)], vec![c(Rank::Three), c(Rank::Three)], Outcome::Tie);
        assert_eq!(tiger_tie_pays(&r, 100), 3_500);
    }

    #[test]
    fn tiger_tie_loses_on_other_tie() {
        let r = rr(vec![c(Rank::Two), c(Rank::Three)], vec![c(Rank::Two), c(Rank::Three)], Outcome::Tie);
        assert_eq!(tiger_tie_pays(&r, 100), -100);
    }
}
```

- [ ] **Step 2: Run to verify it fails.** `cd engine && cargo test sidebets::tiger_tests` — Expected FAIL: `cannot find function 'tiger_pays'`.

- [ ] **Step 3: Implement.** Add to `engine/src/sidebets.rs`. The helper `banker_six_win` keeps the four functions DRY:

```rust
/// (banker won with a total of 6, banker card count) for the Tiger family.
fn banker_six(round: &RoundResult) -> Option<usize> {
    if round.outcome == Outcome::BankerWin && round.banker.total() == 6 {
        Some(round.banker.cards.len())
    } else {
        None
    }
}

/// Tiger: banker wins with 6 — 12:1 on two cards, 20:1 on three cards.
pub fn tiger_pays(round: &RoundResult, stake: i64) -> i64 {
    match banker_six(round) {
        Some(2) => stake * 12,
        Some(_) => stake * 20, // three-card six
        None => -stake,
    }
}

/// Big Tiger: banker wins with a three-card 6 — 50:1.
pub fn big_tiger_pays(round: &RoundResult, stake: i64) -> i64 {
    match banker_six(round) {
        Some(3) => stake * 50,
        _ => -stake,
    }
}

/// Small Tiger: banker wins with a two-card 6 — 22:1.
pub fn small_tiger_pays(round: &RoundResult, stake: i64) -> i64 {
    match banker_six(round) {
        Some(2) => stake * 22,
        _ => -stake,
    }
}

/// Tiger Tie: a 6–6 tie — 35:1.
pub fn tiger_tie_pays(round: &RoundResult, stake: i64) -> i64 {
    if round.outcome == Outcome::Tie && round.banker.total() == 6 {
        stake * 35
    } else {
        -stake
    }
}
```

- [ ] **Step 4: Run to verify it passes.** `cd engine && cargo test sidebets::tiger_tests` — Expected PASS: 7 tests ok.

- [ ] **Step 5: Commit.**

```bash
git add engine/src/sidebets.rs
git commit -m "feat: Tiger, Big Tiger, Small Tiger, Tiger Tie side bets"
```

---

### Task 6: Tiger Pair

Tiger Pair examines the **first two cards of both hands**: single pair (exactly one hand is a pair) → **4:1**; double pair (both hands are pairs of different ranks) → **20:1**; twin pair (both hands are pairs of the **same rank**) → **100:1**; otherwise lose.

**Files:**
- Modify: `engine/src/sidebets.rs`

- [ ] **Step 1: Write failing tests.** Add a fifth test module to `engine/src/sidebets.rs`:

```rust
#[cfg(test)]
mod tiger_pair_tests {
    use super::*;
    use crate::card::{Card, Rank, Suit};
    use crate::hand::Hand;
    use crate::round::{Outcome, RoundResult};

    fn c(rank: Rank) -> Card {
        Card { rank, suit: Suit::Spades }
    }

    fn rr(player: Vec<Card>, banker: Vec<Card>) -> RoundResult {
        RoundResult {
            player: Hand { cards: player },
            banker: Hand { cards: banker },
            outcome: Outcome::Tie, // outcome irrelevant to Tiger Pair
            trace: Vec::new(),
        }
    }

    #[test]
    fn single_pair_pays_four() {
        // Player pair of 7s, banker not a pair.
        let r = rr(vec![c(Rank::Seven), c(Rank::Seven)], vec![c(Rank::Two), c(Rank::Three)]);
        assert_eq!(tiger_pair_pays(&r, 100), 400);
    }

    #[test]
    fn double_pair_different_ranks_pays_twenty() {
        // Player pair of 7s, banker pair of 9s.
        let r = rr(vec![c(Rank::Seven), c(Rank::Seven)], vec![c(Rank::Nine), c(Rank::Nine)]);
        assert_eq!(tiger_pair_pays(&r, 100), 2_000);
    }

    #[test]
    fn twin_pair_same_rank_pays_hundred() {
        // Both hands pair of 7s.
        let r = rr(vec![c(Rank::Seven), c(Rank::Seven)], vec![c(Rank::Seven), c(Rank::Seven)]);
        assert_eq!(tiger_pair_pays(&r, 100), 10_000);
    }

    #[test]
    fn no_pair_loses() {
        let r = rr(vec![c(Rank::Two), c(Rank::Three)], vec![c(Rank::Four), c(Rank::Five)]);
        assert_eq!(tiger_pair_pays(&r, 100), -100);
    }
}
```

- [ ] **Step 2: Run to verify it fails.** `cd engine && cargo test sidebets::tiger_pair` — Expected FAIL: `cannot find function 'tiger_pair_pays'`.

- [ ] **Step 3: Implement.** Add to `engine/src/sidebets.rs`:

```rust
/// Tiger Pair: 4:1 single pair, 20:1 double pair, 100:1 twin pair (same rank).
pub fn tiger_pair_pays(round: &RoundResult, stake: i64) -> i64 {
    let p = round.player.is_pair();
    let b = round.banker.is_pair();
    match (p, b) {
        (true, true) => {
            // Both are pairs; twin if the paired ranks match.
            let same_rank = round.player.cards[0].rank == round.banker.cards[0].rank;
            if same_rank {
                stake * 100
            } else {
                stake * 20
            }
        }
        (true, false) | (false, true) => stake * 4,
        (false, false) => -stake,
    }
}
```

- [ ] **Step 4: Run to verify it passes.** `cd engine && cargo test sidebets::tiger_pair` — Expected PASS: 4 tests ok.

- [ ] **Step 5: Commit.**

```bash
git add engine/src/sidebets.rs
git commit -m "feat: Tiger Pair side bet (single/double/twin)"
```

---

### Task 7: SideBet enum + dispatcher + integration

A single `settle_side(bet, stake, round)` maps a `SideBet` enum to the right pure function, so front-ends settle any side bet uniformly. Then prove the engine works end to end across modules.

**Files:**
- Modify: `engine/src/sidebets.rs`
- Modify: `engine/tests/integration.rs`

- [ ] **Step 1: Write failing tests.** Add a sixth test module to `engine/src/sidebets.rs`:

```rust
#[cfg(test)]
mod dispatch_tests {
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
    fn dispatch_player_pair() {
        let r = rr(vec![c(Rank::Seven), c(Rank::Seven)], vec![c(Rank::Two), c(Rank::Three)], Outcome::Tie);
        assert_eq!(settle_side(SideBet::PlayerPair, 100, &r), 1_100);
    }

    #[test]
    fn dispatch_banker_pair() {
        let r = rr(vec![c(Rank::Two), c(Rank::Three)], vec![c(Rank::Nine), c(Rank::Nine)], Outcome::Tie);
        assert_eq!(settle_side(SideBet::BankerPair, 100, &r), 1_100);
    }

    #[test]
    fn dispatch_dragon_bonus_player() {
        let r = rr(vec![c(Rank::Four), c(Rank::Five)], vec![c(Rank::Three), c(Rank::Four)], Outcome::PlayerWin);
        assert_eq!(settle_side(SideBet::DragonBonus(BetSide::Player), 100, &r), 100);
    }
}
```

- [ ] **Step 2: Run to verify it fails.** `cd engine && cargo test sidebets::dispatch` — Expected FAIL: `cannot find type 'SideBet'` / `function 'settle_side'`.

- [ ] **Step 3: Implement.** Add to `engine/src/sidebets.rs` (near the top, below `BetSide`):

```rust
/// All supported side bets, for uniform settlement by front-ends.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SideBet {
    PlayerPair,
    BankerPair,
    Dragon7,
    Panda8,
    DragonBonus(BetSide),
    Tiger,
    BigTiger,
    SmallTiger,
    TigerTie,
    TigerPair,
}

/// Settle any side bet against a finished round. `stake` is in cents; the return
/// is the net bankroll change in cents (same convention as `settle::settle`).
pub fn settle_side(bet: SideBet, stake: i64, round: &RoundResult) -> i64 {
    match bet {
        SideBet::PlayerPair => pair_pays(&round.player, stake),
        SideBet::BankerPair => pair_pays(&round.banker, stake),
        SideBet::Dragon7 => dragon7_pays(round, stake),
        SideBet::Panda8 => panda8_pays(round, stake),
        SideBet::DragonBonus(side) => dragon_bonus_pays(side, round, stake),
        SideBet::Tiger => tiger_pays(round, stake),
        SideBet::BigTiger => big_tiger_pays(round, stake),
        SideBet::SmallTiger => small_tiger_pays(round, stake),
        SideBet::TigerTie => tiger_tie_pays(round, stake),
        SideBet::TigerPair => tiger_pair_pays(round, stake),
    }
}
```

- [ ] **Step 4: Run to verify it passes.** `cd engine && cargo test sidebets::dispatch` — Expected PASS: 3 tests ok.

- [ ] **Step 5: Add an end-to-end integration assertion.** Append to `engine/tests/integration.rs`:

```rust
use baccarat_engine::sidebets::{settle_side, SideBet};

#[test]
fn seeded_round_settles_a_pair_side_bet() {
    let mut shoe = baccarat_engine::shoe::Shoe::new_seeded(999);
    let result = baccarat_engine::round::play_round(&mut shoe);

    // A Player Pair side bet must pay either 11x the stake (pair) or -stake (no pair).
    let delta = settle_side(SideBet::PlayerPair, 1_000, &result);
    assert!(delta == 11_000 || delta == -1_000, "unexpected pair payout: {delta}");
}
```

- [ ] **Step 6: Run the full suite.** `cd engine && cargo test` — Expected PASS: all unit + integration tests green.

- [ ] **Step 7: Commit.**

```bash
git add engine/src/sidebets.rs engine/tests/integration.rs
git commit -m "feat: side-bet dispatcher and end-to-end integration"
```

---

## Self-Review

**Spec coverage (design spec §3 side bets):**
- Player/Banker Pair → Task 1. ✓
- EZ Baccarat no-commission + Dragon-7 bar → Task 2. ✓
- Dragon 7 / Panda 8 → Task 3. ✓
- Dragon Bonus ladder → Task 4. ✓
- Tiger / Big Tiger / Small Tiger / Tiger Tie → Task 5. ✓
- Tiger Pair → Task 6. ✓
- Uniform settlement entry point → Task 7. ✓
- Scoreboard roads, structured explain traces, WASM boundary → deferred to later plans (not gaps here).

**Placeholder scan:** No TBD/TODO; every code step has complete code; every run step states an expected result. The only soft step is Task 1 Step 3 (the fail-check), explicitly explained because the type and function are introduced together in a fresh module — the binding check is the Step 4 PASS.

**Type consistency:** `BetSide` (Task 1) reused by `dragon_bonus_pays` (Task 4) and `SideBet::DragonBonus` (Task 7). `RoundResult`/`Outcome` fields (`player`, `banker`, `outcome`, `.total()`, `.is_natural()`, `.is_pair()`, `.cards.len()`, `.cards[0].rank`) all match the engine-core definitions. `settle_side(bet, stake, round)` argument order is consistent between its definition (Task 7 Step 3) and all call sites (Task 7 tests + integration). Pair classic payout is 11:1 as the spec states (not the alternative three-of-a-kind paytable seen on some sites).

**Pay-convention consistency:** Every side bet returns net cents: a win returns `stake * N` (profit), a loss returns `-stake`, a push returns `0` — identical to `settle::settle`. No floats anywhere.
