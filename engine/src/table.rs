//! A multiplayer baccarat table: several players bet on the same coup from
//! the same shoe and settle independently against their own bankrolls.
//! The round flow (tableau, cut card, burn, reveal ritual) is identical to
//! the single-player `Session`; this adds seats on top of it.

use crate::round::{play_round, RoundResult};
use crate::scoreboard::{derive_scoreboard, RoundRecord, ScoreboardSnapshot, Side};
use crate::session::{
    derive_events, hand_view, BetKind, CardStatus, CommandError, Event, HandView, PhaseTag,
    PlacedBet, RevealState,
};
use crate::settle::{settle_with, Bet, Ruleset};
use crate::shoe::{Shoe, CUT_CARD};
use crate::sidebets::settle_side;
use serde::{Deserialize, Serialize};

/// A seat at the table, identified for the lifetime of the table.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct PlayerId(pub u64);

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TableConfig {
    pub table_min: i64,
    pub table_max: i64,
    pub ruleset: Ruleset,
    pub max_seats: usize,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum TableError {
    TableFull,
    NoSuchPlayer,
    /// Deal is gated until every seat has bet or sat out.
    WaitingOnPlayers,
    /// Those cards are in another player's hands.
    NotYourSqueeze { side: Side },
    /// The ritual exposes cards in order: Player hand, Banker hand, thirds.
    OutOfOrder,
    Command(CommandError),
}

impl From<CommandError> for TableError {
    fn from(e: CommandError) -> Self {
        TableError::Command(e)
    }
}

struct Player {
    id: PlayerId,
    name: String,
    bankroll: i64,
    bets: Vec<PlacedBet>,
    /// Chose to skip this coup.
    sitting_out: bool,
    /// Last round's payouts, kept until the next deal.
    payouts: Option<Vec<crate::session::BetPayout>>,
}

impl Player {
    /// Bet down or sitting out — ready for the deal.
    fn decided(&self) -> bool {
        self.sitting_out || !self.bets.is_empty()
    }
}

enum Phase {
    Betting,
    Dealing {
        round: RoundResult,
        reveal: RevealState,
        /// Biggest Player-bettor squeezes the Player hand (None: dealer flips).
        player_squeezer: Option<PlayerId>,
        banker_squeezer: Option<PlayerId>,
    },
}

/// What one seated player sees. Cards and events are shared; money is theirs.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TableView {
    pub phase: PhaseTag,
    pub player: HandView,
    pub banker: HandView,
    pub bets: Vec<PlacedBet>,
    pub bankroll: i64,
    pub table_min: i64,
    pub table_max: i64,
    pub outcome: Option<crate::round::Outcome>,
    pub payouts: Option<Vec<crate::session::BetPayout>>,
    pub events: Vec<Event>,
    pub scoreboard: ScoreboardSnapshot,
    pub explain: Vec<String>,
    pub seats: Vec<SeatView>,
    /// Who holds each hand's cards this coup (None: anyone may flip).
    pub player_squeezer: Option<PlayerId>,
    pub banker_squeezer: Option<PlayerId>,
}

/// The public face of every seat, shown to the whole table.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SeatView {
    pub id: PlayerId,
    pub name: String,
    pub bankroll: i64,
    pub staked: i64,
    pub sitting_out: bool,
    /// Bet down or sitting out — the deal waits for everyone to decide.
    pub decided: bool,
}

pub struct Table {
    config: TableConfig,
    seed: u64,
    shoes_dealt: u64,
    shoe: Shoe,
    phase: Phase,
    players: Vec<Player>,
    next_player: u64,
    history: Vec<RoundRecord>,
    /// Outcome of the most recent settled round, until the next deal.
    last_outcome: Option<crate::round::Outcome>,
}

impl Table {
    pub fn new(config: TableConfig, seed: u64) -> Self {
        Table {
            config,
            seed,
            shoes_dealt: 0,
            shoe: Shoe::new_seeded(seed),
            phase: Phase::Betting,
            players: Vec::new(),
            next_player: 0,
            history: Vec::new(),
            last_outcome: None,
        }
    }

    pub fn seats(&self) -> usize {
        self.players.len()
    }

    /// Sit down with a buy-in. Allowed mid-round; betting waits for the next coup.
    pub fn join(&mut self, name: &str, buy_in: i64) -> Result<PlayerId, TableError> {
        if self.players.len() >= self.config.max_seats {
            return Err(TableError::TableFull);
        }
        let id = PlayerId(self.next_player);
        self.next_player += 1;
        self.players.push(Player {
            id,
            name: name.to_string(),
            bankroll: buy_in,
            bets: Vec::new(),
            sitting_out: false,
            payouts: None,
        });
        Ok(id)
    }

