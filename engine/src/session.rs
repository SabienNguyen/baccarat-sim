use crate::card::{Card, Suit};
use crate::hand::Hand;
use crate::round::{play_round, Outcome, RoundResult};
use crate::shoe::Shoe;
use crate::scoreboard::{derive_scoreboard, RoundRecord, ScoreboardSnapshot, Side};
use crate::settle::{settle_with, Bet, BetSpot, Ruleset};
use crate::sidebets::{settle_side, SideBet};
use serde::{Deserialize, Serialize};

/// How a session is configured at creation. All money is in cents.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct SessionConfig {
    pub starting_bankroll: i64,
    pub table_min: i64,
    pub table_max: i64,
    pub ruleset: Ruleset,
    pub seed: u64,
}

/// A bet kind: a main-bet spot or a side bet.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum BetKind {
    Main(BetSpot),
    Side(SideBet),
}

/// A staged or resolved bet. `amount` is the stake in cents.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct PlacedBet {
    pub kind: BetKind,
    pub amount: i64,
}

/// A resolved bet's net result in cents (profit, -stake, or 0 push).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct BetPayout {
    pub bet: PlacedBet,
    pub net: i64,
}

/// The corner-squeeze hint: only the card's suit shows first.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct Pip {
    pub suit: Suit,
}

/// A card as the front-end may see it. Unrevealed cards hide their identity.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum CardView {
    FaceDown,
    Peeked { sliver: Pip },
    FaceUp(Card),
}

/// A hand as rendered to the front-end. `total` is `None` until every card is face up.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct HandView {
    pub cards: Vec<CardView>,
    pub total: Option<u8>,
}

/// The phase tag carried in a snapshot. `Settled` is the transient view `settle()` returns.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum PhaseTag {
    Betting,
    Dealing,
    Settled,
}

/// Structured, language-neutral tags front-ends turn into narration and glossary highlights.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum Event {
    Natural { side: Side, total: u8 },
    Monkey { hand: Side, index: usize },
    Pair { side: Side },
    ThirdCard { side: Side, reason: String },
    /// The round resolved. `result` is the `Outcome` (which may be `Tie`).
    Win { result: Outcome, player: u8, banker: u8 },
}

/// The single serializable view a front-end renders.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct RoundSnapshot {
    pub phase: PhaseTag,
    pub player: HandView,
    pub banker: HandView,
    pub bets: Vec<PlacedBet>,
    pub bankroll: i64,
    pub table_min: i64,
    pub table_max: i64,
    pub outcome: Option<Outcome>,
    pub payouts: Option<Vec<BetPayout>>,
    pub events: Vec<Event>,
    pub scoreboard: ScoreboardSnapshot,
    pub explain: Vec<String>,
}

/// A command that could not be applied. The session is unchanged on `Err`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum CommandError {
    WrongPhase { expected: PhaseTag, found: PhaseTag },
    BetBelowMinimum { min: i64, got: i64 },
    BetAboveMaximum { max: i64, got: i64 },
    InsufficientBankroll { needed: i64, have: i64 },
    NoBetsPlaced,
    BadCardIndex { hand: Side, index: usize },
}

/// Per-card reveal status during the squeeze.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum CardStatus {
    FaceDown,
    Peeked,
    FaceUp,
}

/// Reveal status for both hands, indexed to match each hand's cards.
struct RevealState {
    player: Vec<CardStatus>,
    banker: Vec<CardStatus>,
}

/// In-flight round state.
enum Phase {
    Betting { bets: Vec<PlacedBet> },
    Dealing { round: RoundResult, reveal: RevealState, bets: Vec<PlacedBet> },
}

/// The stateful baccarat game session.
pub struct Session {
    shoe: Shoe,
    shoes_dealt: u64,
    bankroll: i64,
    config: SessionConfig,
    history: Vec<RoundRecord>,
    phase: Phase,
}

