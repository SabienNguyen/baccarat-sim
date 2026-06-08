use baccarat_engine::round::play_round;
use baccarat_engine::scoreboard::{derive_scoreboard, RoundRecord};
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
fn seeded_shoe_builds_a_consistent_scoreboard() {
    let mut shoe = baccarat_engine::shoe::Shoe::new_seeded(2024);
    let mut history: Vec<RoundRecord> = Vec::new();

    for _ in 0..20 {
        let round = baccarat_engine::round::play_round(&mut shoe);
        history.push(RoundRecord::from_round(&round));
    }

    let board = derive_scoreboard(&history);

    // Bead Plate has exactly one cell per round.
    assert_eq!(board.bead_plate.cells.len(), 20);

    // Big Road cell count equals the number of non-tie rounds.
    let non_ties = history
        .iter()
        .filter(|r| r.outcome != baccarat_engine::round::Outcome::Tie)
        .count();
    let big_road_cells: usize = board.big_road.columns.iter().map(|c| c.len()).sum();
    assert_eq!(big_road_cells, non_ties);

    // Determinism: same seed, same board.
    let mut shoe2 = baccarat_engine::shoe::Shoe::new_seeded(2024);
    let mut history2: Vec<RoundRecord> = Vec::new();
    for _ in 0..20 {
        history2.push(RoundRecord::from_round(&baccarat_engine::round::play_round(&mut shoe2)));
    }
    assert_eq!(board, derive_scoreboard(&history2));
}

#[test]
fn seeded_round_settles_a_pair_side_bet() {
    let mut shoe = Shoe::new_seeded(999);
    let result = play_round(&mut shoe);

    // A Player Pair side bet must pay either 11x the stake (pair) or -stake (no pair).
    let delta = settle_side(SideBet::PlayerPair, 1_000, &result);
    assert!(delta == 11_000 || delta == -1_000, "unexpected pair payout: {delta}");
}