    /// Stand up. Staged bets are returned (the coup hasn't run yet) unless
    /// cards are out, in which case the bets ride and settle silently.
    pub fn leave(&mut self, pid: PlayerId) -> Result<(), TableError> {
        // Mid-deal departures forfeit nothing: settle their bets now against
        // the in-flight round so money conserves.
        if let Phase::Dealing { round, player_squeezer, banker_squeezer, .. } = &mut self.phase {
            if *player_squeezer == Some(pid) {
                *player_squeezer = None;
            }
            if *banker_squeezer == Some(pid) {
                *banker_squeezer = None;
            }
            let round = round.clone();
            if let Some(p) = self.players.iter_mut().find(|p| p.id == pid) {
                for bet in p.bets.clone() {
                    p.bankroll += settle_one(&bet, &round, self.config.ruleset);
                }
                p.bets.clear();
            }
        }
        let before = self.players.len();
        self.players.retain(|p| p.id != pid);
        if self.players.len() == before {
            return Err(TableError::NoSuchPlayer);
        }
        Ok(())
    }

    fn player_mut(&mut self, pid: PlayerId) -> Result<&mut Player, TableError> {
        self.players
            .iter_mut()
            .find(|p| p.id == pid)
            .ok_or(TableError::NoSuchPlayer)
    }

    pub fn place_bet(&mut self, pid: PlayerId, kind: BetKind, amount: i64) -> Result<(), TableError> {
        if !matches!(self.phase, Phase::Betting) {
            return Err(CommandError::WrongPhase {
                expected: PhaseTag::Betting,
                found: PhaseTag::Dealing,
            }
            .into());
        }
        let (min, max) = (self.config.table_min, self.config.table_max);
        let player = self.player_mut(pid)?;
        if amount < min {
            return Err(CommandError::BetBelowMinimum { min, got: amount }.into());
        }
        if amount > max {
            return Err(CommandError::BetAboveMaximum { max, got: amount }.into());
        }
        let staked: i64 = player.bets.iter().map(|b| b.amount).sum();
        if staked + amount > player.bankroll {
            return Err(CommandError::InsufficientBankroll {
                needed: staked + amount,
                have: player.bankroll,
            }
            .into());
        }
        player.sitting_out = false;
        player.bets.push(PlacedBet { kind, amount });
        Ok(())
    }

    /// Skip this coup: bets come back and the table stops waiting on you.
    pub fn sit_out(&mut self, pid: PlayerId) -> Result<(), TableError> {
        if !matches!(self.phase, Phase::Betting) {
            return Err(CommandError::WrongPhase {
                expected: PhaseTag::Betting,
                found: PhaseTag::Dealing,
            }
            .into());
        }
        let player = self.player_mut(pid)?;
        player.bets.clear();
        player.sitting_out = true;
        Ok(())
    }

    pub fn clear_bets(&mut self, pid: PlayerId) -> Result<(), TableError> {
        if !matches!(self.phase, Phase::Betting) {
            return Err(CommandError::WrongPhase {
                expected: PhaseTag::Betting,
                found: PhaseTag::Dealing,
            }
            .into());
        }
        self.player_mut(pid)?.bets.clear();
        Ok(())
    }

    /// Deal the coup. Requires at least one staged bet anywhere at the table.
    pub fn deal(&mut self) -> Result<(), TableError> {
        if !matches!(self.phase, Phase::Betting) {
            return Err(CommandError::WrongPhase {
                expected: PhaseTag::Betting,
                found: PhaseTag::Dealing,
            }
            .into());
        }
        if self.players.iter().all(|p| p.bets.is_empty()) {
            return Err(CommandError::NoBetsPlaced.into());
        }
        // The pit waits for the whole table: everyone bets or sits out.
        if self.players.iter().any(|p| !p.decided()) {
            return Err(TableError::WaitingOnPlayers);
        }
        if self.shoe.remaining() <= CUT_CARD {
            self.reshuffle();
        }
        let round = play_round(&mut self.shoe);
        let reveal = RevealState {
            player: vec![CardStatus::FaceDown; round.player.cards.len()],
            banker: vec![CardStatus::FaceDown; round.banker.cards.len()],
        };
        self.last_outcome = None;
        for p in &mut self.players {
            p.payouts = None;
        }
        let player_squeezer = self.biggest_bettor(crate::settle::BetSpot::Player);
        let banker_squeezer = self.biggest_bettor(crate::settle::BetSpot::Banker);
        self.phase = Phase::Dealing { round, reveal, player_squeezer, banker_squeezer };
        Ok(())
    }

