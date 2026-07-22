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
            0..=2 => true,
            3 => pt != 8,
            4 => (2..=7).contains(&pt),
            5 => (4..=7).contains(&pt),
            6 => (6..=7).contains(&pt),
            _ => false, // 7 (and any higher, defensively) stands
        },
    }
}

/// A plain-language reason for the Banker's third-card decision, given the
/// Banker's two-card total and the value of the Player's third card (`None` if
/// the Player stood). It names the tableau condition *and* the card actually
/// turned, so a learner can see exactly why one hand has three cards and the
/// other has two.
pub fn banker_reason(banker_total: u8, player_third: Option<u8>) -> String {
    match player_third {
        None => {
            if banker_total <= 5 {
                "with the Player standing, the Banker draws on 0–5".to_string()
            } else {
                "with the Player standing, the Banker stands on 6–7".to_string()
            }
        }
        Some(pt) => match banker_total {
            0..=2 => "on 0–2 the Banker always draws, whatever the Player drew".to_string(),
            3 => format!("on 3 the Banker draws unless the Player's third card is an 8 (it was {pt})"),
            4 => format!("on 4 the Banker draws only when the Player's third card is 2–7 (it was {pt})"),
            5 => format!("on 5 the Banker draws only when the Player's third card is 4–7 (it was {pt})"),
            6 => format!("on 6 the Banker draws only when the Player's third card is 6–7 (it was {pt})"),
            _ => "the Banker always stands on 7".to_string(),
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

    // The plain-language reason must name the tableau condition AND the actual
    // player third card, so a novice can see why the counts landed as they did.
    #[test]
    fn banker_reason_explains_each_branch() {
        // player stood: the simple 0–5 draw / 6–7 stand split
        assert!(banker_reason(4, None).contains("0–5"));
        assert!(banker_reason(6, None).contains("6–7"));
        // player drew: condition + the card that was actually turned
        assert!(banker_reason(1, Some(9)).contains("always draws"));
        let three = banker_reason(3, Some(8));
        assert!(three.contains("unless") && three.contains("it was 8"));
        let four = banker_reason(4, Some(5));
        assert!(four.contains("2–7") && four.contains("it was 5"));
        assert!(banker_reason(5, Some(3)).contains("4–7"));
        let six = banker_reason(6, Some(1));
        assert!(six.contains("6–7") && six.contains("it was 1"));
        assert!(banker_reason(7, Some(2)).contains("stands on 7"));
    }
}