impl Session {
    /// Start a fresh session in the betting phase.
    pub fn new(config: SessionConfig) -> Self {
        let shoe = Shoe::new_seeded(config.seed);
        Session {
            shoe,
            shoes_dealt: 0,
            bankroll: config.starting_bankroll,
            history: Vec::new(),
            phase: Phase::Betting { bets: Vec::new() },
            config,
        }
    }

    /// The current state as a snapshot.
    pub fn snapshot(&self) -> RoundSnapshot {
        self.current_snapshot()
    }

    /// Stage a bet during the betting phase.
    pub fn place_bet(&mut self, kind: BetKind, amount: i64) -> Result<RoundSnapshot, CommandError> {
        let table_min = self.config.table_min;
        let table_max = self.config.table_max;
        let bankroll = self.bankroll;

        let bets = match &mut self.phase {
            Phase::Betting { bets } => bets,
            Phase::Dealing { .. } => {
                return Err(CommandError::WrongPhase { expected: PhaseTag::Betting, found: PhaseTag::Dealing })
            }
        };

        if amount < table_min {
            return Err(CommandError::BetBelowMinimum { min: table_min, got: amount });
        }
        if amount > table_max {
            return Err(CommandError::BetAboveMaximum { max: table_max, got: amount });
        }
        let staked: i64 = bets.iter().map(|b| b.amount).sum();
        if staked + amount > bankroll {
            return Err(CommandError::InsufficientBankroll { needed: staked + amount, have: bankroll });
        }

        bets.push(PlacedBet { kind, amount });
        Ok(self.current_snapshot())
    }

    /// Remove all staged bets.
    pub fn clear_bets(&mut self) -> Result<RoundSnapshot, CommandError> {
        match &mut self.phase {
            Phase::Betting { bets } => bets.clear(),
            Phase::Dealing { .. } => {
                return Err(CommandError::WrongPhase { expected: PhaseTag::Betting, found: PhaseTag::Dealing })
            }
        }
        Ok(self.current_snapshot())
    }

    fn render_round(
        &self,
        tag: PhaseTag,
        round: &RoundResult,
        reveal: &RevealState,
        bets: &[PlacedBet],
        payouts: Option<Vec<BetPayout>>,
    ) -> RoundSnapshot {
        let player = hand_view(&round.player, &reveal.player);
        let banker = hand_view(&round.banker, &reveal.banker);
        let fully_revealed = player.total.is_some() && banker.total.is_some();
        RoundSnapshot {
            phase: tag,
            player,
            banker,
            bets: bets.to_vec(),
            bankroll: self.bankroll,
            table_min: self.config.table_min,
            table_max: self.config.table_max,
            outcome: if fully_revealed { Some(round.outcome) } else { None },
            payouts,
            events: derive_events(round, reveal),
            scoreboard: derive_scoreboard(&self.history),
            explain: round.trace.clone(),
        }
    }

    fn reshuffle(&mut self) {
        self.shoes_dealt += 1;
        self.shoe = Shoe::new_seeded(self.config.seed.wrapping_add(self.shoes_dealt));
    }

    /// Deal a full round face-down. Requires at least one staged bet.
    pub fn deal_round(&mut self) -> Result<RoundSnapshot, CommandError> {
        let bets = match &self.phase {
            Phase::Betting { bets } if !bets.is_empty() => bets.clone(),
            Phase::Betting { .. } => return Err(CommandError::NoBetsPlaced),
            Phase::Dealing { .. } => {
                return Err(CommandError::WrongPhase { expected: PhaseTag::Betting, found: PhaseTag::Dealing })
            }
        };

        if self.shoe.remaining() < 6 {
            self.reshuffle();
        }

        let round = play_round(&mut self.shoe);
        let reveal = RevealState {
            player: vec![CardStatus::FaceDown; round.player.cards.len()],
            banker: vec![CardStatus::FaceDown; round.banker.cards.len()],
        };
        self.phase = Phase::Dealing { round, reveal, bets };
        Ok(self.current_snapshot())
    }