    /// The biggest main-bet wager on a side earns the squeeze (ties: first seated).
    fn biggest_bettor(&self, spot: crate::settle::BetSpot) -> Option<PlayerId> {
        self.players
            .iter()
            .map(|p| {
                let staked: i64 = p
                    .bets
                    .iter()
                    .filter(|b| matches!(b.kind, BetKind::Main(s) if s == spot))
                    .map(|b| b.amount)
                    .sum();
                (p.id, staked)
            })
            .filter(|(_, staked)| *staked > 0)
            .max_by_key(|(_, staked)| *staked)
            .map(|(id, _)| id)
    }

    pub fn peek(&mut self, pid: PlayerId, hand: Side, index: usize) -> Result<(), TableError> {
        self.check_rights(pid, hand)?;
        self.set_status(hand, index, CardStatus::Peeked)
    }

    pub fn reveal(&mut self, pid: PlayerId, hand: Side, index: usize) -> Result<(), TableError> {
        self.check_rights(pid, hand)?;
        self.check_order(hand, index)?;
        self.set_status(hand, index, CardStatus::FaceUp)
    }

    /// The squeeze belongs to the biggest bettor on that side, when there is one.
    fn check_rights(&self, pid: PlayerId, hand: Side) -> Result<(), TableError> {
        if let Phase::Dealing { player_squeezer, banker_squeezer, .. } = &self.phase {
            let holder = match hand {
                Side::Player => player_squeezer,
                Side::Banker => banker_squeezer,
            };
            if let Some(holder) = holder {
                if *holder != pid {
                    return Err(TableError::NotYourSqueeze { side: hand });
                }
            }
        }
        Ok(())
    }

    /// The ritual order: Player's two, Banker's two, Player's third, Banker's
    /// third. A card may only be REVEALED once everything before it is up.
    fn check_order(&self, hand: Side, index: usize) -> Result<(), TableError> {
        let Phase::Dealing { reveal, .. } = &self.phase else { return Ok(()) };
        let sequence: [(Side, usize); 6] = [
            (Side::Player, 0),
            (Side::Player, 1),
            (Side::Banker, 0),
            (Side::Banker, 1),
            (Side::Player, 2),
            (Side::Banker, 2),
        ];
        for (h, i) in sequence {
            if h == hand && i == index {
                return Ok(());
            }
            let statuses = match h {
                Side::Player => &reveal.player,
                Side::Banker => &reveal.banker,
            };
            // earlier card exists and isn't face-up yet: not your turn
            if i < statuses.len() && statuses[i] != CardStatus::FaceUp {
                return Err(TableError::OutOfOrder);
            }
        }
        Ok(())
    }

    fn set_status(&mut self, hand: Side, index: usize, to: CardStatus) -> Result<(), TableError> {
        match &mut self.phase {
            Phase::Dealing { reveal, .. } => {
                let statuses = match hand {
                    Side::Player => &mut reveal.player,
                    Side::Banker => &mut reveal.banker,
                };
                if index >= statuses.len() {
                    return Err(CommandError::BadCardIndex { hand, index }.into());
                }
                if !(to == CardStatus::Peeked && statuses[index] == CardStatus::FaceUp) {
                    statuses[index] = to;
                }
                Ok(())
            }
            Phase::Betting => Err(CommandError::WrongPhase {
                expected: PhaseTag::Dealing,
                found: PhaseTag::Betting,
            }
            .into()),
        }
    }

    /// Resolve the coup: every player settles independently.
    pub fn settle(&mut self) -> Result<(), TableError> {
        let round = match &self.phase {
            Phase::Dealing { round, .. } => round.clone(),
            Phase::Betting => {
                return Err(CommandError::WrongPhase {
                    expected: PhaseTag::Dealing,
                    found: PhaseTag::Betting,
                }
                .into())
            }
        };
        for p in &mut self.players {
            let payouts: Vec<crate::session::BetPayout> = p
                .bets
                .iter()
                .map(|b| crate::session::BetPayout {
                    bet: *b,
                    net: settle_one(b, &round, self.config.ruleset),
                })
                .collect();
            p.bankroll += payouts.iter().map(|x| x.net).sum::<i64>();
            p.payouts = Some(payouts);
            p.bets.clear();
            p.sitting_out = false; // fresh decision every coup
        }
        self.last_outcome = Some(round.outcome);
        self.history.push(RoundRecord::from_round(&round));
        self.phase = Phase::Betting;
        Ok(())
    }

