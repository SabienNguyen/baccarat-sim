//! A multiplayer baccarat table: several players bet on the same coup from
//! the same shoe and settle independently against their own bankrolls.
//! The round flow (tableau, cut card, burn, reveal ritual) is identical to
//! the single-player `Session`; this adds seats on top of it.

use crate::round::{play_round, RoundResult};
use crate::scoreboard::{derive_scoreboard, RoundRecord, ScoreboardSnapshot, Side};
use crate::session::{
    derive_events, fully_revealed, hand_view, BetKind, CardStatus, CommandError, Event, HandView,
    PhaseTag, PlacedBet, RevealState,
};
use crate::settle::{settle_with, Bet, Ruleset};
use crate::shoe::{Shoe, CUT_CARD};
use crate::sidebets::settle_side;
use serde::{Deserialize, Serialize};

/// A seat at the table, identified for the lifetime of the table.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[cfg_attr(feature = "wasm", derive(tsify_next::Tsify))]
#[cfg_attr(feature = "wasm", tsify(into_wasm_abi, from_wasm_abi))]
pub struct PlayerId(pub u64);

#[derive(Debug, Clone, Serialize, Deserialize)]
#[cfg_attr(feature = "wasm", derive(tsify_next::Tsify))]
#[cfg_attr(feature = "wasm", tsify(from_wasm_abi))]
pub struct TableConfig {
    pub table_min: i64,
    pub table_max: i64,
    pub ruleset: Ruleset,
    pub max_seats: usize,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "wasm", derive(tsify_next::Tsify))]