    /// Squeeze a single card to its suit sliver.
    pub fn peek(&mut self, hand: Side, index: usize) -> Result<RoundSnapshot, CommandError> {
        self.set_status(hand, index, CardStatus::Peeked)
    }

    /// Turn a single card fully face up.
    pub fn reveal(&mut self, hand: Side, index: usize) -> Result<RoundSnapshot, CommandError> {
        self.set_status(hand, index, CardStatus::FaceUp)
    }

    fn set_status(&mut self, hand: Side, index: usize, to: CardStatus) -> Result<RoundSnapshot, CommandError> {
        match &mut self.phase {
            Phase::Dealing { reveal, .. } => {
                let statuses = match hand {
                    Side::Player => &mut reveal.player,
                    Side::Banker => &mut reveal.banker,
                };
                if index >= statuses.len() {
                    return Err(CommandError::BadCardIndex { hand, index });
                }
                // Peeking must never downgrade an already-revealed card.
                if !(to == CardStatus::Peeked && statuses[index] == CardStatus::FaceUp) {
                    statuses[index] = to;
                }
            }
            Phase::Betting { .. } => {
                return Err(CommandError::WrongPhase { expected: PhaseTag::Dealing, found: PhaseTag::Betting })
            }
        }
        Ok(self.current_snapshot())
    }

    /// Resolve the dealt round: auto-reveal, pay bets, update bankroll/history,
    /// and return to the betting phase. The returned snapshot is tagged `Settled`.
    pub fn settle(&mut self) -> Result<RoundSnapshot, CommandError> {
        let (round, bets) = match &self.phase {
            Phase::Dealing { round, bets, .. } => (round.clone(), bets.clone()),
            Phase::Betting { .. } => {
                return Err(CommandError::WrongPhase { expected: PhaseTag::Dealing, found: PhaseTag::Betting })
            }
        };

        let payouts: Vec<BetPayout> = bets
            .iter()
            .map(|b| BetPayout { bet: *b, net: self.payout_for(b, &round) })
            .collect();
        let total_net: i64 = payouts.iter().map(|p| p.net).sum();
        self.bankroll += total_net;
        self.history.push(RoundRecord::from_round(&round));

        let reveal = RevealState {
            player: vec![CardStatus::FaceUp; round.player.cards.len()],
            banker: vec![CardStatus::FaceUp; round.banker.cards.len()],
        };
        let snapshot = self.render_round(PhaseTag::Settled, &round, &reveal, &bets, Some(payouts));
        self.phase = Phase::Betting { bets: Vec::new() };
        Ok(snapshot)
    }

    /// Replace the shoe with a fresh shuffle. Bankroll and history persist.
    pub fn new_shoe(&mut self) -> Result<RoundSnapshot, CommandError> {
        match &self.phase {
            Phase::Betting { .. } => {}
            Phase::Dealing { .. } => {
                return Err(CommandError::WrongPhase { expected: PhaseTag::Betting, found: PhaseTag::Dealing })
            }
        }
        self.reshuffle();
        Ok(self.current_snapshot())
    }

    fn payout_for(&self, bet: &PlacedBet, round: &RoundResult) -> i64 {
        match bet.kind {
            BetKind::Main(spot) => settle_with(Bet { spot, amount: bet.amount }, round, self.config.ruleset),
            BetKind::Side(side_bet) => settle_side(side_bet, bet.amount, round),
        }
    }

