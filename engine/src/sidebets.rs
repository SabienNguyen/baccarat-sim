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

/// Dragon Bonus for the chosen side. Natural win 1:1; non-natural win pays on a
/// margin ladder (4→1:1,5→2:1,6→4:1,7→6:1,8→10:1,9→30:1, win by 1–3 loses);
/// natural tie pushes; any other tie or a loss loses the stake.
pub fn dragon_bonus_pays(side: BetSide, round: &RoundResult, stake: i64) -> i64 {
    let (mine, theirs, my_win) = match side {
        BetSide::Player => (&round.player, &round.banker, round.outcome == Outcome::PlayerWin),
        BetSide::Banker => (&round.banker, &round.player, round.outcome == Outcome::BankerWin),
    };

    if round.outcome == Outcome::Tie {
        return if mine.is_natural() && theirs.is_natural() { 0 } else { -stake };
    }

    if !my_win {
        return -stake;
    }

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

/// Some(banker card count) if the banker won with a total of 6; else None.
/// Shared by the Tiger family.
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
        let r = rr(vec![c(Rank::Four), c(Rank::Five)], vec![c(Rank::Three), c(Rank::Four)], Outcome::PlayerWin);
        assert_eq!(dragon_bonus_pays(BetSide::Player, &r, 100), 100);
    }

    #[test]
    fn non_natural_win_by_nine_pays_thirty() {
        let r = rr(
            vec![c(Rank::Two), c(Rank::Three), c(Rank::Four)],
            vec![c(Rank::Ten), c(Rank::King)],
            Outcome::PlayerWin,
        );
        assert_eq!(dragon_bonus_pays(BetSide::Player, &r, 100), 3_000);
    }

    #[test]
    fn non_natural_win_by_four_pays_one_to_one() {
        let r = rr(
            vec![c(Rank::Two), c(Rank::Two), c(Rank::Three)],
            vec![c(Rank::King), c(Rank::Three)],
            Outcome::PlayerWin,
        );
        assert_eq!(dragon_bonus_pays(BetSide::Player, &r, 100), 100);
    }

    #[test]
    fn non_natural_win_by_three_loses() {
        let r = rr(
            vec![c(Rank::Two), c(Rank::Two), c(Rank::Three)],
            vec![c(Rank::King), c(Rank::Two), c(Rank::Two)],
            Outcome::PlayerWin,
        );
        assert_eq!(dragon_bonus_pays(BetSide::Player, &r, 100), -100);
    }

    #[test]
    fn natural_tie_pushes() {
        let r = rr(vec![c(Rank::Three), c(Rank::Five)], vec![c(Rank::Four), c(Rank::Four)], Outcome::Tie);
        assert_eq!(dragon_bonus_pays(BetSide::Player, &r, 100), 0);
    }

    #[test]
    fn non_natural_tie_loses() {
        let r = rr(vec![c(Rank::Two), c(Rank::Four)], vec![c(Rank::Three), c(Rank::Three)], Outcome::Tie);
        assert_eq!(dragon_bonus_pays(BetSide::Player, &r, 100), -100);
    }

    #[test]
    fn banker_side_loses_when_player_wins() {
        let r = rr(vec![c(Rank::Four), c(Rank::Five)], vec![c(Rank::Three), c(Rank::Four)], Outcome::PlayerWin);
        assert_eq!(dragon_bonus_pays(BetSide::Banker, &r, 100), -100);
    }

    // Cover the middle rungs of the ladder so a transposed multiplier is caught.
    #[test]
    fn non_natural_win_by_five_pays_two_to_one() {
        // Player 7 (2+2+3, 3 cards) vs Banker 2 (K+2). Margin 5.
        let r = rr(
            vec![c(Rank::Two), c(Rank::Two), c(Rank::Three)],
            vec![c(Rank::King), c(Rank::Two)],
            Outcome::PlayerWin,
        );
        assert_eq!(dragon_bonus_pays(BetSide::Player, &r, 100), 200);
    }

    #[test]
    fn non_natural_win_by_six_pays_four_to_one() {
        // Player 8 (2+3+3, 3 cards) vs Banker 2 (K+2). Margin 6.
        let r = rr(
            vec![c(Rank::Two), c(Rank::Three), c(Rank::Three)],
            vec![c(Rank::King), c(Rank::Two)],
            Outcome::PlayerWin,
        );
        assert_eq!(dragon_bonus_pays(BetSide::Player, &r, 100), 400);
    }

    #[test]
    fn non_natural_win_by_seven_pays_six_to_one() {
        // Player 9 (2+3+4, 3 cards) vs Banker 2 (K+2). Margin 7.
        let r = rr(
            vec![c(Rank::Two), c(Rank::Three), c(Rank::Four)],
            vec![c(Rank::King), c(Rank::Two)],
            Outcome::PlayerWin,
        );
        assert_eq!(dragon_bonus_pays(BetSide::Player, &r, 100), 600);
    }

    #[test]
    fn non_natural_win_by_eight_pays_ten_to_one() {
        // Player 9 (2+3+4, 3 cards) vs Banker 1 (K+A). Margin 8.
        let r = rr(
            vec![c(Rank::Two), c(Rank::Three), c(Rank::Four)],
            vec![c(Rank::King), c(Rank::Ace)],
            Outcome::PlayerWin,
        );
        assert_eq!(dragon_bonus_pays(BetSide::Player, &r, 100), 1_000);
    }
}

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

    fn banker_two_card_six_win() -> RoundResult {
        rr(vec![c(Rank::Two), c(Rank::Three)], vec![c(Rank::Two), c(Rank::Four)], Outcome::BankerWin)
    }
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

