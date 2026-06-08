use baccarat_engine::round::play_round;
use baccarat_engine::settle::{settle, Bet, BetSpot};
use baccarat_engine::shoe::Shoe;
use baccarat_engine::sidebets::{settle_side, SideBet};

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

#[test]
fn seeded_round_settles_a_pair_side_bet() {
    let mut shoe = Shoe::new_seeded(999);
    let result = play_round(&mut shoe);

    // A Player Pair side bet must pay either 11x the stake (pair) or -stake (no pair).
    let delta = settle_side(SideBet::PlayerPair, 1_000, &result);
    assert!(delta == 11_000 || delta == -1_000, "unexpected pair payout: {delta}");
}
