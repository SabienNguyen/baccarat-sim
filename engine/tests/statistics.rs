//! Statistical validation: the shuffled shoe must reproduce the published
//! punto banco probabilities. With 8 decks the exact figures are
//! Banker 45.86%, Player 44.62%, Tie 9.52% per coup, and each hand's
//! first two cards pair up about 7.47% of the time. We deal a large number
//! of coups across many freshly shuffled shoes and require the observed
//! frequencies to land within ±0.5 percentage points (> 4 sigma of slack
//! at this sample size), which a biased shuffle or a skewed RNG would blow.

use baccarat_engine::round::{play_round, Outcome};
use baccarat_engine::shoe::{Shoe, CUT_CARD};

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