    fn current_snapshot(&self) -> RoundSnapshot {
        match &self.phase {
            Phase::Betting { bets } => RoundSnapshot {
                phase: PhaseTag::Betting,
                player: HandView { cards: Vec::new(), total: None },
                banker: HandView { cards: Vec::new(), total: None },
                bets: bets.clone(),
                bankroll: self.bankroll,
                table_min: self.config.table_min,
                table_max: self.config.table_max,
                outcome: None,
                payouts: None,
                events: Vec::new(),
                scoreboard: derive_scoreboard(&self.history),
                explain: Vec::new(),
            },
            Phase::Dealing { round, reveal, bets } => {
                self.render_round(PhaseTag::Dealing, round, reveal, bets, None)
            }
        }
    }
}

fn hand_view(hand: &Hand, status: &[CardStatus]) -> HandView {
    let cards = hand
        .cards
        .iter()
        .zip(status)
        .map(|(c, s)| match s {
            CardStatus::FaceDown => CardView::FaceDown,
            CardStatus::Peeked => CardView::Peeked { sliver: Pip { suit: c.suit } },
            CardStatus::FaceUp => CardView::FaceUp(*c),
        })
        .collect();
    let all_up = !hand.cards.is_empty() && status.iter().all(|s| matches!(s, CardStatus::FaceUp));
    HandView { cards, total: if all_up { Some(hand.total()) } else { None } }
}

fn derive_events(round: &RoundResult, reveal: &RevealState) -> Vec<Event> {
    let mut events = Vec::new();

    for (side, hand, status) in [
        (Side::Player, &round.player, &reveal.player),
        (Side::Banker, &round.banker, &reveal.banker),
    ] {
        let up = |i: usize| matches!(status.get(i), Some(CardStatus::FaceUp));

        if hand.cards.len() >= 2 && up(0) && up(1) && hand.is_pair() {
            events.push(Event::Pair { side });
        }
        if hand.cards.len() == 2 && up(0) && up(1) && hand.is_natural() {
            events.push(Event::Natural { side, total: hand.total() });
        }
        for (i, c) in hand.cards.iter().enumerate() {
            if up(i) && c.value() == 0 {
                events.push(Event::Monkey { hand: side, index: i });
            }
        }
        if hand.cards.len() == 3 && up(2) {
            events.push(Event::ThirdCard { side, reason: third_card_reason(round, side) });
        }
    }

    let player_up = !reveal.player.is_empty()
        && reveal.player.iter().all(|s| matches!(s, CardStatus::FaceUp));
    let banker_up = !reveal.banker.is_empty()
        && reveal.banker.iter().all(|s| matches!(s, CardStatus::FaceUp));
    if player_up && banker_up {
        events.push(Event::Win {
            result: round.outcome,
            player: round.player.total(),
            banker: round.banker.total(),
        });
    }

    events
}

