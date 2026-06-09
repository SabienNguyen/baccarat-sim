//! Curated baccarat terminology shared by all front-ends.

use serde::{Deserialize, Serialize};

/// One glossary term. `term` is a stable canonical key (e.g. "monkey") that
/// front-ends map `Event` tags and UI highlights to; the other fields are display copy.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "wasm", derive(tsify_next::Tsify))]
#[cfg_attr(feature = "wasm", tsify(into_wasm_abi))]
pub struct GlossaryEntry {
    pub term: String,
    pub label: String,
    pub short: String,
    pub long: String,
}

/// The curated v1 glossary. Pure data, no logic.
pub fn glossary() -> Vec<GlossaryEntry> {
    fn e(term: &str, label: &str, short: &str, long: &str) -> GlossaryEntry {
        GlossaryEntry {
            term: term.to_string(),
            label: label.to_string(),
            short: short.to_string(),
            long: long.to_string(),
        }
    }
    vec![
        e("player", "Player", "One of the two hands you can bet on.",
          "The Player (Punto) is one of the two hands dealt each round. Betting Player pays even money on a win."),
        e("banker", "Banker", "The other bettable hand; wins pay even money minus commission.",
          "The Banker (Banco) hand wins slightly more often, so a winning Banker bet pays even money minus a 5% commission (in commission play)."),
        e("tie", "Tie", "Both hands finish with the same total.",
          "A Tie occurs when Player and Banker reach equal totals. Player and Banker bets push; a Tie side bet typically pays 8:1."),
        e("natural", "Natural", "An 8 or 9 on the first two cards — an instant stand.",
          "A two-card total of 8 or 9 is a Natural. Both hands stand immediately and no third card is drawn; the higher natural wins."),
        e("monkey", "Monkey", "Slang for any 10, J, Q, or K — a zero-value card.",
          "A Monkey is any ten-value card (10, Jack, Queen, King). It counts as zero, so drawing one never changes a hand's total. Pure table slang players call out when hoping to land a zero."),
        e("pair", "Pair", "First two cards of a hand share the same rank.",
          "When a hand's first two cards are the same rank, that hand has a pair — the basis for the Player Pair and Banker Pair side bets, usually paying 11:1."),
        e("commission", "Commission", "The 5% fee on winning Banker bets.",
          "In traditional baccarat a winning Banker bet pays even money minus a 5% commission, offsetting the Banker's statistical edge."),
        e("ez-baccarat", "EZ Baccarat", "Commission-free variant; a 3-card Banker 7 pushes.",
          "EZ Baccarat pays winning Banker bets even money with no commission. Instead, a Banker win on a three-card total of 7 (the Dragon 7 condition) pushes the Banker bet."),
        e("dragon-7", "Dragon 7", "Side bet: Banker wins with a three-card total of 7.",
          "The Dragon 7 is an EZ Baccarat side bet that pays 40:1 when the Banker wins with exactly three cards totaling 7."),
        e("panda-8", "Panda 8", "Side bet: Player wins with a three-card total of 8.",
          "The Panda 8 is an EZ Baccarat side bet that pays 25:1 when the Player wins with exactly three cards totaling 8."),
        e("dragon-bonus", "Dragon Bonus", "Side bet on a big or natural win margin.",
          "The Dragon Bonus pays on the chosen hand winning by a large margin (up to 30:1 for a 9-point gap) or winning with a natural; a non-natural win for the other side loses."),
        e("tiger", "Tiger", "Side bet: Banker wins on a total of 6.",
          "The Tiger pays 12:1 when the Banker wins with a two-card 6 and 20:1 with a three-card 6."),
        e("big-tiger", "Big Tiger", "Side bet: Banker wins with a three-card 6.",
          "The Big Tiger pays 50:1 when the Banker wins with a three-card total of 6."),
        e("small-tiger", "Small Tiger", "Side bet: Banker wins with a two-card 6.",
          "The Small Tiger pays 22:1 when the Banker wins with a two-card total of 6."),
        e("tiger-tie", "Tiger Tie", "Side bet: the round ties on 6.",
          "The Tiger Tie pays 35:1 when the round is a Tie with both hands totaling 6."),
        e("tiger-pair", "Tiger Pair", "Side bet on either hand's first-two-card pair.",
          "The Tiger Pair pays on a pair in either hand, with bigger payouts for a double pair or twin identical pairs."),
        e("squeeze", "Squeeze", "Slowly revealing a card by its edge for suspense.",
          "The squeeze is the ritual of bending and slowly exposing a card edge-first, revealing the suit sliver before the full rank — pure drama, no effect on the result."),
        e("shoe", "Shoe", "The dealing box holding the shuffled decks.",
          "A shoe holds several shuffled decks (commonly eight) from which cards are dealt until the cut card ends the shoe."),
        e("bead-plate", "Bead Plate", "Scoreboard: one bead per round in play order.",
          "The Bead Plate records every round as a colored bead in order — red for Banker, blue for Player, green for Tie — filling top-to-bottom then left-to-right."),
        e("big-road", "Big Road", "Scoreboard: wins in columns, ties as slashes.",
          "The Big Road is the primary grid: each Player/Banker win starts or extends a column of the same color, ties mark a slash, and pairs add corner dots. The derived roads are computed from it."),
        e("big-eye-boy", "Big Eye Boy", "Derived road tracking the Big Road's regularity.",
          "The Big Eye Boy starts after the Big Road's second column and marks red for orderly repetition or blue for choppiness — a trend-of-the-trend road."),
        e("small-road", "Small Road", "Derived road skipping the column one left.",
          "The Small Road is like the Big Eye Boy but compares against the column two back, offering a coarser read of the Big Road's pattern."),
        e("cockroach-pig", "Cockroach Pig", "Derived road skipping two columns left.",
          "The Cockroach Pig (Cockroach Road) compares against the column three back — the longest-range of the three derived pattern roads."),
    ]
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashSet;

    #[test]
    fn glossary_is_populated_and_keyed() {
        let entries = glossary();
        assert!(entries.len() >= 20, "expected ~20 terms, got {}", entries.len());

        // Keys are unique.
        let keys: HashSet<&str> = entries.iter().map(|e| e.term.as_str()).collect();
        assert_eq!(keys.len(), entries.len(), "duplicate term keys");

        // Every entry has non-empty copy.
        for e in &entries {
            assert!(!e.term.is_empty() && !e.label.is_empty());
            assert!(!e.short.is_empty() && !e.long.is_empty(), "empty copy for {}", e.term);
        }

        // A few stable keys front-ends depend on must exist.
        for required in ["monkey", "player", "banker", "natural", "big-eye-boy"] {
            assert!(keys.contains(required), "missing required term '{required}'");
        }
    }
}
