/// Player draws a third card on totals 0–5, stands on 6–7.
/// Only called when neither hand is a natural.
pub fn player_draws(player_total: u8) -> bool {
    player_total <= 5
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