/// Pull the relevant draw-trace line for a side's third card, or a default.
fn third_card_reason(round: &RoundResult, side: Side) -> String {
    let needle = match side {
        Side::Player => "Player",
        Side::Banker => "Banker",
    };
    round
        .trace
        .iter()
        .find(|line| line.contains(needle) && line.contains("third"))
        .cloned()
        .unwrap_or_else(|| format!("{needle} drew a third card"))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn cfg() -> SessionConfig {
        SessionConfig {
            starting_bankroll: 100_000,
            table_min: 500,
            table_max: 50_000,
            ruleset: Ruleset::Commission,
            seed: 42,
        }
    }

    #[test]
    fn new_session_starts_in_betting() {
        let s = Session::new(cfg());
        let snap = s.snapshot();
        assert_eq!(snap.phase, PhaseTag::Betting);
        assert_eq!(snap.bankroll, 100_000);
        assert_eq!(snap.table_min, 500);
        assert!(snap.bets.is_empty());
        assert!(snap.player.cards.is_empty());
        assert!(snap.banker.cards.is_empty());
        assert_eq!(snap.outcome, None);
        assert!(snap.payouts.is_none());
        assert!(snap.scoreboard.bead_plate.cells.is_empty());
    }

    #[test]
    fn place_valid_bet_stages_it() {
        let mut s = Session::new(cfg());
        let snap = s.place_bet(BetKind::Main(BetSpot::Player), 1_000).unwrap();
        assert_eq!(snap.bets.len(), 1);
        assert_eq!(snap.bets[0].amount, 1_000);
        assert_eq!(snap.bets[0].kind, BetKind::Main(BetSpot::Player));
    }

    #[test]
    fn bet_below_minimum_rejected_and_state_unchanged() {
        let mut s = Session::new(cfg());
        let err = s.place_bet(BetKind::Main(BetSpot::Player), 100).unwrap_err();
        assert_eq!(err, CommandError::BetBelowMinimum { min: 500, got: 100 });
        assert!(s.snapshot().bets.is_empty());
    }

    #[test]
    fn bet_above_maximum_rejected() {
        let mut s = Session::new(cfg());
        let err = s.place_bet(BetKind::Main(BetSpot::Banker), 60_000).unwrap_err();
        assert_eq!(err, CommandError::BetAboveMaximum { max: 50_000, got: 60_000 });
    }

    #[test]
    fn bets_exceeding_bankroll_rejected() {
        let mut s = Session::new(cfg());
        s.place_bet(BetKind::Main(BetSpot::Player), 50_000).unwrap();
        s.place_bet(BetKind::Side(SideBet::PlayerPair), 50_000).unwrap();
        let err = s.place_bet(BetKind::Side(SideBet::BankerPair), 500).unwrap_err();
        assert_eq!(err, CommandError::InsufficientBankroll { needed: 100_500, have: 100_000 });
    }

    #[test]
    fn clear_bets_empties_the_table() {
        let mut s = Session::new(cfg());
        s.place_bet(BetKind::Main(BetSpot::Tie), 1_000).unwrap();
        let snap = s.clear_bets().unwrap();
        assert!(snap.bets.is_empty());
    }

    #[test]
    fn deal_round_enters_dealing_with_hidden_cards() {
        let mut s = Session::new(cfg());
        s.place_bet(BetKind::Main(BetSpot::Player), 1_000).unwrap();
        let snap = s.deal_round().unwrap();
        assert_eq!(snap.phase, PhaseTag::Dealing);
        assert!(snap.player.cards.len() >= 2);
        assert!(snap.banker.cards.len() >= 2);
        assert!(snap.player.cards.iter().all(|c| *c == CardView::FaceDown));
        assert_eq!(snap.player.total, None);
        assert_eq!(snap.banker.total, None);
        assert_eq!(snap.outcome, None);
    }

    #[test]
    fn deal_without_bets_is_rejected() {
        let mut s = Session::new(cfg());
        let err = s.deal_round().unwrap_err();
        assert_eq!(err, CommandError::NoBetsPlaced);
    }

    #[test]
    fn place_bet_in_dealing_is_wrong_phase() {
        let mut s = Session::new(cfg());
        s.place_bet(BetKind::Main(BetSpot::Player), 1_000).unwrap();
        s.deal_round().unwrap();
        let err = s.place_bet(BetKind::Main(BetSpot::Banker), 1_000).unwrap_err();
        assert_eq!(err, CommandError::WrongPhase { expected: PhaseTag::Betting, found: PhaseTag::Dealing });
    }

    #[test]
    fn peek_shows_only_a_sliver() {
        let mut s = Session::new(cfg());
        s.place_bet(BetKind::Main(BetSpot::Player), 1_000).unwrap();
        s.deal_round().unwrap();
        let snap = s.peek(Side::Player, 0).unwrap();
        assert!(matches!(snap.player.cards[0], CardView::Peeked { .. }));
        assert_eq!(snap.player.total, None);
    }

    #[test]
    fn reveal_turns_a_card_face_up() {
        let mut s = Session::new(cfg());
        s.place_bet(BetKind::Main(BetSpot::Player), 1_000).unwrap();
        s.deal_round().unwrap();
        let snap = s.reveal(Side::Player, 0).unwrap();
        assert!(matches!(snap.player.cards[0], CardView::FaceUp(_)));
    }

    #[test]
    fn total_appears_only_when_all_cards_are_face_up() {
        let mut s = Session::new(cfg());
        s.place_bet(BetKind::Main(BetSpot::Player), 1_000).unwrap();
        let dealt = s.deal_round().unwrap();
        let n = dealt.player.cards.len();
        for i in 0..n - 1 {
            s.reveal(Side::Player, i).unwrap();
        }
        assert_eq!(s.snapshot().player.total, None);
        let snap = s.reveal(Side::Player, n - 1).unwrap();
        assert!(snap.player.total.is_some());
    }

    #[test]
    fn bad_card_index_is_rejected() {
        let mut s = Session::new(cfg());
        s.place_bet(BetKind::Main(BetSpot::Player), 1_000).unwrap();
        s.deal_round().unwrap();
        let err = s.reveal(Side::Player, 99).unwrap_err();
        assert_eq!(err, CommandError::BadCardIndex { hand: Side::Player, index: 99 });
    }

    #[test]
    fn peek_in_betting_is_wrong_phase() {
        let mut s = Session::new(cfg());
        let err = s.peek(Side::Player, 0).unwrap_err();
        assert_eq!(err, CommandError::WrongPhase { expected: PhaseTag::Dealing, found: PhaseTag::Betting });
    }

    #[test]
    fn settle_pays_updates_bankroll_and_records_history() {
        let mut s = Session::new(cfg());
        s.place_bet(BetKind::Main(BetSpot::Player), 1_000).unwrap();
        s.deal_round().unwrap();
        let snap = s.settle().unwrap();
        assert_eq!(snap.phase, PhaseTag::Settled);
        assert!(snap.outcome.is_some());
        let payouts = snap.payouts.as_ref().unwrap();
        assert_eq!(payouts.len(), 1);
        assert_eq!(snap.bankroll, 100_000 + payouts[0].net);
        assert_eq!(snap.scoreboard.bead_plate.cells.len(), 1);
        assert!(snap.player.total.is_some());
        assert!(snap.banker.total.is_some());
        assert_eq!(s.snapshot().phase, PhaseTag::Betting);
        assert!(s.snapshot().bets.is_empty());
    }

    #[test]
    fn settle_in_betting_is_wrong_phase() {
        let mut s = Session::new(cfg());
        let err = s.settle().unwrap_err();
        assert_eq!(err, CommandError::WrongPhase { expected: PhaseTag::Dealing, found: PhaseTag::Betting });
    }

    #[test]
    fn new_shoe_resets_cards_but_keeps_bankroll_and_history() {
        let mut s = Session::new(cfg());
        s.place_bet(BetKind::Main(BetSpot::Player), 1_000).unwrap();
        s.deal_round().unwrap();
        let settled = s.settle().unwrap();
        let bankroll_after = settled.bankroll;

        let snap = s.new_shoe().unwrap();
        assert_eq!(snap.phase, PhaseTag::Betting);
        assert_eq!(snap.bankroll, bankroll_after);
        assert_eq!(snap.scoreboard.bead_plate.cells.len(), 1);
    }

    #[test]
    fn new_shoe_in_dealing_is_wrong_phase() {
        let mut s = Session::new(cfg());
        s.place_bet(BetKind::Main(BetSpot::Player), 1_000).unwrap();
        s.deal_round().unwrap();
        let err = s.new_shoe().unwrap_err();
        assert_eq!(err, CommandError::WrongPhase { expected: PhaseTag::Betting, found: PhaseTag::Dealing });
    }

    #[test]
    fn round_snapshot_serde_round_trips() {
        // Play a full round so the snapshot is richly populated.
        let mut session = Session::new(SessionConfig {
            starting_bankroll: 100_000,
            table_min: 100,
            table_max: 10_000,
            ruleset: Ruleset::Commission,
            seed: 42,
        });
        session
            .place_bet(BetKind::Main(BetSpot::Player), 500)
            .unwrap();
        session.deal_round().unwrap();
        let snapshot = session.settle().unwrap();

        let json = serde_json::to_string(&snapshot).expect("serialize");
        let back: RoundSnapshot = serde_json::from_str(&json).expect("deserialize");
        assert_eq!(snapshot, back);
    }

    #[test]
    fn command_error_serde_round_trips() {
        let err = CommandError::WrongPhase {
            expected: PhaseTag::Betting,
            found: PhaseTag::Dealing,
        };
        let json = serde_json::to_string(&err).expect("serialize");
        let back: CommandError = serde_json::from_str(&json).expect("deserialize");
        assert_eq!(err, back);
    }
}