/// Tiger Pair: 4:1 single pair, 20:1 double pair (different ranks),
/// 100:1 twin pair (both hands paired on the same rank).
pub fn tiger_pair_pays(round: &RoundResult, stake: i64) -> i64 {
    let p = round.player.is_pair();
    let b = round.banker.is_pair();
    match (p, b) {
        (true, true) => {
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
        let r = rr(vec![c(Rank::Seven), c(Rank::Seven)], vec![c(Rank::Two), c(Rank::Three)]);
        assert_eq!(tiger_pair_pays(&r, 100), 400);
    }

    #[test]
    fn double_pair_different_ranks_pays_twenty() {
        let r = rr(vec![c(Rank::Seven), c(Rank::Seven)], vec![c(Rank::Nine), c(Rank::Nine)]);
        assert_eq!(tiger_pair_pays(&r, 100), 2_000);
    }

    #[test]
    fn twin_pair_same_rank_pays_hundred() {
        let r = rr(vec![c(Rank::Seven), c(Rank::Seven)], vec![c(Rank::Seven), c(Rank::Seven)]);
        assert_eq!(tiger_pair_pays(&r, 100), 10_000);
    }

    #[test]
    fn no_pair_loses() {
        let r = rr(vec![c(Rank::Two), c(Rank::Three)], vec![c(Rank::Four), c(Rank::Five)]);
        assert_eq!(tiger_pair_pays(&r, 100), -100);
    }
}

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

    // Verify every remaining variant is wired to the correct pay function,
    // so a miswired match arm in settle_side cannot slip through.
    #[test]
    fn dispatch_dragon7() {
        let r = rr(
            vec![c(Rank::Four), c(Rank::Two)],
            vec![c(Rank::Two), c(Rank::Two), c(Rank::Three)], // banker 3-card 7
            Outcome::BankerWin,
        );
        assert_eq!(settle_side(SideBet::Dragon7, 100, &r), 4_000);
    }

    #[test]
    fn dispatch_panda8() {
        let r = rr(
            vec![c(Rank::Two), c(Rank::Two), c(Rank::Four)], // player 3-card 8
            vec![c(Rank::Three), c(Rank::Four)],
            Outcome::PlayerWin,
        );
        assert_eq!(settle_side(SideBet::Panda8, 100, &r), 2_500);
    }

    #[test]
    fn dispatch_tiger_and_small_tiger_two_card_six() {
        // Banker wins with a two-card 6.
        let r = rr(vec![c(Rank::Two), c(Rank::Three)], vec![c(Rank::Two), c(Rank::Four)], Outcome::BankerWin);
        assert_eq!(settle_side(SideBet::Tiger, 100, &r), 1_200);
        assert_eq!(settle_side(SideBet::SmallTiger, 100, &r), 2_200);
    }

    #[test]
    fn dispatch_big_tiger_three_card_six() {
        let r = rr(
            vec![c(Rank::Two), c(Rank::Three)],
            vec![c(Rank::Two), c(Rank::Two), c(Rank::Two)], // banker 3-card 6
            Outcome::BankerWin,
        );
        assert_eq!(settle_side(SideBet::BigTiger, 100, &r), 5_000);
    }

    #[test]
    fn dispatch_tiger_tie() {
        let r = rr(vec![c(Rank::Two), c(Rank::Four)], vec![c(Rank::Three), c(Rank::Three)], Outcome::Tie);
        assert_eq!(settle_side(SideBet::TigerTie, 100, &r), 3_500);
    }

    #[test]
    fn dispatch_tiger_pair() {
        let r = rr(vec![c(Rank::Seven), c(Rank::Seven)], vec![c(Rank::Two), c(Rank::Three)], Outcome::Tie);
        assert_eq!(settle_side(SideBet::TigerPair, 100, &r), 400);
    }
}