    pub fn new_shoe(&mut self) -> Result<(), TableError> {
        if !matches!(self.phase, Phase::Betting) {
            return Err(CommandError::WrongPhase {
                expected: PhaseTag::Betting,
                found: PhaseTag::Dealing,
            }
            .into());
        }
        self.reshuffle();
        Ok(())
    }

    fn reshuffle(&mut self) {
        self.shoes_dealt += 1;
        self.shoe = Shoe::new_seeded(self.seed.wrapping_add(self.shoes_dealt));
    }

    /// The table as one seated player sees it. Face-down cards stay face down
    /// in every view; money fields are the viewer's own.
    pub fn view_for(&self, pid: PlayerId) -> Result<TableView, TableError> {
        let player = self
            .players
            .iter()
            .find(|p| p.id == pid)
            .ok_or(TableError::NoSuchPlayer)?;
        let seats = self
            .players
            .iter()
            .map(|p| SeatView {
                id: p.id,
                name: p.name.clone(),
                bankroll: p.bankroll,
                staked: p.bets.iter().map(|b| b.amount).sum(),
                sitting_out: p.sitting_out,
                decided: p.decided(),
            })
            .collect();
        let (player_squeezer, banker_squeezer) = match &self.phase {
            Phase::Dealing { player_squeezer, banker_squeezer, .. } => {
                (*player_squeezer, *banker_squeezer)
            }
            Phase::Betting => (None, None),
        };

        let view = match &self.phase {
            Phase::Betting => TableView {
                phase: if player.payouts.is_some() {
                    PhaseTag::Settled
                } else {
                    PhaseTag::Betting
                },
                player: HandView { cards: Vec::new(), total: None },
                banker: HandView { cards: Vec::new(), total: None },
                bets: player.bets.clone(),
                bankroll: player.bankroll,
                table_min: self.config.table_min,
                table_max: self.config.table_max,
                outcome: self.last_outcome,
                payouts: player.payouts.clone(),
                events: Vec::new(),
                scoreboard: derive_scoreboard(&self.history),
                explain: Vec::new(),
                seats,
                player_squeezer,
                banker_squeezer,
            },
            Phase::Dealing { round, reveal, .. } => TableView {
                phase: PhaseTag::Dealing,
                player: hand_view(&round.player, &reveal.player),
                banker: hand_view(&round.banker, &reveal.banker),
                bets: player.bets.clone(),
                bankroll: player.bankroll,
                table_min: self.config.table_min,
                table_max: self.config.table_max,
                outcome: None,
                payouts: None,
                events: derive_events(round, reveal),
                scoreboard: derive_scoreboard(&self.history),
                explain: round.trace.clone(),
                seats,
                player_squeezer,
                banker_squeezer,
            },
        };
        Ok(view)
    }
}