#[cfg(test)]
mod event_tests {
    use super::*;
    use crate::card::{Card, Rank, Suit};
    use crate::hand::Hand;
    use crate::round::RoundResult;

    fn card(rank: Rank) -> Card {
        Card { rank, suit: Suit::Spades }
    }
    fn all_up(n: usize) -> Vec<CardStatus> {
        vec![CardStatus::FaceUp; n]
    }
    fn all_down(n: usize) -> Vec<CardStatus> {
        vec![CardStatus::FaceDown; n]
    }

    #[test]
    fn monkey_event_for_a_revealed_face_card() {
        let player = Hand { cards: vec![card(Rank::King), card(Rank::Five)] };
        let banker = Hand { cards: vec![card(Rank::Two), card(Rank::Three)] };
        let round = RoundResult { player, banker, outcome: Outcome::PlayerWin, trace: Vec::new() };
        let reveal = RevealState { player: all_up(2), banker: all_up(2) };
        let events = derive_events(&round, &reveal);
        assert!(events.contains(&Event::Monkey { hand: Side::Player, index: 0 }));
    }

    #[test]
    fn no_events_while_cards_are_face_down() {
        let player = Hand { cards: vec![card(Rank::King), card(Rank::Five)] };
        let banker = Hand { cards: vec![card(Rank::Two), card(Rank::Three)] };
        let round = RoundResult { player, banker, outcome: Outcome::PlayerWin, trace: Vec::new() };
        let reveal = RevealState { player: all_down(2), banker: all_down(2) };
        assert!(derive_events(&round, &reveal).is_empty());
    }

