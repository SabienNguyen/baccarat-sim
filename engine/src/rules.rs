/// Player draws a third card on totals 0–5, stands on 6–7.
/// Only called when neither hand is a natural.
pub fn player_draws(player_total: u8) -> bool {
    player_total <= 5
}

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