fn settle_one(bet: &PlacedBet, round: &RoundResult, ruleset: Ruleset) -> i64 {
    match bet.kind {
        BetKind::Main(spot) => settle_with(Bet { spot, amount: bet.amount }, round, ruleset),
        BetKind::Side(side_bet) => settle_side(side_bet, bet.amount, round),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::settle::BetSpot;

    fn table() -> Table {
        Table::new(
            TableConfig {
                table_min: 100,
                table_max: 1_000_000,
                ruleset: Ruleset::Commission,
                max_seats: 7,
            },
            42,
        )
    }

    #[test]
    fn players_join_up_to_max_seats() {
        let mut t = Table::new(
            TableConfig { table_min: 100, table_max: 1000, ruleset: Ruleset::Commission, max_seats: 2 },
            1,
        );
        t.join("a", 10_000).unwrap();
        t.join("b", 10_000).unwrap();
        assert_eq!(t.join("c", 10_000), Err(TableError::TableFull));
    }

    #[test]
    fn bets_validate_against_each_players_own_bankroll() {
        let mut t = table();
        let rich = t.join("rich", 1_000_000).unwrap();
        let poor = t.join("poor", 500).unwrap();
        t.place_bet(rich, BetKind::Main(BetSpot::Player), 10_000).unwrap();
        let err = t.place_bet(poor, BetKind::Main(BetSpot::Player), 10_000);
        assert!(matches!(err, Err(TableError::Command(CommandError::InsufficientBankroll { .. }))));
        t.place_bet(poor, BetKind::Main(BetSpot::Banker), 500).unwrap();
    }

    #[test]
    fn a_full_coup_settles_every_player_and_conserves_money() {
        let mut t = table();
        let a = t.join("a", 100_000).unwrap();
        let b = t.join("b", 100_000).unwrap();
        // Opposite main bets: exactly one wins (or both push on tie).
        t.place_bet(a, BetKind::Main(BetSpot::Player), 10_000).unwrap();
        t.place_bet(b, BetKind::Main(BetSpot::Banker), 10_000).unwrap();
        t.deal().unwrap();
        t.settle().unwrap();

        let va = t.view_for(a).unwrap();
        let vb = t.view_for(b).unwrap();
        assert_eq!(va.phase, PhaseTag::Settled);
        assert!(va.payouts.is_some() && vb.payouts.is_some());
        // each player's bankroll moved by exactly their own net
        let net_a: i64 = va.payouts.as_ref().unwrap().iter().map(|p| p.net).sum();
        let net_b: i64 = vb.payouts.as_ref().unwrap().iter().map(|p| p.net).sum();
        assert_eq!(va.bankroll, 100_000 + net_a);
        assert_eq!(vb.bankroll, 100_000 + net_b);
        // and the outcome is shared
        assert_eq!(va.outcome, vb.outcome);
        assert!(va.outcome.is_some());
    }

    #[test]
    fn views_share_cards_but_keep_money_private_to_the_viewer() {
        let mut t = table();
        let a = t.join("a", 100_000).unwrap();
        let b = t.join("b", 50_000).unwrap();
        t.place_bet(a, BetKind::Main(BetSpot::Player), 5_000).unwrap();
        t.sit_out(b).unwrap();
        t.deal().unwrap();

        let va = t.view_for(a).unwrap();
        let vb = t.view_for(b).unwrap();
        assert_eq!(va.player.cards, vb.player.cards); // same shared coup
        assert_eq!(va.bankroll, 100_000);
        assert_eq!(vb.bankroll, 50_000);
        assert_eq!(va.bets.len(), 1);
        assert!(vb.bets.is_empty());
        // both see both seats with stakes
        assert_eq!(va.seats.len(), 2);
        assert_eq!(va.seats[0].staked, 5_000);
        assert_eq!(vb.seats[0].name, "a");
    }

    #[test]
    fn no_view_ever_exposes_a_face_down_card() {
        let mut t = table();
        let a = t.join("a", 100_000).unwrap();
        t.place_bet(a, BetKind::Main(BetSpot::Tie), 1_000).unwrap();
        t.deal().unwrap();
        let v = t.view_for(a).unwrap();
        for card in v.player.cards.iter().chain(v.banker.cards.iter()) {
            assert!(matches!(card, crate::session::CardView::FaceDown));
        }
        assert!(v.player.total.is_none());
    }

    #[test]
    fn the_squeeze_is_communal() {
        let mut t = table();
        let a = t.join("a", 100_000).unwrap();
        let b = t.join("b", 100_000).unwrap();
        t.place_bet(a, BetKind::Main(BetSpot::Player), 1_000).unwrap();
        t.sit_out(b).unwrap();
        t.deal().unwrap();
        // a bet Player, so the Player hand is HIS squeeze
        assert!(matches!(t.reveal(b, Side::Player, 0), Err(TableError::NotYourSqueeze { .. })));
        t.reveal(a, Side::Player, 0).unwrap();
        let vb = t.view_for(b).unwrap();
        assert!(matches!(vb.player.cards[0], crate::session::CardView::FaceUp(_)));
    }

    #[test]
    fn deal_needs_a_bet_from_someone() {
        let mut t = table();
        let _a = t.join("a", 100_000).unwrap();
        assert!(matches!(
            t.deal(),
            Err(TableError::Command(CommandError::NoBetsPlaced))
        ));
    }

    #[test]
    fn leaving_mid_deal_settles_the_departing_player() {
        let mut t = table();
        let a = t.join("a", 100_000).unwrap();
        t.place_bet(a, BetKind::Main(BetSpot::Player), 10_000).unwrap();
        t.deal().unwrap();
        t.leave(a).unwrap();
        assert_eq!(t.seats(), 0);
        // the round can still settle for everyone else without panicking
        t.settle().unwrap();
    }

    #[test]
    fn the_deal_waits_for_every_seat_to_decide() {
        let mut t = table();
        let a = t.join("a", 100_000).unwrap();
        let b = t.join("b", 100_000).unwrap();
        t.place_bet(a, BetKind::Main(BetSpot::Player), 1_000).unwrap();
        assert_eq!(t.deal(), Err(TableError::WaitingOnPlayers));
        t.sit_out(b).unwrap();
        t.deal().unwrap();
        t.settle().unwrap();
        // decisions reset every coup
        let vb = t.view_for(b).unwrap();
        assert!(!vb.seats[1].sitting_out);
        assert!(!vb.seats[1].decided);
    }

    #[test]
    fn sitting_out_returns_your_bets() {
        let mut t = table();
        let a = t.join("a", 100_000).unwrap();
        t.place_bet(a, BetKind::Main(BetSpot::Tie), 1_000).unwrap();
        t.sit_out(a).unwrap();
        let v = t.view_for(a).unwrap();
        assert!(v.bets.is_empty());
        assert!(v.seats[0].sitting_out && v.seats[0].decided);
        // betting again puts you back in the coup
        t.place_bet(a, BetKind::Main(BetSpot::Player), 1_000).unwrap();
        assert!(!t.view_for(a).unwrap().seats[0].sitting_out);
    }

    #[test]
    fn each_side_is_squeezed_by_its_biggest_bettor() {
        let mut t = table();
        let a = t.join("a", 100_000).unwrap();
        let b = t.join("b", 100_000).unwrap();
        t.place_bet(a, BetKind::Main(BetSpot::Player), 5_000).unwrap();
        t.place_bet(b, BetKind::Main(BetSpot::Banker), 5_000).unwrap();
        t.deal().unwrap();
        let v = t.view_for(a).unwrap();
        assert_eq!(v.player_squeezer, Some(a));
        assert_eq!(v.banker_squeezer, Some(b));
        // b cannot touch the Player hand, a cannot touch the Banker hand
        assert!(matches!(t.peek(b, Side::Player, 0), Err(TableError::NotYourSqueeze { .. })));
        assert!(matches!(t.peek(a, Side::Banker, 0), Err(TableError::NotYourSqueeze { .. })));
        // each may peek their own
        t.peek(a, Side::Player, 0).unwrap();
        t.peek(b, Side::Banker, 0).unwrap();
    }

    #[test]
    fn cards_are_exposed_in_ritual_order() {
        let mut t = table();
        let a = t.join("a", 100_000).unwrap();
        t.place_bet(a, BetKind::Main(BetSpot::Player), 1_000).unwrap();
        t.deal().unwrap();
        // Banker's first card may not be revealed before the Player hand is up
        assert_eq!(t.reveal(a, Side::Banker, 0), Err(TableError::OutOfOrder));
        t.reveal(a, Side::Player, 0).unwrap();
        assert_eq!(t.reveal(a, Side::Banker, 0), Err(TableError::OutOfOrder));
        t.reveal(a, Side::Player, 1).unwrap();
        t.reveal(a, Side::Banker, 0).unwrap();
        t.reveal(a, Side::Banker, 1).unwrap();
        // but peeking ahead is allowed — squeezers fiddle their cards early
        // (only rights gate peeks, not order)
    }

    #[test]
    fn an_unbet_side_may_be_flipped_by_anyone() {
        let mut t = table();
        let a = t.join("a", 100_000).unwrap();
        let b = t.join("b", 100_000).unwrap();
        t.place_bet(a, BetKind::Main(BetSpot::Player), 1_000).unwrap();
        t.sit_out(b).unwrap();
        t.deal().unwrap();
        t.reveal(a, Side::Player, 0).unwrap();
        t.reveal(a, Side::Player, 1).unwrap();
        // nobody bet Banker: even the sitting-out player may flip it
        t.reveal(b, Side::Banker, 0).unwrap();
    }

    #[test]
    fn shoe_reshuffles_at_the_cut_card_across_many_coups() {
        let mut t = table();
        let a = t.join("a", 10_000_000).unwrap();
        for _ in 0..200 {
            t.place_bet(a, BetKind::Main(BetSpot::Player), 100).unwrap();
            t.deal().unwrap();
            t.settle().unwrap();
        }
        // surviving 200 coups proves the cut-card reshuffle path works
        assert!(t.view_for(a).unwrap().scoreboard.bead_plate.cells.len() == 200);
    }
}