#[cfg_attr(feature = "wasm", tsify(into_wasm_abi))]
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
    /// Bet down, sitting out, or unable to bet at all — ready for the deal.
    ///
    /// The affordability case is what stops one broke seat freezing the table.
    /// A player whose bankroll won't cover the table minimum cannot place a bet
    /// even if they want to, so waiting for them to "decide" waits forever;
    /// treating them as decided is the same call a pit makes when it deals past
    /// someone who has stopped buying in.
    fn decided(&self, table_min: i64) -> bool {
        self.sitting_out || !self.bets.is_empty() || self.broke(table_min)
    }

    /// Can't cover the table minimum, so can't take part in this coup.
    fn broke(&self, table_min: i64) -> bool {
        self.bankroll < table_min
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
#[cfg_attr(feature = "wasm", derive(tsify_next::Tsify))]
#[cfg_attr(feature = "wasm", tsify(into_wasm_abi))]
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
#[cfg_attr(feature = "wasm", derive(tsify_next::Tsify))]
#[cfg_attr(feature = "wasm", tsify(into_wasm_abi))]
pub struct SeatView {
    pub id: PlayerId,
    pub name: String,
    pub bankroll: i64,
    pub staked: i64,
    pub sitting_out: bool,
    /// Bet down or sitting out — the deal waits for everyone to decide.
    pub decided: bool,
    /// Bankroll won't cover the table minimum, so this seat can't bet at all.
    pub broke: bool,
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
    /// The settled round's cards, kept on the felt until the next deal.
    last_round: Option<RoundResult>,
    /// Memoized scoreboard, keyed on history length. `history` is append-only
    /// (only pushed at settle, never cleared), so equal length ⇒ identical
    /// content ⇒ identical roads — this skips recomputing all five roads on
    /// every view (a view is built after every command, ~8-10× per coup, but
    /// the scoreboard only changes once per settled round).
    sb_cache: std::cell::RefCell<Option<(usize, ScoreboardSnapshot)>>,
}

impl Table {
    pub fn new(config: TableConfig, seed: u64) -> Self {
        // A malformed config doesn't error later — it silently rejects every
        // bet (min>max fails one bound or the other). Catch it at the source.
        debug_assert!(config.table_min >= 0, "negative table_min");
        debug_assert!(config.table_min <= config.table_max, "table_min above table_max");
        debug_assert!(config.max_seats >= 1, "a table needs at least one seat");
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
            last_round: None,
            sb_cache: std::cell::RefCell::new(None),
        }
    }

    /// The scoreboard, recomputed only when `history` has grown since the last
    /// call (see `sb_cache`). Behavior-identical to `derive_scoreboard`.
    fn scoreboard(&self) -> ScoreboardSnapshot {
        let len = self.history.len();
        if let Some((cached_len, snap)) = self.sb_cache.borrow().as_ref() {
            if *cached_len == len {
                return snap.clone();
            }
        }
        let snap = derive_scoreboard(&self.history);
        *self.sb_cache.borrow_mut() = Some((len, snap.clone()));
        snap
    }

    pub fn seats(&self) -> usize {
        self.players.len()
    }

    /// Cards left in the shoe. Play stops and reshuffles at the cut card, so
    /// this counts down to `CUT_CARD`, not to zero.
    pub fn shoe_remaining(&self) -> usize {
        self.shoe.remaining()
    }

    /// Sit down with a buy-in. Allowed mid-round; betting waits for the next coup.
    pub fn join(&mut self, name: &str, buy_in: i64) -> Result<PlayerId, TableError> {
        debug_assert!(buy_in >= 0, "negative buy-in");
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
        // Reject any single wager over the posted max up front — also bounds
        // `amount` to `max` so a hostile i64::MAX can't overflow the sums below.
        if amount > max {
            return Err(CommandError::BetAboveMaximum { max, got: amount }.into());
        }
        // the posted limit binds the whole stack on a spot, not each chip
        let on_spot: i64 =
            player.bets.iter().filter(|b| b.kind == kind).map(|b| b.amount).sum();
        if on_spot + amount > max {
            return Err(CommandError::BetAboveMaximum { max, got: on_spot + amount }.into());
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
        // betting again closes last round's settled display
        player.payouts = None;
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
        player.payouts = None;
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

    /// Buy more chips without leaving the table. In a pit you hand over cash
    /// and keep playing the *same* shoe — the cards already dealt stay dealt and
    /// the roads keep running — so this only tops up a seat's bankroll and
    /// touches nothing about the shoe or the history.
    pub fn rebuy(&mut self, pid: PlayerId, amount: i64) -> Result<(), TableError> {
        debug_assert!(amount >= 0, "negative rebuy");
        if !matches!(self.phase, Phase::Betting) {
            return Err(CommandError::WrongPhase {
                expected: PhaseTag::Betting,
                found: PhaseTag::Dealing,
            }
            .into());
        }
        let player = self.player_mut(pid)?;
        player.bankroll = player.bankroll.saturating_add(amount.max(0));
        // a fresh stake clears the finished round's display, like place_bet does
        player.payouts = None;
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
        // A real pit deals the coup whether or not there's money on the felt —
        // you're allowed to sit and watch the shoe build. So an empty felt is
        // fine; an EMPTY TABLE isn't.
        if self.players.is_empty() {
            return Err(CommandError::NoBetsPlaced.into());
        }
        // The pit still waits for the whole table: everyone bets or sits out.
        let table_min = self.config.table_min;
        if self.players.iter().any(|p| !p.decided(table_min)) {
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
        self.last_round = None;
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
        // A strict `>` fold in seat order keeps the FIRST player to reach the
        // top stake — `max_by_key` would return the last, inverting the
        // documented tie-break.
        let mut best: Option<(PlayerId, i64)> = None;
        for p in &self.players {
            let staked: i64 = p
                .bets
                .iter()
                .filter(|b| matches!(b.kind, BetKind::Main(s) if s == spot))
                .map(|b| b.amount)
                .sum();
            if staked > 0 && best.is_none_or(|(_, top)| staked > top) {
                best = Some((p.id, staked));
            }
        }
        best.map(|(id, _)| id)
    }

    /// The next card in ritual order that belongs to the house (a side
    /// nobody bet), if it's that card's turn to be exposed.
    fn next_dealer_card(&self) -> Option<(Side, usize)> {
        let Phase::Dealing { reveal, player_squeezer, banker_squeezer, .. } = &self.phase else {
            return None;
        };
        let sequence: [(Side, usize); 6] = [
            (Side::Player, 0),
            (Side::Player, 1),
            (Side::Banker, 0),
            (Side::Banker, 1),
            (Side::Player, 2),
            (Side::Banker, 2),
        ];
        for (h, i) in sequence {
            let owner = match h {
                Side::Player => *player_squeezer,
                Side::Banker => *banker_squeezer,
            };
            let statuses = match h {
                Side::Player => &reveal.player,
                Side::Banker => &reveal.banker,
            };
            if i >= statuses.len() {
                continue; // that card wasn't drawn this coup
            }
            if statuses[i] == CardStatus::FaceUp {
                continue; // already exposed, next in order
            }
            return if owner.is_none() { Some((h, i)) } else { None };
        }
        None
    }

    /// Is the house dealer due to turn a card?
    pub fn dealer_flip_pending(&self) -> bool {
        self.next_dealer_card().is_some()
    }

    /// Which hand the dealer would turn next, for the announcement.
    pub fn dealer_next_side(&self) -> Option<Side> {
        self.next_dealer_card().map(|(side, _)| side)
    }

    /// The house dealer turns ONE card — the caller paces the rhythm so the
    /// whole table watches him flip card by card.
    pub fn dealer_flip_one(&mut self) -> bool {
        let Some((h, i)) = self.next_dealer_card() else { return false };
        if let Phase::Dealing { reveal, .. } = &mut self.phase {
            let statuses = match h {
                Side::Player => &mut reveal.player,
                Side::Banker => &mut reveal.banker,
            };
            statuses[i] = CardStatus::FaceUp;
            return true;
        }
        false
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
    /// A hand nobody bet belongs to the house dealer: at a shared table only
    /// the paced `dealer_flip_one` may turn it, so one impatient client can't
    /// skip the ritual for everyone. Solo tables keep the old freedom (the
    /// lone player IS the table, and "reveal all" flips house cards directly).
    fn check_rights(&self, pid: PlayerId, hand: Side) -> Result<(), TableError> {
        if let Phase::Dealing { player_squeezer, banker_squeezer, .. } = &self.phase {
            let holder = match hand {
                Side::Player => player_squeezer,
                Side::Banker => banker_squeezer,
            };
            match holder {
                Some(holder) if *holder != pid => {
                    return Err(TableError::NotYourSqueeze { side: hand });
                }
                None if self.config.max_seats > 1 => {
                    return Err(TableError::NotYourSqueeze { side: hand });
                }
                _ => {}
            }
        }
        Ok(())
    }

    /// The ritual runs in stages — Player's two, Banker's two, Player's
    /// third, Banker's third — but WITHIN your own hand you turn your cards
    /// in any order you like. A reveal is allowed once every card in all
    /// earlier stages is up.
    fn check_order(&self, hand: Side, index: usize) -> Result<(), TableError> {
        let Phase::Dealing { reveal, .. } = &self.phase else { return Ok(()) };
        let stage_of = |h: Side, i: usize| -> u8 {
            match (h, i) {
                (Side::Player, 0 | 1) => 1,
                (Side::Banker, 0 | 1) => 2,
                (Side::Player, _) => 3,
                (Side::Banker, _) => 4,
            }
        };
        let target = stage_of(hand, index);
        let sequence: [(Side, usize); 6] = [
            (Side::Player, 0),
            (Side::Player, 1),
            (Side::Banker, 0),
            (Side::Banker, 1),
            (Side::Player, 2),
            (Side::Banker, 2),
        ];
        for (h, i) in sequence {
            if stage_of(h, i) >= target {
                continue; // same stage or later: no constraint
            }
            let statuses = match h {
                Side::Player => &reveal.player,
                Side::Banker => &reveal.banker,
            };
            // an earlier-stage card exists and isn't face-up yet
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
        self.last_round = Some(round.clone());
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
                decided: p.decided(self.config.table_min),
                /// Out of chips for this table — the client shows a rebuy or
                /// leave prompt, and the deal no longer waits on them.
                broke: p.broke(self.config.table_min),
            })
            .collect();
        let (player_squeezer, banker_squeezer) = match &self.phase {
            Phase::Dealing { player_squeezer, banker_squeezer, .. } => {
                (*player_squeezer, *banker_squeezer)
            }
            Phase::Betting => (None, None),
        };

        // A settled coup keeps its cards on the felt, face up, until the next
        // deal — the result should be readable, not swept away with the chips.
        let settled_hands = |side: Side| -> HandView {
            match (&self.last_round, player.payouts.is_some()) {
                (Some(round), true) => {
                    let hand = match side {
                        Side::Player => &round.player,
                        Side::Banker => &round.banker,
                    };
                    let all_up = vec![CardStatus::FaceUp; hand.cards.len()];
                    hand_view(hand, &all_up)
                }
                _ => HandView { cards: Vec::new(), total: None },
            }
        };
        let view = match &self.phase {
            Phase::Betting => TableView {
                phase: if player.payouts.is_some() {
                    PhaseTag::Settled
                } else {
                    PhaseTag::Betting
                },
                player: settled_hands(Side::Player),
                banker: settled_hands(Side::Banker),
                bets: player.bets.clone(),
                bankroll: player.bankroll,
                table_min: self.config.table_min,
                table_max: self.config.table_max,
                // Gate on the viewer's own settled display, like payouts and
                // explain — once they re-bet, the previous coup's outcome is
                // no longer theirs to see.
                outcome: if player.payouts.is_some() { self.last_outcome } else { None },
                payouts: player.payouts.clone(),
                events: Vec::new(),
                scoreboard: self.scoreboard(),
                // Keep the 'why this round' trace on the settled felt — the same
                // window (and key) the face-up cards use — so the explanation is
                // there while the learner studies the finished coup.
                explain: match (&self.last_round, player.payouts.is_some()) {
                    (Some(round), true) => round.trace.clone(),
                    _ => Vec::new(),
                },
                seats,
                player_squeezer,
                banker_squeezer,
            },
            Phase::Dealing { round, reveal, .. } => {
                // A peeked sliver is the squeezer's private glimpse. Everyone
                // else sees that card still face down until it is revealed —
                // otherwise every client at the table receives the identity
                // the squeeze is supposed to keep in one player's hands.
                // (holder == None only carries peeks on a solo table, where
                // the sole viewer made them.)
                let redact = |statuses: &[CardStatus], holder: Option<PlayerId>| {
                    statuses
                        .iter()
                        .map(|s| match s {
                            CardStatus::Peeked if matches!(holder, Some(h) if h != pid) => {
                                CardStatus::FaceDown
                            }
                            s => *s,
                        })
                        .collect::<Vec<_>>()
                };
                TableView {
                    phase: PhaseTag::Dealing,
                    player: hand_view(&round.player, &redact(&reveal.player, player_squeezer)),
                    banker: hand_view(&round.banker, &redact(&reveal.banker, banker_squeezer)),
                    bets: player.bets.clone(),
                    bankroll: player.bankroll,
                    table_min: self.config.table_min,
                    table_max: self.config.table_max,
                    outcome: None,
                    payouts: None,
                    events: derive_events(round, reveal),
                    scoreboard: self.scoreboard(),
                    // The trace names the cards outright ("...it was 3"), so it
                    // must NOT ride along while any card is still face down —
                    // with Explain open that spoiled every squeeze before the
                    // player lifted the corner. Once both hands are fully
                    // exposed there's nothing left to give away.
                    explain: if fully_revealed(reveal) {
                        round.trace.clone()
                    } else {
                        Vec::new()
                    },
                    seats,
                    player_squeezer,
                    banker_squeezer,
                }
            }
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
    use crate::session::CardView;
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
    fn tied_stakes_give_the_squeeze_to_the_first_seated() {
        // The doc contract is "ties: first seated". a joins before b and they
        // stake the Player side identically, so a must hold the squeeze.
        let mut t = table();
        let a = t.join("a", 100_000).unwrap();
        let b = t.join("b", 100_000).unwrap();
        t.place_bet(a, BetKind::Main(BetSpot::Player), 5_000).unwrap();
        t.place_bet(b, BetKind::Main(BetSpot::Player), 5_000).unwrap();
        t.deal().unwrap();
        assert_eq!(t.view_for(a).unwrap().player_squeezer, Some(a));
    }

    #[test]
    fn a_peeked_card_is_hidden_from_players_without_the_squeeze() {
        // A peeked card's identity belongs to the squeezer alone. Another seat
        // must see it as face-down until it's actually revealed — otherwise the
        // squeeze's suspense leaks to every client at the table.
        let mut t = table();
        let a = t.join("a", 100_000).unwrap();
        let b = t.join("b", 100_000).unwrap();
        t.place_bet(a, BetKind::Main(BetSpot::Player), 5_000).unwrap();
        t.place_bet(b, BetKind::Main(BetSpot::Banker), 5_000).unwrap();
        t.deal().unwrap();
        t.peek(a, Side::Player, 0).unwrap();
        // the holder sees their own sliver
        assert!(matches!(t.view_for(a).unwrap().player.cards[0], CardView::Peeked { .. }));
        // b holds only the Banker squeeze — the Player peek must stay hidden
        assert!(matches!(t.view_for(b).unwrap().player.cards[0], CardView::FaceDown));
        // once a reveals it, it's public to everyone
        t.reveal(a, Side::Player, 0).unwrap();
        assert!(matches!(t.view_for(b).unwrap().player.cards[0], CardView::FaceUp(_)));
    }

    #[test]
    fn outcome_clears_when_the_next_coup_begins() {
        // After settle the view shows Settled with the outcome. Re-betting
        // starts a fresh coup: phase, cards and payouts all reset — outcome
        // must reset with them, not linger from the previous round.
        let mut t = table();
        let a = t.join("a", 100_000).unwrap();
        t.place_bet(a, BetKind::Main(BetSpot::Player), 5_000).unwrap();
        t.deal().unwrap();
        t.settle().unwrap();
        assert!(t.view_for(a).unwrap().outcome.is_some());
        t.place_bet(a, BetKind::Main(BetSpot::Banker), 5_000).unwrap();
        let v = t.view_for(a).unwrap();
        assert_eq!(v.phase, PhaseTag::Betting);
        assert!(v.payouts.is_none());
        assert!(v.outcome.is_none());
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
    fn hostile_bet_amount_cannot_overflow_the_limit_check() {
        // A raw socket can send any i64; a near-max value must be rejected as
        // over-limit, never wrap `on_spot + amount` past the max/bankroll guards.
        let mut t = table();
        let a = t.join("a", 100_000).unwrap();
        t.place_bet(a, BetKind::Main(BetSpot::Player), 5_000).unwrap();
        let err = t.place_bet(a, BetKind::Main(BetSpot::Player), i64::MAX);
        assert!(matches!(
            err,
            Err(TableError::Command(CommandError::BetAboveMaximum { .. }))
        ));
        // the legit bet is untouched; nothing hostile landed
        let v = t.view_for(a).unwrap();
        assert_eq!(v.bets.iter().map(|b| b.amount).sum::<i64>(), 5_000);
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
    fn settled_view_keeps_the_rounds_cards_face_up() {
        let mut t = table();
        let a = t.join("a", 100_000).unwrap();
        t.place_bet(a, BetKind::Main(BetSpot::Player), 5_000).unwrap();
        t.deal().unwrap();
        let dealt = t.view_for(a).unwrap();
        t.settle().unwrap();

        let v = t.view_for(a).unwrap();
        assert_eq!(v.phase, PhaseTag::Settled);
        // the coup's cards stay on the felt, all face up, totals final
        assert_eq!(v.player.cards.len(), dealt.player.cards.len());
        assert_eq!(v.banker.cards.len(), dealt.banker.cards.len());
        assert!(v
            .player
            .cards
            .iter()
            .chain(v.banker.cards.iter())
            .all(|c| matches!(c, CardView::FaceUp(_))));
        assert!(v.player.total.is_some() && v.banker.total.is_some());

        // the next deal sweeps them for the fresh coup
        t.place_bet(a, BetKind::Main(BetSpot::Player), 5_000).unwrap();
        t.deal().unwrap();
        let fresh = t.view_for(a).unwrap();
        assert_eq!(fresh.phase, PhaseTag::Dealing);
        assert!(fresh.player.cards.iter().all(|c| matches!(c, CardView::FaceDown)));
    }

    #[test]
    fn settled_view_keeps_the_explain_trace() {
        // The 'why this round' narrative must survive into the Settled display —
        // that's the resting state where a learner studies the finished coup and
        // finally sees why one hand has three cards and the other two.
        let mut t = table();
        let a = t.join("a", 100_000).unwrap();
        t.place_bet(a, BetKind::Main(BetSpot::Player), 5_000).unwrap();
        t.deal().unwrap();
        // ...but NOT before the cards are turned: the trace names the values
        // outright ("...it was 3"), so shipping it mid-squeeze spoiled every
        // hand for anyone playing with Explain open.
        assert!(
            t.view_for(a).unwrap().explain.is_empty(),
            "the trace must stay hidden while cards are face down"
        );

        // Expose the whole coup: the player turns the hand they bet, the house
        // flips the rest, and ritual order means the two interleave.
        for _ in 0..12 {
            let v = t.view_for(a).unwrap();
            for i in 0..v.player.cards.len() {
                let _ = t.reveal(a, Side::Player, i);
            }
            while t.dealer_flip_pending() {
                t.dealer_flip_one();
            }
        }
        let revealed = t.view_for(a).unwrap();
        assert!(revealed.player.total.is_some() && revealed.banker.total.is_some());
        assert!(!revealed.explain.is_empty(), "trace appears once the coup is exposed");

        t.settle().unwrap();
        let settled = t.view_for(a).unwrap();
        assert_eq!(settled.phase, PhaseTag::Settled);
        // same round, same trace — not replaced by the empty-panel hint
        assert_eq!(settled.explain, revealed.explain);
        assert!(!settled.explain.is_empty());

        // and the next deal clears it so the fresh Betting felt shows no stale trace
        t.place_bet(a, BetKind::Main(BetSpot::Player), 5_000).unwrap();
        t.deal().unwrap();
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
        t.place_bet(a, BetKind::Main(BetSpot::Player), 1_000).unwrap();
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
    fn stacked_bets_on_one_spot_cannot_pass_the_table_max() {
        let mut t = table(); // max 1_000_000
        let a = t.join("a", 5_000_000).unwrap();
        t.place_bet(a, BetKind::Main(BetSpot::Player), 600_000).unwrap();
        let err = t.place_bet(a, BetKind::Main(BetSpot::Player), 600_000).unwrap_err();
        assert!(matches!(
            err,
            TableError::Command(CommandError::BetAboveMaximum { max: 1_000_000, got: 1_200_000 })
        ));
        // each seat answers for its own stack, and other spots have headroom
        let b = t.join("b", 5_000_000).unwrap();
        t.place_bet(b, BetKind::Main(BetSpot::Player), 600_000).unwrap();
        t.place_bet(a, BetKind::Main(BetSpot::Banker), 600_000).unwrap();
    }

    #[test]
    fn deal_waits_for_an_undecided_seat() {
        // A seat that has neither bet nor sat out still blocks the deal (the
        // single-player adapter narrates this as "chips down first").
        let mut t = table();
        let _a = t.join("a", 100_000).unwrap();
        assert_eq!(t.deal(), Err(TableError::WaitingOnPlayers));
        // ...and with nobody seated at all there's no coup to deal
        let mut empty = table();
        assert!(matches!(
            empty.deal(),
            Err(TableError::Command(CommandError::NoBetsPlaced))
        ));
    }

    #[test]
    fn a_watched_hand_deals_with_no_money_on_the_felt() {
        // Like standing at a real table without betting: the coup is dealt, the
        // house turns both hands, the result joins the roads, and the roll is
        // untouched.
        let mut t = table();
        let a = t.join("a", 100_000).unwrap();
        t.sit_out(a).unwrap();
        t.deal().unwrap();

        let v = t.view_for(a).unwrap();
        assert_eq!(v.phase, PhaseTag::Dealing);
        // nobody bet either side, so both hands belong to the house dealer
        assert_eq!(v.player_squeezer, None);
        assert_eq!(v.banker_squeezer, None);
        assert!(t.dealer_flip_pending());
        while t.dealer_flip_one() {}

        t.settle().unwrap();
        let v = t.view_for(a).unwrap();
        assert_eq!(v.bankroll, 100_000, "a watched hand costs nothing");
        assert_eq!(v.payouts.as_deref(), Some(&[][..]), "settled, with no payouts");
        assert_eq!(v.scoreboard.bead_plate.cells.len(), 1, "it still joins the roads");
        // and the next coup can be bet normally
        t.place_bet(a, BetKind::Main(BetSpot::Player), 1_000).unwrap();
        t.deal().unwrap();
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
    fn a_holder_turns_their_own_cards_in_any_order() {
        let mut t = table();
        let a = t.join("a", 100_000).unwrap();
        t.place_bet(a, BetKind::Main(BetSpot::Player), 1_000).unwrap();
        t.deal().unwrap();
        // right card first is fine — it's your hand
        t.reveal(a, Side::Player, 1).unwrap();
        t.reveal(a, Side::Player, 0).unwrap();
    }

    #[test]
    fn cards_are_exposed_in_ritual_order() {
        let mut t = table();
        let a = t.join("a", 100_000).unwrap();
        let b = t.join("b", 100_000).unwrap();
        t.place_bet(a, BetKind::Main(BetSpot::Player), 1_000).unwrap();
        t.place_bet(b, BetKind::Main(BetSpot::Banker), 1_000).unwrap();
        t.deal().unwrap();
        // Banker's first card may not be revealed before the Player hand is up
        assert_eq!(t.reveal(b, Side::Banker, 0), Err(TableError::OutOfOrder));
        t.reveal(a, Side::Player, 0).unwrap();
        assert_eq!(t.reveal(b, Side::Banker, 0), Err(TableError::OutOfOrder));
        t.reveal(a, Side::Player, 1).unwrap();
        t.reveal(b, Side::Banker, 0).unwrap();
        t.reveal(b, Side::Banker, 1).unwrap();
        // but peeking ahead is allowed — squeezers fiddle their cards early
        // (only rights gate peeks, not order)
    }

    #[test]
    fn a_shared_table_reserves_unbet_hands_for_the_house_dealer() {
        let mut t = table();
        let a = t.join("a", 100_000).unwrap();
        t.place_bet(a, BetKind::Main(BetSpot::Player), 1_000).unwrap();
        t.deal().unwrap();
        // nobody bet Banker: at a shared table only the paced dealer turns it
        assert!(matches!(t.peek(a, Side::Banker, 0), Err(TableError::NotYourSqueeze { .. })));
        assert!(matches!(t.reveal(a, Side::Banker, 0), Err(TableError::NotYourSqueeze { .. })));
        // the dealer's own flip path is unaffected
        t.reveal(a, Side::Player, 0).unwrap();
        t.reveal(a, Side::Player, 1).unwrap();
        assert!(t.dealer_flip_one());

        // a solo table keeps the old freedom — "reveal all" turns house cards
        let mut solo = Table::new(
            TableConfig {
                table_min: 100,
                table_max: 1_000_000,
                ruleset: Ruleset::Commission,
                max_seats: 1,
            },
            7,
        );
        let p = solo.join("me", 100_000).unwrap();
        solo.place_bet(p, BetKind::Main(BetSpot::Player), 1_000).unwrap();
        solo.deal().unwrap();
        solo.reveal(p, Side::Player, 0).unwrap();
        solo.reveal(p, Side::Player, 1).unwrap();
        solo.reveal(p, Side::Banker, 0).unwrap(); // house hand, solo: allowed
    }

    #[test]
    fn betting_again_after_a_settle_returns_the_view_to_betting() {
        let mut t = table();
        let a = t.join("a", 100_000).unwrap();
        t.place_bet(a, BetKind::Main(BetSpot::Player), 1_000).unwrap();
        t.deal().unwrap();
        t.settle().unwrap();
        assert_eq!(t.view_for(a).unwrap().phase, PhaseTag::Settled);
        // chips down for the next coup: the settled display closes
        t.place_bet(a, BetKind::Main(BetSpot::Banker), 1_000).unwrap();
        let v = t.view_for(a).unwrap();
        assert_eq!(v.phase, PhaseTag::Betting);
        assert!(v.payouts.is_none());
        assert!(v.player.cards.is_empty());
    }

    #[test]
    fn both_betting_player_leaves_the_player_hand_face_down_at_the_deal() {
        let mut t = table();
        let a = t.join("a", 100_000).unwrap();
        let b = t.join("b", 100_000).unwrap();
        t.place_bet(a, BetKind::Main(BetSpot::Player), 5_000).unwrap();
        t.place_bet(b, BetKind::Main(BetSpot::Player), 2_000).unwrap();
        t.deal().unwrap();
        let v = t.view_for(a).unwrap();
        // somebody owns the Player hand, so it must NOT be auto-flipped
        assert_eq!(v.player_squeezer, Some(a));
        assert!(matches!(v.player.cards[0], crate::session::CardView::FaceDown));
        assert!(matches!(v.player.cards[1], crate::session::CardView::FaceDown));
        // the unbet Banker hand waits for the ritual order too
        assert!(matches!(v.banker.cards[0], crate::session::CardView::FaceDown));
    }

    #[test]
    fn the_house_dealer_flips_unbet_sides_in_order() {
        let mut t = table();
        let a = t.join("a", 100_000).unwrap();
        t.place_bet(a, BetKind::Main(BetSpot::Player), 1_000).unwrap();
        t.deal().unwrap();
        // a holds the Player hand, so nothing is exposed yet
        let v = t.view_for(a).unwrap();
        assert!(matches!(v.player.cards[0], crate::session::CardView::FaceDown));
        // a exposes the Player hand; the (unbet) Banker hand becomes the
        // dealer's to flip — one card at a time, paced by the server
        t.reveal(a, Side::Player, 0).unwrap();
        assert!(!t.dealer_flip_pending()); // Player's second card is still a's
        t.reveal(a, Side::Player, 1).unwrap();
        assert!(t.dealer_flip_pending());
        assert!(t.dealer_flip_one());
        let v = t.view_for(a).unwrap();
        assert!(matches!(v.banker.cards[0], crate::session::CardView::FaceUp(_)));
        assert!(matches!(v.banker.cards[1], crate::session::CardView::FaceDown)); // one at a time
        assert!(t.dealer_flip_one());
        assert!(matches!(
            t.view_for(a).unwrap().banker.cards[1],
            crate::session::CardView::FaceUp(_)
        ));
    }

    #[test]
    fn a_tie_only_coup_is_entirely_dealer_flipped() {
        let mut t = table();
        let a = t.join("a", 100_000).unwrap();
        t.place_bet(a, BetKind::Main(BetSpot::Tie), 1_000).unwrap();
        t.deal().unwrap();
        // nobody owns either hand: the dealer flips the whole coup, in order
        let mut flips = 0;
        while t.dealer_flip_one() {
            flips += 1;
        }
        assert!(flips >= 4);
        let v = t.view_for(a).unwrap();
        assert!(v.player.total.is_some());
        assert!(v.banker.total.is_some());
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

    #[test]
    fn rebuy_tops_up_the_roll_without_touching_the_shoe() {
        // Buying more chips must NOT reshuffle: the coups already played stay on
        // the roads and the shoe keeps its position, exactly like handing cash
        // to the dealer mid-shoe.
        let mut t = table();
        let a = t.join("a", 5_000).unwrap();
        for _ in 0..4 {
            t.place_bet(a, BetKind::Main(BetSpot::Player), 1_000).unwrap();
            t.deal().unwrap();
            t.settle().unwrap();
        }
        let before = t.view_for(a).unwrap();
        let beads = before.scoreboard.bead_plate.cells.len();
        assert_eq!(beads, 4);

        t.rebuy(a, 100_000).unwrap();
        let after = t.view_for(a).unwrap();
        assert_eq!(after.bankroll, before.bankroll + 100_000, "roll topped up");
        // the shoe and its history are untouched
        assert_eq!(after.scoreboard.bead_plate.cells.len(), beads, "roads survived");
        assert_eq!(after.scoreboard.big_road.columns, before.scoreboard.big_road.columns);
        // and the next card off the shoe is the shoe's next card, not a new deal
        t.place_bet(a, BetKind::Main(BetSpot::Player), 1_000).unwrap();
        t.deal().unwrap();
        t.settle().unwrap();
        assert_eq!(t.view_for(a).unwrap().scoreboard.bead_plate.cells.len(), beads + 1);
    }

    #[test]
    fn rebuy_is_refused_mid_deal() {
        let mut t = table();
        let a = t.join("a", 5_000).unwrap();
        t.place_bet(a, BetKind::Main(BetSpot::Player), 1_000).unwrap();
        t.deal().unwrap();
        assert!(matches!(
            t.rebuy(a, 1_000),
            Err(TableError::Command(CommandError::WrongPhase { .. }))
        ));
    }

    /// How long is a shoe, really? Counts coups between reshuffles.
    /// `cargo test -p baccarat-engine --release coups_per_shoe -- --ignored --nocapture`
    #[test]
    #[ignore = "informational"]
    fn coups_per_shoe() {
        let mut counts = Vec::new();
        for seed in 0..40u64 {
            let mut t = Table::new(
                TableConfig {
                    table_min: 100,
                    table_max: 1_000_000,
                    ruleset: Ruleset::Commission,
                    max_seats: 1,
                },
                seed,
            );
            let a = t.join("a", i64::MAX / 4).unwrap();
            // play until the shoe reshuffles: the bead plate keeps growing, so
            // detect the reshuffle by watching for the coup that follows it
            let mut coups = 0u32;
            let mut prev_remaining = usize::MAX;
            loop {
                t.place_bet(a, BetKind::Main(BetSpot::Player), 100).unwrap();
                t.deal().unwrap();
                t.settle().unwrap();
                coups += 1;
                let r = t.shoe_remaining();
                if r > prev_remaining {
                    break; // remaining went UP: a fresh shoe was loaded
                }
                prev_remaining = r;
                if coups > 500 {
                    break;
                }
            }
            counts.push(coups - 1); // the last coup came off the new shoe
        }
        let n = counts.len() as f64;
        let mean = counts.iter().map(|c| *c as f64).sum::<f64>() / n;
        let min = counts.iter().min().unwrap();
        let max = counts.iter().max().unwrap();
        eprintln!("coups per shoe over {n} shoes: mean {mean:.1}, min {min}, max {max}");
    }

    /// Do players actually reach the end of a shoe (~80 coups), or does the run
    /// end first? Flat-bets Banker at the Low table ($500 roll, $1 min, $5,000
    /// goal) across a range of stake sizes.
    /// `cargo test -p baccarat-engine --release runs_vs_shoe_length -- --ignored --nocapture`
    #[test]
    #[ignore = "informational"]
    fn runs_vs_shoe_length() {
        const SHOE: u32 = 80; // measured mean, see coups_per_shoe
        const GOAL: i64 = 500_000;
        const BUY_IN: i64 = 50_000;
        const MIN: i64 = 100;
        eprintln!("stake     median hands   reach 1 shoe   hit goal   bust");
        for stake in [100i64, 500, 2_500, 10_000, 50_000] {
            let runs = 600u32;
            let (mut lens, mut shoe_end, mut goals, mut busts) = (Vec::new(), 0u32, 0u32, 0u32);
            for seed in 0..runs as u64 {
                let mut t = Table::new(
                    TableConfig {
                        table_min: MIN,
                        table_max: 50_000,
                        ruleset: Ruleset::Commission,
                        max_seats: 1,
                    },
                    seed,
                );
                let p = t.join("p", BUY_IN).unwrap();
                let mut hands = 0u32;
                loop {
                    let roll = t.view_for(p).unwrap().bankroll;
                    if roll >= GOAL {
                        goals += 1;
                        break;
                    }
                    if roll < MIN {
                        busts += 1;
                        break;
                    }
                    if hands >= 240 {
                        break; // grinder: cap at ~3 shoes
                    }
                    let bet = stake.min(roll).max(MIN);
                    t.place_bet(p, BetKind::Main(BetSpot::Banker), bet).unwrap();
                    t.deal().unwrap();
                    t.settle().unwrap();
                    hands += 1;
                }
                if hands >= SHOE {
                    shoe_end += 1;
                }
                lens.push(hands);
            }
            lens.sort_unstable();
            let median = lens[lens.len() / 2];
            let pct = |n: u32| 100.0 * n as f64 / runs as f64;
            eprintln!(
                "${:<8} {:<14} {:<14.1} {:<10.1} {:.1}",
                stake / 100,
                median,
                pct(shoe_end),
                pct(goals),
                pct(busts)
            );
        }
    }

    #[test]
    fn scoreboard_cache_stays_fresh_and_consistent() {
        // The memoized scoreboard must grow by one bead each settled coup (not
        // go stale) and return an identical board on a repeat view (cache hit).
        let mut t = table();
        let a = t.join("a", 10_000_000).unwrap();
        for expected in 1..=6 {
            t.place_bet(a, BetKind::Main(BetSpot::Player), 1_000).unwrap();
            t.deal().unwrap();
            t.settle().unwrap();
            let first = t.view_for(a).unwrap().scoreboard;
            let second = t.view_for(a).unwrap().scoreboard; // cache-hit path
            assert_eq!(first, second, "repeat view returned a different board");
            assert_eq!(
                first.bead_plate.cells.len(),
                expected,
                "cache went stale — bead count didn't track the coup count"
            );
        }
    }
}

#[cfg(test)]
mod broke_seat_tests {
    use super::*;
    use crate::settle::BetSpot;

    fn table() -> Table {
        Table::new(
            TableConfig { table_min: 100, table_max: 10_000, ruleset: Ruleset::Commission, max_seats: 7 },
            7,
        )
    }

    #[test]
    fn a_seat_that_cannot_cover_the_minimum_does_not_freeze_the_table() {
        let mut t = table();
        let rich = t.join("rich", 5_000).unwrap();
        let broke = t.join("broke", 50).unwrap(); // below the 100 minimum

        t.place_bet(rich, BetKind::Main(BetSpot::Banker), 100).unwrap();
        // The broke seat never acts — it cannot, no bet it could make is legal.
        // Before this fix the deal waited on them forever.
        t.deal().expect("a seat that cannot bet must not block the coup");

        let seat = t.view_for(rich).unwrap().seats.iter().find(|s| s.id == broke).cloned().unwrap();
        assert!(seat.broke, "the view should mark them so the client can prompt");
        assert!(seat.decided, "and treat them as decided");
    }

    #[test]
    fn a_seat_that_can_still_afford_the_minimum_is_waited_for() {
        let mut t = table();
        let a = t.join("a", 5_000).unwrap();
        let b = t.join("b", 100).unwrap(); // exactly the minimum — still playable

        t.place_bet(a, BetKind::Main(BetSpot::Banker), 100).unwrap();
        assert!(
            matches!(t.deal(), Err(TableError::WaitingOnPlayers)),
            "a player who can still bet must not be dealt past"
        );

        t.place_bet(b, BetKind::Main(BetSpot::Player), 100).unwrap();
        t.deal().expect("both decided now");
    }

    #[test]
    fn going_broke_mid_session_unblocks_the_next_coup() {
        // The realistic path: a player busts on a hand, then can't act.
        let mut t = table();
        let a = t.join("a", 5_000).unwrap();
        let b = t.join("b", 150).unwrap();
        t.place_bet(a, BetKind::Main(BetSpot::Banker), 100).unwrap();
        t.place_bet(b, BetKind::Main(BetSpot::Player), 100).unwrap();
        t.deal().unwrap();
        t.settle().unwrap();

        // Whatever the result, drain b below the minimum and confirm the table
        // still moves without them.
        while t.view_for(a).unwrap().seats.iter().find(|s| s.id == b).unwrap().bankroll >= 100 {
            let left = t.view_for(a).unwrap().seats.iter().find(|s| s.id == b).unwrap().bankroll;
            t.place_bet(b, BetKind::Main(BetSpot::Tie), left.min(10_000)).unwrap();
            t.place_bet(a, BetKind::Main(BetSpot::Banker), 100).unwrap();
            t.deal().unwrap();
            t.settle().unwrap();
        }

        t.place_bet(a, BetKind::Main(BetSpot::Banker), 100).unwrap();
        t.deal().expect("the busted seat must not hold the table hostage");
    }
}
