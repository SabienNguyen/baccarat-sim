//! Exact probabilities by enumeration — no sampling, no seeds, no error bars.
//!
//! `statistics.rs` deals millions of real coups and checks the results land near
//! published figures. That validates the shuffle, but it can only ever bound a
//! number to within Monte-Carlo noise, and a paytable that is wrong by a hair
//! hides inside the band. This test instead walks *every* reachable coup of a
//! fresh 8-deck shoe with its exact hypergeometric weight and sums.
//!
//! It drives the real engine on every branch: `player_draws` / `banker_draws`
//! decide the draws, and `play_round` builds each `RoundResult` from the actual
//! card sequence, so the totals, natural handling and outcome all come from
//! production code rather than a reimplementation of the rules.
//!
//! Two properties make it self-checking: the leaf probabilities must sum to
//! exactly 1, and the outcome frequencies must reproduce the canonical 8-deck
//! figures (Banker 45.8597%, Player 44.6247%, Tie 9.5156%). A drawing-rule bug
//! cannot satisfy both.
//!
//! `cargo test -p baccarat-engine --release --test exact_enumeration -- --nocapture`

use baccarat_engine::card::{Card, Rank, Suit};
use baccarat_engine::hand::Hand;
use baccarat_engine::round::{play_round, Outcome, RoundResult};
use baccarat_engine::rules::{banker_draws, player_draws};
use baccarat_engine::sidebets::{settle_side, BetSide, SideBet};

const RANKS: [Rank; 13] = [
    Rank::Ace, Rank::Two, Rank::Three, Rank::Four, Rank::Five, Rank::Six,
    Rank::Seven, Rank::Eight, Rank::Nine, Rank::Ten, Rank::Jack, Rank::Queen,
    Rank::King,
];
/// 8 decks x 4 suits of each rank.
const PER_RANK: u32 = 32;
const SHOE: u32 = PER_RANK * 13; // 416

/// The bets under test, in the order their totals are reported.
const BETS: [(&str, SideBet); 11] = [
    ("PlayerPair", SideBet::PlayerPair),
    ("BankerPair", SideBet::BankerPair),
    ("Dragon7", SideBet::Dragon7),
    ("Panda8", SideBet::Panda8),
    ("DragonBonus(P)", SideBet::DragonBonus(BetSide::Player)),
    ("DragonBonus(B)", SideBet::DragonBonus(BetSide::Banker)),
    ("Tiger", SideBet::Tiger),
    ("BigTiger", SideBet::BigTiger),
    ("SmallTiger", SideBet::SmallTiger),
    ("TigerTie", SideBet::TigerTie),
    ("TigerPair", SideBet::TigerPair),
];

