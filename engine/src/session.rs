use crate::card::{Card, Suit};
use crate::round::Outcome;
use crate::scoreboard::{derive_scoreboard, RoundRecord, ScoreboardSnapshot, Side};
use crate::settle::{BetSpot, Ruleset};
use crate::sidebets::SideBet;

/// How a session is configured at creation. All money is in cents.
pub struct SessionConfig {
    pub starting_bankroll: i64,
    pub table_min: i64,
    pub table_max: i64,
    pub ruleset: Ruleset,
    pub seed: u64,
}

/// A bet kind: a main-bet spot or a side bet.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum BetKind {
    Main(BetSpot),
    Side(SideBet),
}

/// A staged or resolved bet. `amount` is the stake in cents.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct PlacedBet {
    pub kind: BetKind,
    pub amount: i64,
}

/// A resolved bet's net result in cents (profit, -stake, or 0 push).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct BetPayout {
    pub bet: PlacedBet,
    pub net: i64,
}

/// The corner-squeeze hint: only the card's suit shows first.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Pip {
    pub suit: Suit,
}

/// A card as the front-end may see it. Unrevealed cards hide their identity.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CardView {
    FaceDown,
    Peeked { sliver: Pip },
    FaceUp(Card),
}

/// A hand as rendered to the front-end. `total` is `None` until every card is face up.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct HandView {
    pub cards: Vec<CardView>,
    pub total: Option<u8>,
}

/// The phase tag carried in a snapshot. `Settled` is the transient view `settle()` returns.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PhaseTag {
    Betting,
    Dealing,
    Settled,
}

/// Structured, language-neutral tags front-ends turn into narration and glossary highlights.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Event {
    Natural { side: Side, total: u8 },
    Monkey { hand: Side, index: usize },
    Pair { side: Side },
    ThirdCard { side: Side, reason: String },
    Win { winner: Outcome, player: u8, banker: u8 },
}

/// The single serializable view a front-end renders.
#[derive(Debug, Clone, PartialEq, Eq)]
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
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum CommandError {
    WrongPhase { expected: PhaseTag, found: PhaseTag },
    BetBelowMinimum { min: i64, got: i64 },
    BetAboveMaximum { max: i64, got: i64 },
    InsufficientBankroll { needed: i64, have: i64 },
    NoBetsPlaced,
    BadCardIndex { hand: Side, index: usize },
}

/// In-flight round state.
enum Phase {
    Betting { bets: Vec<PlacedBet> },
}

/// The stateful baccarat game session.
pub struct Session {
    bankroll: i64,
    config: SessionConfig,
    history: Vec<RoundRecord>,
    phase: Phase,
}

impl Session {
    /// Start a fresh session in the betting phase.
    pub fn new(config: SessionConfig) -> Self {
        Session {
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
        }
        Ok(self.current_snapshot())
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
        }
    }
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
}