    #[test]
    fn pair_natural_and_win_events_when_fully_revealed() {
        // Player nine+nine = 8: both a pair and a two-card natural; beats banker 5.
        let player = Hand { cards: vec![card(Rank::Nine), card(Rank::Nine)] };
        let banker = Hand { cards: vec![card(Rank::Two), card(Rank::Three)] };
        let round = RoundResult { player, banker, outcome: Outcome::PlayerWin, trace: Vec::new() };
        let reveal = RevealState { player: all_up(2), banker: all_up(2) };
        let events = derive_events(&round, &reveal);
        assert!(events.contains(&Event::Pair { side: Side::Player }));
        assert!(events.contains(&Event::Natural { side: Side::Player, total: 8 }));
        assert!(events.contains(&Event::Win { result: Outcome::PlayerWin, player: 8, banker: 5 }));
    }

    #[test]
    fn win_event_withheld_until_both_hands_revealed() {
        let player = Hand { cards: vec![card(Rank::Nine), card(Rank::Nine)] };
        let banker = Hand { cards: vec![card(Rank::Two), card(Rank::Three)] };
        let round = RoundResult { player, banker, outcome: Outcome::PlayerWin, trace: Vec::new() };
        let reveal = RevealState { player: all_up(2), banker: all_down(2) };
        let events = derive_events(&round, &reveal);
        assert!(!events.iter().any(|e| matches!(e, Event::Win { .. })));
    }
}