/// Candidate paytables the engine does not implement, priced on the same walk.
/// Each is a real Las Vegas bet — see the 2026-07-25 entries in docs/BACKLOG.md.
type Candidate = (&'static str, fn(&RoundResult) -> f64);
const CANDIDATES: [Candidate; 4] = [
    ("Lucky6 12/23", lucky6),
    ("Lucky7 6/15", lucky7),
    ("TigerTie 45:1", tiger_tie_45),
    ("EitherPair 5:1", either_pair),
];

fn banker_six(r: &RoundResult) -> Option<usize> {
    if r.outcome == Outcome::BankerWin && r.banker.total() == 6 {
        Some(r.banker.cards.len())
    } else {
        None
    }
}

fn lucky6(r: &RoundResult) -> f64 {
    match banker_six(r) {
        Some(2) => 12.0,
        Some(_) => 23.0,
        None => -1.0,
    }
}

fn lucky7(r: &RoundResult) -> f64 {
    if r.outcome == Outcome::PlayerWin && r.player.total() == 7 {
        if r.player.cards.len() == 2 {
            6.0
        } else {
            15.0
        }
    } else {
        -1.0
    }
}

fn tiger_tie_45(r: &RoundResult) -> f64 {
    if r.outcome == Outcome::Tie && r.banker.total() == 6 {
        45.0
    } else {
        -1.0
    }
}

fn either_pair(r: &RoundResult) -> f64 {
    if r.player.is_pair() || r.banker.is_pair() {
        5.0
    } else {
        -1.0
    }
}

/// Running state of the walk: how many of each rank are left, and the exact
/// probability of the sequence drawn so far.
struct Walk {
    left: [u32; 13],
    remaining: u32,
    /// Expected units won per unit staked, per bet, weighted by probability.
    ev: [f64; BETS.len()],
    cand_ev: [f64; CANDIDATES.len()],
    /// Probability mass by outcome, plus the total (a sum-to-one check).
    p_player: f64,
    p_banker: f64,
    p_tie: f64,
    p_total: f64,
    /// Probability either hand's first two cards pair.
    p_pair_either: f64,
    leaves: u64,
}

impl Walk {
    fn new() -> Self {
        Walk {
            left: [PER_RANK; 13],
            remaining: SHOE,
            ev: [0.0; BETS.len()],
            cand_ev: [0.0; CANDIDATES.len()],
            p_player: 0.0,
            p_banker: 0.0,
            p_tie: 0.0,
            p_total: 0.0,
            p_pair_either: 0.0,
            leaves: 0,
        }
    }

    /// Probability the next card is `rank`, given what is already out.
    fn p_next(&self, rank: usize) -> f64 {
        self.left[rank] as f64 / self.remaining as f64
    }

    fn take(&mut self, rank: usize) {
        self.left[rank] -= 1;
        self.remaining -= 1;
    }

    fn put_back(&mut self, rank: usize) {
        self.left[rank] += 1;
        self.remaining += 1;
    }

    /// Settle a finished coup, weighting every bet by the branch probability.
    fn leaf(&mut self, cards: &[Card], p: f64) {
        // `play_round` consumes exactly the cards this branch decided on, so the
        // hands, totals and outcome are produced by production code.
        let round = play_round(&mut cards.iter().copied());
        debug_assert_eq!(
            round.player.cards.len() + round.banker.cards.len(),
            cards.len(),
            "branch supplied a different number of cards than the round used"
        );

        for (i, (_, bet)) in BETS.iter().enumerate() {
            // stake 1 unit, in cents-free units: settle_side is linear in stake.
            self.ev[i] += p * settle_side(*bet, 1_000_000, &round) as f64 / 1_000_000.0;
        }
        for (i, (_, pay)) in CANDIDATES.iter().enumerate() {
            self.cand_ev[i] += p * pay(&round);
        }
        match round.outcome {
            Outcome::PlayerWin => self.p_player += p,
            Outcome::BankerWin => self.p_banker += p,
            Outcome::Tie => self.p_tie += p,
        }
        if round.player.is_pair() || round.banker.is_pair() {
            self.p_pair_either += p;
        }
        self.p_total += p;
        self.leaves += 1;
    }
}

fn card(rank: usize) -> Card {
    Card { rank: RANKS[rank], suit: Suit::Spades }
}

/// Walk every coup. Deal order is P, B, P, B, then the player third, then the
/// banker third — the same order `play_round` reads its source in.
fn enumerate(w: &mut Walk) {
    for p1 in 0..13 {
        if w.left[p1] == 0 {
            continue;
        }
        let pr1 = w.p_next(p1);
        w.take(p1);
        for b1 in 0..13 {
            if w.left[b1] == 0 {
                continue;
            }
            let pr2 = pr1 * w.p_next(b1);
            w.take(b1);
            for p2 in 0..13 {
                if w.left[p2] == 0 {
                    continue;
                }
                let pr3 = pr2 * w.p_next(p2);
                w.take(p2);
                for b2 in 0..13 {
                    if w.left[b2] == 0 {
                        continue;
                    }
                    let pr4 = pr3 * w.p_next(b2);
                    w.take(b2);
                    four_card_prefix(w, [p1, b1, p2, b2], pr4);
                    w.put_back(b2);
                }
                w.put_back(p2);
            }
            w.put_back(b1);
        }
        w.put_back(p1);
    }
}

fn four_card_prefix(w: &mut Walk, idx: [usize; 4], p: f64) {
    let [p1, b1, p2, b2] = idx;
    let base = [card(p1), card(b1), card(p2), card(b2)];
    let player = Hand { cards: vec![base[0], base[2]] };
    let banker = Hand { cards: vec![base[1], base[3]] };

    // A natural on either side ends the coup with four cards.
    if player.is_natural() || banker.is_natural() {
        w.leaf(&base, p);
        return;
    }

    let bt = banker.total();
    if player_draws(player.total()) {
        for p3 in 0..13 {
            if w.left[p3] == 0 {
                continue;
            }
            let p5 = p * w.p_next(p3);
            w.take(p3);
            let third_value = card(p3).value();
            if banker_draws(bt, Some(third_value)) {
                for b3 in 0..13 {
                    if w.left[b3] == 0 {
                        continue;
                    }
                    let p6 = p5 * w.p_next(b3);
                    w.take(b3);
                    w.leaf(&[base[0], base[1], base[2], base[3], card(p3), card(b3)], p6);
                    w.put_back(b3);
                }
            } else {
                w.leaf(&[base[0], base[1], base[2], base[3], card(p3)], p5);
            }
            w.put_back(p3);
        }
    } else if banker_draws(bt, None) {
        for b3 in 0..13 {
            if w.left[b3] == 0 {
                continue;
            }
            let p5 = p * w.p_next(b3);
            w.take(b3);
            w.leaf(&[base[0], base[1], base[2], base[3], card(b3)], p5);
            w.put_back(b3);
        }
    } else {
        w.leaf(&base, p);
    }
}

#[test]
fn exact_probabilities_and_house_edges() {
    let mut w = Walk::new();
    enumerate(&mut w);

    eprintln!("\nenumerated {} coups (exact, fresh 8-deck shoe)\n", w.leaves);
    eprintln!("total probability   {:.12}", w.p_total);
    eprintln!("Player win          {:.6}%", w.p_player * 100.0);
    eprintln!("Banker win          {:.6}%", w.p_banker * 100.0);
    eprintln!("Tie                 {:.6}%", w.p_tie * 100.0);
    eprintln!("either hand pairs   {:.6}%\n", w.p_pair_either * 100.0);

    eprintln!("{:<16}{:>14}", "bet", "house edge");
    for (i, (name, _)) in BETS.iter().enumerate() {
        eprintln!("{name:<16}{:>13.4}%", -w.ev[i] * 100.0);
    }
    eprintln!("\n{:<16}{:>14}", "candidate", "house edge");
    for (i, (name, _)) in CANDIDATES.iter().enumerate() {
        eprintln!("{name:<16}{:>13.4}%", -w.cand_ev[i] * 100.0);
    }

    // Self-check: the walk must be a partition of the sample space.
    assert!(
        (w.p_total - 1.0).abs() < 1e-9,
        "leaf probabilities summed to {} — the enumeration is not exhaustive",
        w.p_total
    );

    // Canonical 8-deck punto banco figures. These are exact, so the tolerance
    // only absorbs f64 accumulation, not statistical error.
    assert!((w.p_banker - 0.458_597).abs() < 1e-5, "banker {}", w.p_banker);
    assert!((w.p_player - 0.446_247).abs() < 1e-5, "player {}", w.p_player);
    assert!((w.p_tie - 0.095_156).abs() < 1e-5, "tie {}", w.p_tie);

    // Published 8-deck side-bet house edges, to 2 decimals as they are usually
    // quoted. The band is 0.2pp: loose enough for the last quoted digit, far
    // tighter than the ~10pp a wrong multiplier or win condition would move an
    // edge. A failure here is a real paytable defect, not noise — there is no
    // noise in an exact walk.
    let published: [(&str, f64); 9] = [
        ("PlayerPair", 0.1036),
        ("BankerPair", 0.1036),
        ("Dragon7", 0.0761),
        ("Panda8", 0.1019),
        ("DragonBonus(P)", 0.0265),
        ("DragonBonus(B)", 0.0937),
        ("BigTiger", 0.1525),
        ("SmallTiger", 0.1433),
        ("TigerPair", 0.1612),
    ];
    let mut off = Vec::new();
    for (name, quoted) in published {
        let i = BETS.iter().position(|(n, _)| *n == name).unwrap();
        let got = -w.ev[i];
        let delta = (got - quoted).abs();
        eprintln!("{name:<16}exact {:>8.4}%  published {:>7.2}%  Δ {:>6.4}pp", got * 100.0, quoted * 100.0, delta * 100.0);
        if delta >= 2e-3 {
            off.push(format!("{name}: exact {:.4}% vs published {:.2}%", got * 100.0, quoted * 100.0));
        }
    }
    assert!(off.is_empty(), "paytable disagreements: {off:?}");
}
