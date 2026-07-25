//! Statistical validation: the shuffled shoe must reproduce the published
//! punto banco probabilities. With 8 decks the exact figures are
//! Banker 45.86%, Player 44.62%, Tie 9.52% per coup, and each hand's
//! first two cards pair up about 7.47% of the time. We deal a large number
//! of coups across many freshly shuffled shoes and require the observed
//! frequencies to land within ±0.5 percentage points (> 4 sigma of slack
//! at this sample size), which a biased shuffle or a skewed RNG would blow.

use baccarat_engine::round::{play_round, Outcome};
use baccarat_engine::shoe::{Shoe, CUT_CARD};
use baccarat_engine::sidebets::{settle_side, BetSide, SideBet};

const ROUNDS: u32 = 200_000;

#[test]
fn outcome_frequencies_match_punto_banco_theory() {
    let mut banker = 0u32;
    let mut player = 0u32;
    let mut tie = 0u32;
    let mut pairs = 0u32;
    let mut hands = 0u32;

    let mut rounds = 0u32;
    let mut seed = 0u64;
    while rounds < ROUNDS {
        let mut shoe = Shoe::new_seeded(seed);
        seed += 1;
        // play each shoe to the cut card, like the pit does
        while shoe.remaining() > CUT_CARD && rounds < ROUNDS {
            let r = play_round(&mut shoe);
            match r.outcome {
                Outcome::BankerWin => banker += 1,
                Outcome::PlayerWin => player += 1,
                Outcome::Tie => tie += 1,
            }
            hands += 2;
            if r.player.is_pair() {
                pairs += 1;
            }
            if r.banker.is_pair() {
                pairs += 1;
            }
            rounds += 1;
        }
    }

    let pct = |n: u32, d: u32| f64::from(n) / f64::from(d);
    let b = pct(banker, rounds);
    let p = pct(player, rounds);
    let t = pct(tie, rounds);
    let pr = pct(pairs, hands);

    let close = |observed: f64, expected: f64| (observed - expected).abs() < 0.005;
    assert!(close(b, 0.4586), "banker frequency off: {b:.4} (expected ~0.4586)");
    assert!(close(p, 0.4462), "player frequency off: {p:.4} (expected ~0.4462)");
    assert!(close(t, 0.0952), "tie frequency off: {t:.4} (expected ~0.0952)");
    assert!(close(pr, 0.0747), "pair frequency off: {pr:.4} (expected ~0.0747)");
}

#[test]
fn side_bet_house_edges_match_published_paytables() {
    // Settle every side bet through the real `settle_side` over the same large
    // deterministic run and require the realized house edge to land near the
    // published value. A wrong multiplier or win condition shifts an edge by
    // ~10+ points — far outside these bands — while the bands stay wider than
    // Monte-Carlo error at this N, so the check is tight yet non-flaky.
    //
    // `stake = 1`: every side multiplier is a whole number, so net stays exact
    // and the realized edge is simply -sum(net) / rounds.
    let bets: &[(&str, SideBet)] = &[
        ("PlayerPair", SideBet::PlayerPair),
        ("BankerPair", SideBet::BankerPair),
        ("Dragon7", SideBet::Dragon7),
        ("Panda8", SideBet::Panda8),
        ("DragonBonus", SideBet::DragonBonus(BetSide::Player)),
        ("Tiger", SideBet::Tiger),
        ("BigTiger", SideBet::BigTiger),
        ("SmallTiger", SideBet::SmallTiger),
        ("TigerTie", SideBet::TigerTie),
        ("TigerPair", SideBet::TigerPair),
    ];
    // (published edge, tolerance) — wider tolerance for the high-payout,
    // high-variance bets (40:1, 50:1, 100:1) whose edge estimate is noisier.
    let expected: &[(f64, f64)] = &[
        (0.1036, 0.02), // PlayerPair 11:1
        (0.1036, 0.02), // BankerPair 11:1
        (0.0761, 0.04), // Dragon7 40:1
        (0.1019, 0.03), // Panda8 25:1
        (0.0265, 0.02), // Dragon Bonus (Player)
        (0.1668, 0.03), // Tiger 12/20:1
        (0.1525, 0.04), // Big Tiger 50:1
        (0.1433, 0.03), // Small Tiger 22:1
        (0.1151, 0.03), // Tiger Tie 45:1
        (0.1612, 0.03), // Tiger Pair 4/20/100:1
    ];

    let mut net = vec![0i64; bets.len()];
    let mut rounds = 0u32;
    let mut seed = 0u64;
    while rounds < ROUNDS {
        let mut shoe = Shoe::new_seeded(seed);
        seed += 1;
        while shoe.remaining() > CUT_CARD && rounds < ROUNDS {
            let r = play_round(&mut shoe);
            for (i, (_, bet)) in bets.iter().enumerate() {
                net[i] += settle_side(*bet, 1, &r);
            }
            rounds += 1;
        }
    }

    for (i, (name, _)) in bets.iter().enumerate() {
        let edge = -(net[i] as f64) / f64::from(rounds);
        let (want, tol) = expected[i];
        assert!(
            (edge - want).abs() < tol,
            "{name} realized edge {edge:.4} off published ~{want:.4} (tol {tol})",
        );
    }
}

#[test]
fn every_rank_and_suit_is_dealt_uniformly() {
    // Deal several whole shoes and confirm no card is favored: each of the
    // 52 distinct cards should appear ~8 times per shoe on average.
    use std::collections::HashMap;
    let mut counts: HashMap<(u8, u8), u32> = HashMap::new();
    let shoes = 500u64;
    let mut total = 0u32;
    for seed in 0..shoes {
        let shoe = Shoe::new_seeded(seed);
        for card in shoe {
            *counts.entry((card.rank as u8, card.suit as u8)).or_default() += 1;
            total += 1;
        }
    }
    let expected = f64::from(total) / 52.0;
    for (key, n) in &counts {
        let dev = (f64::from(*n) - expected).abs() / expected;
        // burns hide a handful of cards per shoe; 3% slack is generous
        assert!(dev < 0.03, "card {key:?} dealt {n} times vs expected ~{expected:.0}");
    }
}
