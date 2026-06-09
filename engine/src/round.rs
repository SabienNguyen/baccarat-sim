use crate::card::Card;
use crate::hand::Hand;
use crate::rules::{banker_draws, player_draws};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum Outcome {
    PlayerWin,
    BankerWin,
    Tie,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RoundResult {
    pub player: Hand,
    pub banker: Hand,
    pub outcome: Outcome,
    /// Human-readable trace of each drawing decision, for explain-the-rule mode.
    pub trace: Vec<String>,
}

fn decide_outcome(player: &Hand, banker: &Hand) -> Outcome {
    match player.total().cmp(&banker.total()) {
        std::cmp::Ordering::Greater => Outcome::PlayerWin,
        std::cmp::Ordering::Less => Outcome::BankerWin,
        std::cmp::Ordering::Equal => Outcome::Tie,
    }
}

/// Play one round, drawing cards from `source` in dealing order.
/// Panics if the source runs dry (callers guarantee a sufficiently full shoe).
pub fn play_round(source: &mut impl Iterator<Item = Card>) -> RoundResult {
    let mut trace: Vec<String> = Vec::new();

    // Deal order: P, B, P, B
    let p1 = source.next().expect("card source exhausted mid-round");
    let b1 = source.next().expect("card source exhausted mid-round");
    let p2 = source.next().expect("card source exhausted mid-round");
    let b2 = source.next().expect("card source exhausted mid-round");

    let mut player = Hand { cards: vec![p1, p2] };
    let mut banker = Hand { cards: vec![b1, b2] };

    // Naturals end the round immediately, no third cards.
    if player.is_natural() || banker.is_natural() {
        trace.push(format!(
            "Natural — player {} vs banker {}, no draws.",
            player.total(),
            banker.total()
        ));
        let outcome = decide_outcome(&player, &banker);
        return RoundResult { player, banker, outcome, trace };
    }

    // Player draws on 0–5.
    let player_third: Option<u8> = if player_draws(player.total()) {
        let card = source.next().expect("card source exhausted mid-round");
        let cv = card.value();
        trace.push(format!(
            "Player {} -> draws a third card ({}).",
            player.total(),
            cv
        ));
        player.cards.push(card);
        Some(cv)
    } else {
        trace.push(format!("Player stands on {}.", player.total()));
        None
    };

    // Banker draws per the tableau.
    if banker_draws(banker.total(), player_third) {
        let card = source.next().expect("card source exhausted mid-round");
        trace.push(format!(
            "Banker {} -> draws a third card ({}) per tableau.",
            banker.total(),
            card.value()
        ));
        banker.cards.push(card);
    } else {
        trace.push(format!("Banker stands on {}.", banker.total()));
    }

    let outcome = decide_outcome(&player, &banker);
    RoundResult { player, banker, outcome, trace }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::card::{Card, Rank, Suit};

    fn c(rank: Rank) -> Card {
        Card { rank, suit: Suit::Clubs }
    }

    // Deal order is P, B, P, B, then player's third, then banker's third.
    #[test]
    fn natural_nine_ends_immediately() {
        // Player: 4,5 = 9 (natural). Banker: 2,3 = 5. No draws.
        let cards = vec![c(Rank::Four), c(Rank::Two), c(Rank::Five), c(Rank::Three)];
        let r = play_round(&mut cards.into_iter());
        assert_eq!(r.player.cards.len(), 2);
        assert_eq!(r.banker.cards.len(), 2);
        assert_eq!(r.outcome, Outcome::PlayerWin);
    }

    #[test]
    fn player_draws_then_banker_stands_on_seven() {
        // Player: 2,3 = 5 -> draws. Banker: 3,4 = 7 -> stands.
        // Player third: 4 -> player total 9. Banker stays 7. Player wins.
        let cards = vec![
            c(Rank::Two), c(Rank::Three), // P
            c(Rank::Three), c(Rank::Four), // B
            c(Rank::Four),                 // P third
        ];
        let r = play_round(&mut cards.into_iter());
        assert_eq!(r.player.cards.len(), 3);
        assert_eq!(r.banker.cards.len(), 2);
        assert_eq!(r.player.total(), 9);
        assert_eq!(r.banker.total(), 7);
        assert_eq!(r.outcome, Outcome::PlayerWin);
    }

    #[test]
    fn both_draw_and_tie() {
        // Player: 2,2 = 4 -> draws. Banker: 2,2 = 4 -> with player third 2, bt4 draws.
        // Player third: 2 -> player 6. Banker third: 2 -> banker 6. Tie.
        let cards = vec![
            c(Rank::Two), c(Rank::Two), // P = 4
            c(Rank::Two), c(Rank::Two), // B = 4
            c(Rank::Two),               // P third -> 6
            c(Rank::Two),               // B third -> 6
        ];
        let r = play_round(&mut cards.into_iter());
        assert_eq!(r.player.total(), 6);
        assert_eq!(r.banker.total(), 6);
        assert_eq!(r.outcome, Outcome::Tie);
    }

    #[test]
    fn player_stands_then_banker_draws() {
        // Player: 3,3 = 6 -> stands. Banker: 2,2 = 4, player stood -> banker draws on 0-5.
        // Banker third: 3 -> banker 7. Player 6 vs banker 7 -> banker wins.
        let cards = vec![
            c(Rank::Three), c(Rank::Two), // P1, B1
            c(Rank::Three), c(Rank::Two), // P2, B2  => player 6, banker 4
            c(Rank::Three),               // banker third -> 7
        ];
        let r = play_round(&mut cards.into_iter());
        assert_eq!(r.player.cards.len(), 2);
        assert_eq!(r.banker.cards.len(), 3);
        assert_eq!(r.banker.total(), 7);
        assert_eq!(r.outcome, Outcome::BankerWin);
    }
}
