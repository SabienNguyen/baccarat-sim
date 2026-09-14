//! A multiplayer baccarat table: several players bet on the same coup from
//! the same shoe and settle independently against their own bankrolls.
//! The round flow (tableau, cut card, burn, reveal ritual) is identical to
//! the single-player `Session`; this adds seats on top of it.

use crate::round::{play_round, RoundResult};
use crate::scoreboard::{derive_scoreboard, RoundRecord, ScoreboardSnapshot, Side};
use crate::session::{
    aggregate_payouts, derive_events, fully_revealed, hand_view, BetKind, CardStatus, CommandError,
    Event, HandView, PhaseTag, PlacedBet, RevealState, ShoeCutReason, ShoeView, VoteView,
};
use crate::settle::{settle_with, Bet, Ruleset};
use crate::shoe::{Shoe, CUT_CARD};
use crate::sidebets::settle_side;
use serde::{Deserialize, Serialize};

/// A seat at the table, identified for the lifetime of the table. Defined in
/// `session.rs` (shared with `ShoeView`/`VoteView`); re-exported here so
/// `baccarat_engine::table::PlayerId` keeps working.
pub use crate::session::PlayerId;

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
    /// Those cards are in someone else's hands: another seat's, or — when
    /// `house` — the dealer's (a hand nobody bet, turned by the pacer).
    NotYourSqueeze { side: Side, house: bool },
    /// The ritual exposes cards in order: Player hand, Banker hand, thirds.
    OutOfOrder,
    /// A dealer-flip request with nothing behind it: the asker holds no
    /// squeeze, the house hand is already up, or the dealer is turning it
    /// anyway.
    NothingToTurn,
    /// The cut belongs to the host — someone else tried to cut the shoe.
    NotYourCut,
    /// A New Shoe vote is already open.
    VoteOpen,
    /// No New Shoe vote is open to vote on.
    NoVote,
    Command(CommandError),
}

/// How much of the house-held hand the squeezer asks the dealer to turn
/// early — the high-limit courtesy of "flip one" / "flip both".
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "wasm", derive(tsify_next::Tsify))]
#[cfg_attr(feature = "wasm", tsify(into_wasm_abi, from_wasm_abi))]
pub enum FlipRequest {
    One,
    Both,
}

impl From<CommandError> for TableError {
    fn from(e: CommandError) -> Self {
        TableError::Command(e)
    }
}

/// The reveal ritual: Player's two, Banker's two, then the thirds. Every
/// "whose turn is it" question at a shared table walks this list.
const RITUAL_ORDER: [(Side, usize); 6] = [
    (Side::Player, 0),
    (Side::Player, 1),
    (Side::Banker, 0),
    (Side::Banker, 1),
    (Side::Player, 2),
    (Side::Banker, 2),
];

struct Player {
    id: PlayerId,
    name: String,
    bankroll: i64,
    bets: Vec<PlacedBet>,
    /// Chose to skip this coup.
    sitting_out: bool,
    /// Declared ready to deal, having bet — reset every coup.
    ready: bool,
    /// Last round's payouts, kept until the next deal.
    payouts: Option<Vec<crate::session::BetPayout>>,
}

impl Player {
    /// Sitting out, unable to bet at all, or bet AND declared ready — ready
    /// for the deal.
    ///
    /// The affordability case is what stops one broke seat freezing the table.
    /// A player whose bankroll won't cover the table minimum cannot place a bet
    /// even if they want to, so waiting for them to "decide" waits forever;
    /// treating them as decided is the same call a pit makes when it deals past
    /// someone who has stopped buying in. A seat that has bet but not yet
    /// readied up is NOT decided — everyone must ready up before the coup
    /// deals.
    fn decided(&self, table_min: i64) -> bool {
        self.sitting_out || self.ready || self.broke(table_min)
    }

    /// Can't cover the table minimum, so can't take part in this coup.
    fn broke(&self, table_min: i64) -> bool {
        self.bankroll < table_min
    }
}

/// An in-progress New Shoe vote. Only possible in `Phase::Betting`.
struct Vote {
    proposer: PlayerId,
    yes: Vec<PlayerId>,
    no: Vec<PlayerId>,
}

enum Phase {
    /// Before betting can open: waiting on the host to cut a fresh shoe.
    ShoeCut { reason: ShoeCutReason },
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
    pub shoe: ShoeView,
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
    /// This seat's staged bets — the same money `staked` totals, broken out
    /// by spot so every seat can see what everyone else is riding on.
    pub bets: Vec<PlacedBet>,
    pub sitting_out: bool,
    /// Declared ready to deal (requires a bet). Reset every coup.
    pub ready: bool,
    /// Sitting out, ready, or broke — the deal waits for everyone to decide.
    pub decided: bool,
    /// Bankroll won't cover the table minimum, so this seat can't bet at all.
    pub broke: bool,
    /// The first player to join (or their successor by join order). Holds
    /// the cut while the table is in `ShoeCut`.
    pub host: bool,
}

pub struct Table {
    config: TableConfig,
    seed: u64,
    /// Incremented on every cut; 0 until the first one. Also seeds the next
    /// shoe (`seed.wrapping_add(shoe_number)`), so the sequence is
    /// reproducible from the table seed alone.
    shoe_number: u32,
    shoe: Shoe,
    phase: Phase,
    players: Vec<Player>,
    next_player: u64,
    /// The first player to join, or their successor by join order once they
    /// leave. Holds the cut for every shoe. `None` with no seats.
    host: Option<PlayerId>,
    /// True once a hand has been dealt with the shoe at or below `CUT_CARD`
    /// remaining; one more hand is played, then the shoe ends.
    cut_card_out: bool,
    /// The most recent cut's ceremony, for clients to replay the animation.
    /// Cleared whenever the phase enters `ShoeCut` again.
    last_cut: Option<crate::shoe::CutReveal>,
    history: Vec<RoundRecord>,
    /// Outcome of the most recent settled round, until the next deal.
    last_outcome: Option<crate::round::Outcome>,
    /// The settled round's cards, kept on the felt until the next deal.
    last_round: Option<RoundResult>,
    /// True from a settle until any seat opens the next coup (bets or sits
    /// out). Each seat's own settled display is keyed on its `payouts`; a
    /// spectator has no seat, so theirs is keyed on the table as a whole.
    settled_on_felt: bool,
    /// Memoized scoreboard, keyed on `(shoe_number, history.len())` so a cut
    /// (which clears history back to an empty, previously-seen length)
    /// still invalidates the cache. `history` is otherwise append-only
    /// within a shoe — this skips recomputing all five roads on every view
    /// (a view is built after every command, ~8-10× per coup, but the
    /// scoreboard only changes once per settled round).
    sb_cache: std::cell::RefCell<Option<((u32, usize), ScoreboardSnapshot)>>,
    /// An open New Shoe vote, if any. Only possible during `Phase::Betting`.
    vote: Option<Vote>,
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
            shoe_number: 0,
            // Placeholder shoe — never dealt from until the first cut.
            shoe: Shoe::new_seeded(seed),
            phase: Phase::ShoeCut { reason: ShoeCutReason::NewTable },
            players: Vec::new(),
            next_player: 0,
            host: None,
            cut_card_out: false,
            last_cut: None,
            history: Vec::new(),
            last_outcome: None,
            last_round: None,
            settled_on_felt: false,
            sb_cache: std::cell::RefCell::new(None),
            vote: None,
        }
    }

    /// The current phase, as the client-visible tag.
    fn phase_tag(&self) -> PhaseTag {
        match &self.phase {
            Phase::ShoeCut { .. } => PhaseTag::ShoeCut,
            Phase::Betting => PhaseTag::Betting,
            Phase::Dealing { .. } => PhaseTag::Dealing,
        }
    }

    /// The first player to join, or their successor by join order.
    pub fn host(&self) -> Option<PlayerId> {
        self.host
    }

    /// 0 until the first cut, then incremented on every cut.
    pub fn shoe_number(&self) -> u32 {
        self.shoe_number
    }

    /// The scoreboard, recomputed only when `(shoe_number, history.len())`
    /// changed since the last call (see `sb_cache`). Behavior-identical to
    /// `derive_scoreboard`.
    fn scoreboard(&self) -> ScoreboardSnapshot {
        let key = (self.shoe_number, self.history.len());
        if let Some((cached_key, snap)) = self.sb_cache.borrow().as_ref() {
            if *cached_key == key {
                return snap.clone();
            }
        }
        let snap = derive_scoreboard(&self.history);
        *self.sb_cache.borrow_mut() = Some((key, snap.clone()));
        snap
    }

    /// Only the host may cut. `position` is a fraction of the shoe in
    /// `0..=1000` (clamped by the engine to `50..=950`).
    pub fn cut_shoe(&mut self, pid: PlayerId, position: u16) -> Result<(), TableError> {
        if !matches!(self.phase, Phase::ShoeCut { .. }) {
            return Err(CommandError::WrongPhase {
                expected: PhaseTag::ShoeCut,
                found: self.phase_tag(),
            }
            .into());
        }
        if self.host != Some(pid) {
            return Err(TableError::NotYourCut);
        }
        self.shoe_number += 1;
        let (shoe, reveal) = Shoe::new_cut(self.seed.wrapping_add(self.shoe_number as u64), position);
        self.shoe = shoe;
        self.last_cut = Some(reveal);
        self.history.clear();
        self.cut_card_out = false;
        self.last_outcome = None;
        self.last_round = None;
        self.settled_on_felt = false;
        for p in &mut self.players {
            p.bets.clear();
            p.ready = false;
            p.sitting_out = false;
            p.payouts = None;
        }
        self.phase = Phase::Betting;
        Ok(())
    }

    /// Open a New Shoe vote: Betting only, one vote at a time, proposer must
    /// be seated. The proposer counts as an immediate yes, so a lone seat
    /// (or any table where that alone is already a majority) passes on the
    /// spot.
    pub fn propose_new_shoe(&mut self, pid: PlayerId) -> Result<(), TableError> {
        if !matches!(self.phase, Phase::Betting) {
            return Err(CommandError::WrongPhase {
                expected: PhaseTag::Betting,
                found: self.phase_tag(),
            }
            .into());
        }
        if self.vote.is_some() {
            return Err(TableError::VoteOpen);
        }
        // seated check
        if !self.players.iter().any(|p| p.id == pid) {
            return Err(TableError::NoSuchPlayer);
        }
        self.vote = Some(Vote { proposer: pid, yes: vec![pid], no: Vec::new() });
        self.resolve_vote();
        Ok(())
    }

    /// Cast (or change) a vote on the open New Shoe proposal. Seated players
    /// only; a player may switch their vote as many times as they like until
    /// the vote resolves.
    pub fn vote_new_shoe(&mut self, pid: PlayerId, yes: bool) -> Result<(), TableError> {
        if self.vote.is_none() {
            return Err(TableError::NoVote);
        }
        if !self.players.iter().any(|p| p.id == pid) {
            return Err(TableError::NoSuchPlayer);
        }
        let vote = self.vote.as_mut().expect("checked above");
        vote.yes.retain(|&p| p != pid);
        vote.no.retain(|&p| p != pid);
        if yes {
            vote.yes.push(pid);
        } else {
            vote.no.push(pid);
        }
        self.resolve_vote();
        Ok(())
    }

    /// The server's 30 s timer calls this when an open vote's window elapses
    /// without a resolution: it fails, same as a decisive "no". A no-op when
    /// nothing is open (the vote may have already resolved).
    pub fn vote_expire(&mut self) {
        self.vote = None;
    }

    /// Whether a New Shoe vote is currently open.
    pub fn vote_open(&self) -> bool {
        self.vote.is_some()
    }

    /// Resolve the open vote against the current seat count, if any: pass on
    /// a strict majority yes, fail once a majority can no longer be reached.
    /// Otherwise the vote stays open. Called after every vote change and
    /// after a leave.
    fn resolve_vote(&mut self) {
        let Some(vote) = &self.vote else { return };
        let seats = self.players.len();
        if seats == 0 {
            // Nobody left to vote — nothing to resolve.
            self.vote = None;
            return;
        }
        if vote.yes.len() * 2 > seats {
            // Pass: every seat's staged bets are cleared. Bets are only
            // staged (not yet drawn from the bankroll), so `bets.clear()`
            // alone conserves money — there is nothing to refund.
            for p in &mut self.players {
                p.bets.clear();
                p.ready = false;
                p.payouts = None;
            }
            self.phase = Phase::ShoeCut { reason: ShoeCutReason::Vote };
            self.last_cut = None;
            self.vote = None;
        } else if vote.no.len() * 2 >= seats {
            // Fail: a majority yes can no longer be reached.
            self.vote = None;
        }
        // else: still open, waiting on more votes.
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
            ready: false,
            payouts: None,
        });
        if self.host.is_none() {
            self.host = Some(id);
        }
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
        // Host handover: the next seat by join order (players are stored in
        // join order — pushed once in `join`, never reordered). Never
        // touches the shoe, history or phase.
        if self.host == Some(pid) {
            self.host = self.players.first().map(|p| p.id);
        }
        // An open vote loses the leaver's tally (whether they were the
        // proposer, a yes or a no — the proposer leaving does not cancel the
        // vote) and re-resolves against the smaller seat count. If nobody is
        // left at all, `resolve_vote` clears it.
        if let Some(vote) = &mut self.vote {
            vote.yes.retain(|&p| p != pid);
            vote.no.retain(|&p| p != pid);
            self.resolve_vote();
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
                found: self.phase_tag(),
            }
            .into());
        }
        let (min, max) = (self.config.table_min, self.config.table_max);
        let solo = self.config.max_seats == 1;
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
        // A change to the bets un-readies the seat — ready again to confirm.
        // A solo table (one seat, nobody else to wait on) keeps today's
        // behavior: a bet alone is enough, so a bet auto-readies there.
        player.ready = solo;
        self.settled_on_felt = false; // the next coup is open
        Ok(())
    }

    /// Skip this coup: bets come back and the table stops waiting on you.
    pub fn sit_out(&mut self, pid: PlayerId) -> Result<(), TableError> {
        if !matches!(self.phase, Phase::Betting) {
            return Err(CommandError::WrongPhase {
                expected: PhaseTag::Betting,
                found: self.phase_tag(),
            }
            .into());
        }
        let player = self.player_mut(pid)?;
        player.bets.clear();
        player.sitting_out = true;
        player.payouts = None;
        self.settled_on_felt = false; // a decision opens the next coup too
        Ok(())
    }

    pub fn clear_bets(&mut self, pid: PlayerId) -> Result<(), TableError> {
        if !matches!(self.phase, Phase::Betting) {
            return Err(CommandError::WrongPhase {
                expected: PhaseTag::Betting,
                found: self.phase_tag(),
            }
            .into());
        }
        let player = self.player_mut(pid)?;
        player.bets.clear();
        player.ready = false;
        Ok(())
    }

    /// Declare ready to deal: requires at least one bet staged this coup.
    /// A change of mind after readying (another bet, or clearing bets) drops
    /// it again — see `place_bet` / `clear_bets`.
    pub fn ready(&mut self, pid: PlayerId) -> Result<(), TableError> {
        if !matches!(self.phase, Phase::Betting) {
            return Err(CommandError::WrongPhase {
                expected: PhaseTag::Betting,
                found: self.phase_tag(),
            }
            .into());
        }
        let player = self.player_mut(pid)?;
        if player.bets.is_empty() {
            return Err(CommandError::NoBetsPlaced.into());
        }
        player.ready = true;
        Ok(())
    }

    /// Take back a ready declaration. Betting phase only.
    pub fn unready(&mut self, pid: PlayerId) -> Result<(), TableError> {
        if !matches!(self.phase, Phase::Betting) {
            return Err(CommandError::WrongPhase {
                expected: PhaseTag::Betting,
                found: self.phase_tag(),
            }
            .into());
        }
        self.player_mut(pid)?.ready = false;
        Ok(())
    }

    /// Betting phase, at least one seat, and every seat decided under the
    /// ready-up rule — the same gate `deal()` checks.
    pub fn all_ready(&self) -> bool {
        matches!(self.phase, Phase::Betting)
            && !self.players.is_empty()
            && self.players.iter().all(|p| p.decided(self.config.table_min))
    }

    /// Buy more chips without leaving the table. In a pit you hand over cash
    /// and keep playing the *same* shoe — the cards already dealt stay dealt and
    /// the roads keep running — so this only tops up a seat's bankroll and
    /// touches nothing about the shoe or the history.
    pub fn rebuy(&mut self, pid: PlayerId, amount: i64) -> Result<(), TableError> {
        debug_assert!(amount >= 0, "negative rebuy");
        // Allowed in Betting AND ShoeCut (like rename, join, leave) — only a
        // hand in progress holds it up.
        if matches!(self.phase, Phase::Dealing { .. }) {
            return Err(CommandError::WrongPhase {
                expected: PhaseTag::Betting,
                found: self.phase_tag(),
            }
            .into());
        }
        let player = self.player_mut(pid)?;
        player.bankroll = player.bankroll.saturating_add(amount.max(0));
        // a fresh stake clears the finished round's display, like place_bet does
        player.payouts = None;
        Ok(())
    }

    /// Change the name the rest of the table sees. Allowed in any phase: a
    /// name is display-only, so nothing about the coup or the money moves.
    /// Callers sanitize; the engine stores what it's given.
    pub fn rename(&mut self, pid: PlayerId, name: &str) -> Result<(), TableError> {
        self.player_mut(pid)?.name = name.to_string();
        Ok(())
    }

    /// Deal the coup. Requires at least one staged bet anywhere at the table.
    pub fn deal(&mut self) -> Result<(), TableError> {
        if !matches!(self.phase, Phase::Betting) {
            return Err(CommandError::WrongPhase {
                expected: PhaseTag::Betting,
                found: self.phase_tag(),
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
        // No silent reshuffle — the shoe ends via the cut-card-out rule in
        // `settle()` and only the host's cut ever replaces it.
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
        // An open vote does not block dealing — Betting only waits on
        // `all_ready`, not on a vote. But the coup dealing while a vote is
        // open makes the vote moot (its resolution targets Betting), so it
        // is silently cleared rather than left to resolve into a phase that
        // has already moved on.
        self.vote = None;
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

    /// The next card in ritual order that is not yet face up, and who holds
    /// it: `None` for the house, `Some(pid)` for a squeezer. `None` overall
    /// when no coup is out or every drawn card is up.
    fn next_face_down(&self) -> Option<(Side, usize, Option<PlayerId>)> {
        let Phase::Dealing { reveal, player_squeezer, banker_squeezer, .. } = &self.phase else {
            return None;
        };
        for (h, i) in RITUAL_ORDER {
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
            let owner = match h {
                Side::Player => *player_squeezer,
                Side::Banker => *banker_squeezer,
            };
            return Some((h, i, owner));
        }
        None
    }

    /// The next card in ritual order that belongs to the house (a side
    /// nobody bet), if it's that card's turn to be exposed.
    fn next_dealer_card(&self) -> Option<(Side, usize)> {
        match self.next_face_down() {
            Some((h, i, None)) => Some((h, i)),
            _ => None,
        }
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

    /// The high-limit courtesy: while still squeezing their own hand, the
    /// player may ask the dealer to turn one or both of the house-held
    /// hand's initial two cards ahead of ritual order. Pure reveal order —
    /// the coup, its draws and its payout are already fixed.
    ///
    /// Allowed only for the seat that holds a squeeze, only while that
    /// hand is not yet fully up, and only when the other hand belongs to the
    /// house and the dealer is not already turning it (once the squeezer's
    /// hand is exposed, or when the house hand comes first in ritual order,
    /// the pacer is at work and there is nothing to hurry along). Third
    /// cards are never part of the ask; they follow the ritual as usual.
    ///
    /// Returns the house hand that was turned.
    pub fn request_dealer_flip(&mut self, pid: PlayerId, count: FlipRequest) -> Result<Side, TableError> {
        let Phase::Dealing { player_squeezer, banker_squeezer, .. } = &self.phase else {
            return Err(CommandError::WrongPhase {
                expected: PhaseTag::Dealing,
                found: self.phase_tag(),
            }
            .into());
        };
        // which hand is the asker squeezing, and which is the dealer's?
        let dealer_side = match (*player_squeezer == Some(pid), *banker_squeezer == Some(pid)) {
            (true, false) => Side::Banker,
            (false, true) => Side::Player,
            _ => return Err(TableError::NothingToTurn), // holds none, or both
        };
        let holder = match dealer_side {
            Side::Player => *player_squeezer,
            Side::Banker => *banker_squeezer,
        };
        if holder.is_some() {
            return Err(TableError::NotYourSqueeze { side: dealer_side, house: false });
        }
        if self.next_dealer_card().is_some() {
            return Err(TableError::NothingToTurn); // the dealer is already turning
        }
        let Phase::Dealing { reveal, .. } = &mut self.phase else { unreachable!() };
        let statuses = match dealer_side {
            Side::Player => &mut reveal.player,
            Side::Banker => &mut reveal.banker,
        };
        let mut down = statuses
            .iter_mut()
            .take(2)
            .filter(|s| **s != CardStatus::FaceUp)
            .peekable();
        if down.peek().is_none() {
            return Err(TableError::NothingToTurn);
        }
        let turn = match count {
            FlipRequest::One => 1,
            FlipRequest::Both => 2,
        };
        for s in down.take(turn) {
            *s = CardStatus::FaceUp;
        }
        Ok(dealer_side)
    }

    /// Lift a corner. At a shared table a peek follows the ritual like a
    /// reveal does — the Banker squeezer waits for the Player hand to be up
    /// before touching their cards. A solo table keeps its peek-ahead: the
    /// lone player may fiddle their Banker card while the dealer turns the
    /// Player hand (the solo client relies on this — "peeking is fine, no
    /// dealer scolding"), and only the flip itself is held to order.
    ///
    /// Returns whether the card actually went from face-down to peeked. A
    /// repeat peek (or one at a card already up) is accepted but changes
    /// nothing — callers that treat a peek as activity should check.
    pub fn peek(&mut self, pid: PlayerId, hand: Side, index: usize) -> Result<bool, TableError> {
        self.check_rights(pid, hand)?;
        if self.config.max_seats > 1 {
            self.check_order(hand, index)?;
        }
        self.set_status(hand, index, CardStatus::Peeked)
    }

    /// Who squeezes this hand in the current coup: `None` for the house, or
    /// when no coup is out.
    pub fn squeezer(&self, side: Side) -> Option<PlayerId> {
        let Phase::Dealing { player_squeezer, banker_squeezer, .. } = &self.phase else {
            return None;
        };
        match side {
            Side::Player => *player_squeezer,
            Side::Banker => *banker_squeezer,
        }
    }

    /// The seat's display name, for the dealer to speak.
    pub fn name_of(&self, pid: PlayerId) -> Option<&str> {
        self.players.iter().find(|p| p.id == pid).map(|p| p.name.as_str())
    }

    /// The house takes over this seat's squeeze(s) for the current coup —
    /// the holder dropped or stalled. Seat, bets and bankroll are untouched;
    /// only the right to turn the cards moves to the dealer, whose pacer
    /// then turns them. Returns the sides surrendered (empty when the seat
    /// held nothing, or no coup is out), so it is safe to call twice.
    pub fn surrender_squeeze(&mut self, pid: PlayerId) -> Vec<Side> {
        [Side::Player, Side::Banker]
            .into_iter()
            .filter(|side| self.surrender_squeeze_side(pid, *side))
            .collect()
    }

    /// The house takes over ONE of this seat's squeezes for the current coup
    /// — the hand the table is actually waiting on. A holder of both hands
    /// who stalls on Player keeps Banker. Returns whether anything moved.
    pub fn surrender_squeeze_side(&mut self, pid: PlayerId, side: Side) -> bool {
        let Phase::Dealing { player_squeezer, banker_squeezer, .. } = &mut self.phase else {
            return false;
        };
        let holder = match side {
            Side::Player => player_squeezer,
            Side::Banker => banker_squeezer,
        };
        if *holder == Some(pid) {
            *holder = None;
            true
        } else {
            false
        }
    }

    /// Who the table is waiting on: the human holder of the next face-down
    /// card in ritual order. `None` when the coup is over, or when that card
    /// is the house's (the pacer is at work, nobody is stalling).
    pub fn stalled_squeeze(&self) -> Option<(PlayerId, Side)> {
        match self.next_face_down() {
            Some((h, _, Some(pid))) => Some((pid, h)),
            _ => None,
        }
    }

    pub fn reveal(&mut self, pid: PlayerId, hand: Side, index: usize) -> Result<(), TableError> {
        self.check_rights(pid, hand)?;
        self.check_order(hand, index)?;
        self.set_status(hand, index, CardStatus::FaceUp).map(|_| ())
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
                    return Err(TableError::NotYourSqueeze { side: hand, house: false });
                }
                None if self.config.max_seats > 1 => {
                    return Err(TableError::NotYourSqueeze { side: hand, house: true });
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
        for (h, i) in RITUAL_ORDER {
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

    /// Returns whether the card's status actually changed (a peek at a card
    /// already peeked or up, or a reveal of one already up, changes nothing).
    fn set_status(&mut self, hand: Side, index: usize, to: CardStatus) -> Result<bool, TableError> {
        let tag = self.phase_tag();
        match &mut self.phase {
            Phase::Dealing { reveal, .. } => {
                let statuses = match hand {
                    Side::Player => &mut reveal.player,
                    Side::Banker => &mut reveal.banker,
                };
                if index >= statuses.len() {
                    return Err(CommandError::BadCardIndex { hand, index }.into());
                }
                let was = statuses[index];
                if !(to == CardStatus::Peeked && was == CardStatus::FaceUp) {
                    statuses[index] = to;
                }
                Ok(statuses[index] != was)
            }
            _ => Err(CommandError::WrongPhase { expected: PhaseTag::Dealing, found: tag }.into()),
        }
    }

    /// Resolve the coup: every player settles independently.
    pub fn settle(&mut self) -> Result<(), TableError> {
        let round = match &self.phase {
            Phase::Dealing { round, .. } => round.clone(),
            _ => {
                return Err(CommandError::WrongPhase {
                    expected: PhaseTag::Dealing,
                    found: self.phase_tag(),
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
            p.payouts = Some(aggregate_payouts(payouts));
            p.bets.clear();
            p.sitting_out = false; // fresh decision every coup
            p.ready = false;
        }
        self.last_outcome = Some(round.outcome);
        self.last_round = Some(round.clone());
        self.settled_on_felt = true;
        self.history.push(RoundRecord::from_round(&round));
        // Realistic cut-card-end: the coup that pushed the shoe past the cut
        // card finishes, one more hand is dealt, and only THEN does the shoe
        // end — never mid-coup.
        if self.cut_card_out {
            self.phase = Phase::ShoeCut { reason: ShoeCutReason::CutCardOut };
        } else {
            self.phase = Phase::Betting;
            if self.shoe.remaining() <= CUT_CARD {
                self.cut_card_out = true;
            }
        }
        Ok(())
    }

    /// The table as one seated player sees it. Face-down cards stay face down
    /// in every view; money fields are the viewer's own.
    pub fn view_for(&self, pid: PlayerId) -> Result<TableView, TableError> {
        let player = self
            .players
            .iter()
            .find(|p| p.id == pid)
            .ok_or(TableError::NoSuchPlayer)?;
        Ok(self.view_as(Some(player)))
    }

    /// The table as someone standing behind the seats sees it: a spectator
    /// with no chair, no chips and no cards. Everything the seats share — the
    /// felt, the roads, who holds which hand, the seat strip — is here. The
    /// money fields are empty, every peeked sliver stays face down (a peek is
    /// one squeezer's private glimpse), and the settled coup stays on the felt
    /// until any seat opens the next one.
    pub fn view_public(&self) -> TableView {
        self.view_as(None)
    }

    fn view_as(&self, viewer: Option<&Player>) -> TableView {
        let seats = self
            .players
            .iter()
            .map(|p| SeatView {
                id: p.id,
                name: p.name.clone(),
                bankroll: p.bankroll,
                staked: p.bets.iter().map(|b| b.amount).sum(),
                bets: p.bets.clone(),
                sitting_out: p.sitting_out,
                ready: p.ready,
                decided: p.decided(self.config.table_min),
                // Out of chips for this table — the client shows a rebuy or
                // leave prompt, and the deal no longer waits on them.
                broke: p.broke(self.config.table_min),
                host: self.host == Some(p.id),
            })
            .collect();
        let (player_squeezer, banker_squeezer) = match &self.phase {
            Phase::Dealing { player_squeezer, banker_squeezer, .. } => {
                (*player_squeezer, *banker_squeezer)
            }
            Phase::Betting | Phase::ShoeCut { .. } => (None, None),
        };
        let shoe = ShoeView {
            number: self.shoe_number,
            cut_card_out: self.cut_card_out,
            cut_reason: match &self.phase {
                Phase::ShoeCut { reason } => Some(*reason),
                _ => None,
            },
            // The host always holds the cut; there is nobody to cut for once
            // betting or a coup is under way.
            cutter: match &self.phase {
                Phase::ShoeCut { .. } => self.host,
                _ => None,
            },
            last_cut: self.last_cut,
            vote: self.vote.as_ref().map(|v| VoteView {
                proposer: v.proposer,
                yes: v.yes.clone(),
                no: v.no.clone(),
                needed: (self.players.len() / 2 + 1) as u8,
            }),
        };
        let viewer_id = viewer.map(|p| p.id);
        // A seat's settled display closes the moment THEY re-bet or sit out
        // (their `payouts` clears). A spectator's closes when anyone does.
        let showing_settled = match viewer {
            Some(p) => p.payouts.is_some(),
            None => self.settled_on_felt,
        };
        let bets = viewer.map(|p| p.bets.clone()).unwrap_or_default();
        let bankroll = viewer.map_or(0, |p| p.bankroll);

        // A settled coup keeps its cards on the felt, face up, until the next
        // deal — the result should be readable, not swept away with the chips.
        let settled_hands = |side: Side| -> HandView {
            match (&self.last_round, showing_settled) {
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
        match &self.phase {
            Phase::Betting => TableView {
                phase: if showing_settled { PhaseTag::Settled } else { PhaseTag::Betting },
                player: settled_hands(Side::Player),
                banker: settled_hands(Side::Banker),
                bets,
                bankroll,
                table_min: self.config.table_min,
                table_max: self.config.table_max,
                // Gate on the settled display, like payouts and explain — once
                // it closes, the previous coup's outcome is no longer on show.
                outcome: if showing_settled { self.last_outcome } else { None },
                payouts: viewer.and_then(|p| p.payouts.clone()),
                events: Vec::new(),
                scoreboard: self.scoreboard(),
                // Keep the 'why this round' trace on the settled felt — the same
                // window (and key) the face-up cards use — so the explanation is
                // there while the learner studies the finished coup.
                explain: match (&self.last_round, showing_settled) {
                    (Some(round), true) => round.trace.clone(),
                    _ => Vec::new(),
                },
                seats,
                player_squeezer,
                banker_squeezer,
                shoe: shoe.clone(),
            },
            Phase::ShoeCut { .. } => TableView {
                phase: PhaseTag::ShoeCut,
                player: settled_hands(Side::Player),
                banker: settled_hands(Side::Banker),
                bets,
                bankroll,
                table_min: self.config.table_min,
                table_max: self.config.table_max,
                outcome: if showing_settled { self.last_outcome } else { None },
                payouts: viewer.and_then(|p| p.payouts.clone()),
                events: Vec::new(),
                scoreboard: self.scoreboard(),
                explain: match (&self.last_round, showing_settled) {
                    (Some(round), true) => round.trace.clone(),
                    _ => Vec::new(),
                },
                seats,
                player_squeezer,
                banker_squeezer,
                shoe: shoe.clone(),
            },
            Phase::Dealing { round, reveal, .. } => {
                // A peeked sliver is the squeezer's private glimpse. Everyone
                // else — another seat, or a spectator — sees that card still
                // face down until it is revealed; otherwise every client at the
                // table receives the identity the squeeze is supposed to keep in
                // one player's hands. (holder == None only carries peeks on a
                // solo table, where the sole viewer made them.)
                let hidden = |holder: Option<PlayerId>| match (viewer_id, holder) {
                    (None, _) => true,
                    (Some(v), Some(h)) => h != v,
                    (Some(_), None) => false,
                };
                let redact = |statuses: &[CardStatus], holder: Option<PlayerId>| {
                    statuses
                        .iter()
                        .map(|s| match s {
                            CardStatus::Peeked if hidden(holder) => CardStatus::FaceDown,
                            s => *s,
                        })
                        .collect::<Vec<_>>()
                };
                TableView {
                    phase: PhaseTag::Dealing,
                    player: hand_view(&round.player, &redact(&reveal.player, player_squeezer)),
                    banker: hand_view(&round.banker, &redact(&reveal.banker, banker_squeezer)),
                    bets,
                    bankroll,
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
                    shoe,
                }
            }
        }
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
    use crate::round::Outcome;
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

    /// A table with one seat, cut and ready for betting — the shared setup
    /// every dealing test starts from.
    pub(crate) fn open_table(seed: u64) -> (Table, PlayerId) {
        let mut t = Table::new(
            TableConfig {
                table_min: 100,
                table_max: 1_000_000,
                ruleset: Ruleset::Commission,
                max_seats: 7,
            },
            seed,
        );
        let host = t.join("host", 100_000).unwrap();
        t.cut_shoe(host, 500).unwrap();
        (t, host)
    }

    #[test]
    fn tied_stakes_give_the_squeeze_to_the_first_seated() {
        // The doc contract is "ties: first seated". a joins before b and they
        // stake the Player side identically, so a must hold the squeeze.
        let mut t = table();
        let a = t.join("a", 100_000).unwrap();
        t.cut_shoe(a, 500).unwrap();
        let b = t.join("b", 100_000).unwrap();
        t.place_bet(a, BetKind::Main(BetSpot::Player), 5_000).unwrap();
        t.place_bet(b, BetKind::Main(BetSpot::Player), 5_000).unwrap();
        t.ready(a).unwrap();
        t.ready(b).unwrap();
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
        t.cut_shoe(a, 500).unwrap();
        let b = t.join("b", 100_000).unwrap();
        t.place_bet(a, BetKind::Main(BetSpot::Player), 5_000).unwrap();
        t.place_bet(b, BetKind::Main(BetSpot::Banker), 5_000).unwrap();
        t.ready(a).unwrap();
        t.ready(b).unwrap();
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
        t.cut_shoe(a, 500).unwrap();
        t.place_bet(a, BetKind::Main(BetSpot::Player), 5_000).unwrap();
        t.ready(a).unwrap();
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
    fn a_seat_can_be_renamed_mid_deal_and_everyone_sees_it() {
        let mut t = table();
        let a = t.join("a", 100_000).unwrap();
        t.cut_shoe(a, 500).unwrap();
        let b = t.join("b", 100_000).unwrap();
        t.place_bet(a, BetKind::Main(BetSpot::Player), 5_000).unwrap();
        t.place_bet(b, BetKind::Main(BetSpot::Banker), 5_000).unwrap();
        t.ready(a).unwrap();
        t.ready(b).unwrap();
        t.deal().unwrap();
        // a display-only change: allowed while cards are out
        t.rename(a, "alice").unwrap();
        let vb = t.view_for(b).unwrap();
        assert_eq!(vb.seats[0].name, "alice");
        assert_eq!(vb.seats[1].name, "b");
        // squeeze rights, bets and bankroll ride along untouched
        assert_eq!(vb.player_squeezer, Some(a));
        assert_eq!(vb.seats[0].staked, 5_000);
        assert_eq!(vb.seats[0].bankroll, 100_000);
        // a seat that isn't at the table can't be renamed
        assert_eq!(t.rename(PlayerId(99), "ghost"), Err(TableError::NoSuchPlayer));
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
        t.cut_shoe(a, 500).unwrap();
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
        t.cut_shoe(rich, 500).unwrap();
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
        t.cut_shoe(a, 500).unwrap();
        let b = t.join("b", 100_000).unwrap();
        // Opposite main bets: exactly one wins (or both push on tie).
        t.place_bet(a, BetKind::Main(BetSpot::Player), 10_000).unwrap();
        t.place_bet(b, BetKind::Main(BetSpot::Banker), 10_000).unwrap();
        t.ready(a).unwrap();
        t.ready(b).unwrap();
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
        t.cut_shoe(a, 500).unwrap();
        t.place_bet(a, BetKind::Main(BetSpot::Player), 5_000).unwrap();
        t.ready(a).unwrap();
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
        t.ready(a).unwrap();
        t.deal().unwrap();
        let fresh = t.view_for(a).unwrap();
        assert_eq!(fresh.phase, PhaseTag::Dealing);
        assert!(fresh.player.cards.iter().all(|c| matches!(c, CardView::FaceDown)));
    }

    #[test]
    fn settle_aggregates_same_kind_chips_for_one_seat_on_win() {
        // Four 500 chips on Player, all won at once, must render as one
        // BetPayout for 2,000 — not four separate +500 lines.
        let mut seed = 0u64;
        loop {
            let mut t = Table::new(
                TableConfig {
                    table_min: 100,
                    table_max: 1_000_000,
                    ruleset: Ruleset::Commission,
                    max_seats: 1,
                },
                seed,
            );
            let a = t.join("a", 100_000).unwrap();
            t.cut_shoe(a, 500).unwrap();
            for _ in 0..4 {
                t.place_bet(a, BetKind::Main(BetSpot::Player), 500).unwrap();
            }
            t.ready(a).unwrap();
            t.deal().unwrap();
            t.settle().unwrap();
            let view = t.view_for(a).unwrap();
            if view.outcome == Some(Outcome::PlayerWin) {
                let payouts = view.payouts.unwrap();
                assert_eq!(payouts.len(), 1);
                assert_eq!(payouts[0].bet.kind, BetKind::Main(BetSpot::Player));
                assert_eq!(payouts[0].bet.amount, 2_000);
                assert_eq!(payouts[0].net, 2_000);
                break;
            }
            seed += 1;
            assert!(seed < 2_000, "no Player win found in seed range");
        }
    }

    #[test]
    fn settle_aggregates_same_kind_chips_for_one_seat_on_loss() {
        // Same four chips, but the coup goes the other way: one -2,000 line,
        // not four -500 lines.
        let mut seed = 0u64;
        loop {
            let mut t = Table::new(
                TableConfig {
                    table_min: 100,
                    table_max: 1_000_000,
                    ruleset: Ruleset::Commission,
                    max_seats: 1,
                },
                seed,
            );
            let a = t.join("a", 100_000).unwrap();
            t.cut_shoe(a, 500).unwrap();
            for _ in 0..4 {
                t.place_bet(a, BetKind::Main(BetSpot::Player), 500).unwrap();
            }
            t.ready(a).unwrap();
            t.deal().unwrap();
            t.settle().unwrap();
            let view = t.view_for(a).unwrap();
            if view.outcome == Some(Outcome::BankerWin) {
                let payouts = view.payouts.unwrap();
                assert_eq!(payouts.len(), 1);
                assert_eq!(payouts[0].bet.kind, BetKind::Main(BetSpot::Player));
                assert_eq!(payouts[0].bet.amount, 2_000);
                assert_eq!(payouts[0].net, -2_000);
                break;
            }
            seed += 1;
            assert!(seed < 2_000, "no Banker win found in seed range");
        }
    }

    #[test]
    fn settled_view_keeps_the_explain_trace() {
        // The 'why this round' narrative must survive into the Settled display —
        // that's the resting state where a learner studies the finished coup and
        // finally sees why one hand has three cards and the other two.
        let mut t = table();
        let a = t.join("a", 100_000).unwrap();
        t.cut_shoe(a, 500).unwrap();
        t.place_bet(a, BetKind::Main(BetSpot::Player), 5_000).unwrap();
        t.ready(a).unwrap();
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
        t.ready(a).unwrap();
        t.deal().unwrap();
    }

    #[test]
    fn views_share_cards_but_keep_money_private_to_the_viewer() {
        let mut t = table();
        let a = t.join("a", 100_000).unwrap();
        t.cut_shoe(a, 500).unwrap();
        let b = t.join("b", 50_000).unwrap();
        t.place_bet(a, BetKind::Main(BetSpot::Player), 5_000).unwrap();
        t.ready(a).unwrap();
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
        t.cut_shoe(a, 500).unwrap();
        t.place_bet(a, BetKind::Main(BetSpot::Player), 1_000).unwrap();
        t.ready(a).unwrap();
        t.deal().unwrap();
        let v = t.view_for(a).unwrap();
        for card in v.player.cards.iter().chain(v.banker.cards.iter()) {
            assert!(matches!(card, crate::session::CardView::FaceDown));
        }
        assert!(v.player.total.is_none());
    }

    #[test]
    fn every_seat_view_and_the_public_view_exposes_each_seats_bets() {
        let mut t = table();
        let a = t.join("a", 100_000).unwrap();
        t.cut_shoe(a, 500).unwrap();
        let b = t.join("b", 100_000).unwrap();
        t.place_bet(a, BetKind::Main(BetSpot::Player), 1_000).unwrap();
        t.place_bet(b, BetKind::Main(BetSpot::Banker), 2_000).unwrap();
        t.place_bet(b, BetKind::Main(BetSpot::Tie), 500).unwrap();

        for view in [t.view_for(a).unwrap(), t.view_for(b).unwrap(), t.view_public()] {
            assert_eq!(view.seats[0].bets, vec![PlacedBet {
                kind: BetKind::Main(BetSpot::Player),
                amount: 1_000,
            }]);
            assert_eq!(view.seats[1].bets, vec![
                PlacedBet { kind: BetKind::Main(BetSpot::Banker), amount: 2_000 },
                PlacedBet { kind: BetKind::Main(BetSpot::Tie), amount: 500 },
            ]);
            // bets always sum to the existing staked total — nothing new leaks
            assert_eq!(
                view.seats[1].staked,
                view.seats[1].bets.iter().map(|b| b.amount).sum::<i64>()
            );
        }
    }

    #[test]
    fn a_spectator_sees_the_felt_but_no_money_and_no_face_down_card() {
        let mut t = table();
        let a = t.join("a", 100_000).unwrap();
        t.cut_shoe(a, 500).unwrap();
        let b = t.join("b", 100_000).unwrap();
        t.place_bet(a, BetKind::Main(BetSpot::Player), 1_000).unwrap();
        t.place_bet(b, BetKind::Main(BetSpot::Banker), 2_000).unwrap();
        t.ready(a).unwrap();
        t.ready(b).unwrap();
        t.deal().unwrap();
        let v = t.view_public();
        assert_eq!(v.phase, PhaseTag::Dealing);
        assert!(v.bets.is_empty(), "no chair, no chips");
        assert_eq!(v.bankroll, 0);
        assert!(v.payouts.is_none());
        for card in v.player.cards.iter().chain(v.banker.cards.iter()) {
            assert!(matches!(card, CardView::FaceDown));
        }
        // everything the seats share is there: who's seated, who holds what
        assert_eq!(v.seats.len(), 2);
        assert_eq!(v.seats[1].staked, 2_000);
        assert_eq!(v.player_squeezer, Some(a));
        assert_eq!(v.banker_squeezer, Some(b));
        assert_eq!((v.table_min, v.table_max), (100, 1_000_000));
    }

    #[test]
    fn a_spectator_never_sees_a_peeked_sliver() {
        let mut t = table();
        let a = t.join("a", 100_000).unwrap();
        t.cut_shoe(a, 500).unwrap();
        t.place_bet(a, BetKind::Main(BetSpot::Player), 1_000).unwrap();
        t.ready(a).unwrap();
        t.deal().unwrap();
        t.peek(a, Side::Player, 0).unwrap();
        assert!(matches!(t.view_for(a).unwrap().player.cards[0], CardView::Peeked { .. }));
        assert!(matches!(t.view_public().player.cards[0], CardView::FaceDown));
        t.reveal(a, Side::Player, 0).unwrap();
        assert!(matches!(t.view_public().player.cards[0], CardView::FaceUp(_)));
    }

    #[test]
    fn a_spectator_keeps_the_settled_coup_until_a_seat_opens_the_next_one() {
        let mut t = table();
        let a = t.join("a", 100_000).unwrap();
        t.cut_shoe(a, 500).unwrap();
        let b = t.join("b", 100_000).unwrap();
        t.place_bet(a, BetKind::Main(BetSpot::Player), 1_000).unwrap();
        t.sit_out(b).unwrap();
        // nothing settled yet: an empty betting felt
        let v = t.view_public();
        assert_eq!(v.phase, PhaseTag::Betting);
        assert!(v.player.cards.is_empty());
        assert!(v.outcome.is_none());

        t.ready(a).unwrap();
        t.deal().unwrap();
        t.settle().unwrap();
        let v = t.view_public();
        assert_eq!(v.phase, PhaseTag::Settled);
        assert!(v.outcome.is_some());
        assert!(v.payouts.is_none(), "no seat, no payouts");
        assert!(v.player.cards.iter().all(|c| matches!(c, CardView::FaceUp(_))));
        assert!(v.player.total.is_some());
        assert!(!v.explain.is_empty(), "the trace rides on the settled felt");

        // b opens the next coup: the spectator's felt clears...
        t.place_bet(b, BetKind::Main(BetSpot::Banker), 1_000).unwrap();
        let v = t.view_public();
        assert_eq!(v.phase, PhaseTag::Betting);
        assert!(v.player.cards.is_empty());
        assert!(v.outcome.is_none());
        assert!(v.explain.is_empty());
        // ...while a, who hasn't acted, is still looking at the result
        assert_eq!(t.view_for(a).unwrap().phase, PhaseTag::Settled);
    }

    #[test]
    fn sitting_out_opens_the_next_coup_for_the_spectator_too() {
        let mut t = table();
        let a = t.join("a", 100_000).unwrap();
        t.cut_shoe(a, 500).unwrap();
        t.place_bet(a, BetKind::Main(BetSpot::Player), 1_000).unwrap();
        t.ready(a).unwrap();
        t.deal().unwrap();
        t.settle().unwrap();
        assert_eq!(t.view_public().phase, PhaseTag::Settled);
        t.sit_out(a).unwrap();
        assert_eq!(t.view_public().phase, PhaseTag::Betting);
    }

    #[test]
    fn the_squeeze_is_communal() {
        let mut t = table();
        let a = t.join("a", 100_000).unwrap();
        t.cut_shoe(a, 500).unwrap();
        let b = t.join("b", 100_000).unwrap();
        t.place_bet(a, BetKind::Main(BetSpot::Player), 1_000).unwrap();
        t.ready(a).unwrap();
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
        t.cut_shoe(a, 500).unwrap();
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
        t.cut_shoe(_a, 500).unwrap();
        assert_eq!(t.deal(), Err(TableError::WaitingOnPlayers));
        // ...and with nobody seated (and nobody to cut) the shoe never even
        // opened for betting.
        let mut empty = table();
        assert!(matches!(
            empty.deal(),
            Err(TableError::Command(CommandError::WrongPhase {
                expected: PhaseTag::Betting,
                found: PhaseTag::ShoeCut,
            }))
        ));
    }

    #[test]
    fn a_watched_hand_deals_with_no_money_on_the_felt() {
        // Like standing at a real table without betting: the coup is dealt, the
        // house turns both hands, the result joins the roads, and the roll is
        // untouched.
        let mut t = table();
        let a = t.join("a", 100_000).unwrap();
        t.cut_shoe(a, 500).unwrap();
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
        t.ready(a).unwrap();
        t.deal().unwrap();
    }

    #[test]
    fn leaving_mid_deal_settles_the_departing_player() {
        let mut t = table();
        let a = t.join("a", 100_000).unwrap();
        t.cut_shoe(a, 500).unwrap();
        t.place_bet(a, BetKind::Main(BetSpot::Player), 10_000).unwrap();
        t.ready(a).unwrap();
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
        t.cut_shoe(a, 500).unwrap();
        let b = t.join("b", 100_000).unwrap();
        t.place_bet(a, BetKind::Main(BetSpot::Player), 1_000).unwrap();
        assert_eq!(t.deal(), Err(TableError::WaitingOnPlayers));
        t.ready(a).unwrap();
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
        t.cut_shoe(a, 500).unwrap();
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
        t.cut_shoe(a, 500).unwrap();
        let b = t.join("b", 100_000).unwrap();
        t.place_bet(a, BetKind::Main(BetSpot::Player), 5_000).unwrap();
        t.place_bet(b, BetKind::Main(BetSpot::Banker), 5_000).unwrap();
        t.ready(a).unwrap();
        t.ready(b).unwrap();
        t.deal().unwrap();
        let v = t.view_for(a).unwrap();
        assert_eq!(v.player_squeezer, Some(a));
        assert_eq!(v.banker_squeezer, Some(b));
        // b cannot touch the Player hand, a cannot touch the Banker hand
        assert!(matches!(t.peek(b, Side::Player, 0), Err(TableError::NotYourSqueeze { .. })));
        assert!(matches!(t.peek(a, Side::Banker, 0), Err(TableError::NotYourSqueeze { .. })));
        // each may peek their own, when the ritual reaches their hand
        t.peek(a, Side::Player, 0).unwrap();
        t.reveal(a, Side::Player, 0).unwrap();
        t.reveal(a, Side::Player, 1).unwrap();
        t.peek(b, Side::Banker, 0).unwrap();
    }

    #[test]
    fn a_holder_turns_their_own_cards_in_any_order() {
        let mut t = table();
        let a = t.join("a", 100_000).unwrap();
        t.cut_shoe(a, 500).unwrap();
        t.place_bet(a, BetKind::Main(BetSpot::Player), 1_000).unwrap();
        t.ready(a).unwrap();
        t.deal().unwrap();
        // right card first is fine — it's your hand
        t.reveal(a, Side::Player, 1).unwrap();
        t.reveal(a, Side::Player, 0).unwrap();
    }

    #[test]
    fn cards_are_exposed_in_ritual_order() {
        let mut t = table();
        let a = t.join("a", 100_000).unwrap();
        t.cut_shoe(a, 500).unwrap();
        let b = t.join("b", 100_000).unwrap();
        t.place_bet(a, BetKind::Main(BetSpot::Player), 1_000).unwrap();
        t.place_bet(b, BetKind::Main(BetSpot::Banker), 1_000).unwrap();
        t.ready(a).unwrap();
        t.ready(b).unwrap();
        t.deal().unwrap();
        // Banker's first card may not be revealed before the Player hand is up
        assert_eq!(t.reveal(b, Side::Banker, 0), Err(TableError::OutOfOrder));
        t.reveal(a, Side::Player, 0).unwrap();
        assert_eq!(t.reveal(b, Side::Banker, 0), Err(TableError::OutOfOrder));
        t.reveal(a, Side::Player, 1).unwrap();
        t.reveal(b, Side::Banker, 0).unwrap();
        t.reveal(b, Side::Banker, 1).unwrap();
        // (peeking ahead is held to the same order at a shared table — see
        // squeeze_gap_tests; only a solo table keeps the peek-ahead)
    }

    #[test]
    fn a_shared_table_reserves_unbet_hands_for_the_house_dealer() {
        let mut t = table();
        let a = t.join("a", 100_000).unwrap();
        t.cut_shoe(a, 500).unwrap();
        t.place_bet(a, BetKind::Main(BetSpot::Player), 1_000).unwrap();
        t.ready(a).unwrap();
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
        solo.cut_shoe(p, 500).unwrap();
        solo.place_bet(p, BetKind::Main(BetSpot::Player), 1_000).unwrap();
        solo.ready(p).unwrap();
        solo.deal().unwrap();
        solo.reveal(p, Side::Player, 0).unwrap();
        solo.reveal(p, Side::Player, 1).unwrap();
        solo.reveal(p, Side::Banker, 0).unwrap(); // house hand, solo: allowed
    }

    #[test]
    fn betting_again_after_a_settle_returns_the_view_to_betting() {
        let mut t = table();
        let a = t.join("a", 100_000).unwrap();
        t.cut_shoe(a, 500).unwrap();
        t.place_bet(a, BetKind::Main(BetSpot::Player), 1_000).unwrap();
        t.ready(a).unwrap();
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
        t.cut_shoe(a, 500).unwrap();
        let b = t.join("b", 100_000).unwrap();
        t.place_bet(a, BetKind::Main(BetSpot::Player), 5_000).unwrap();
        t.place_bet(b, BetKind::Main(BetSpot::Player), 2_000).unwrap();
        t.ready(a).unwrap();
        t.ready(b).unwrap();
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
        t.cut_shoe(a, 500).unwrap();
        t.place_bet(a, BetKind::Main(BetSpot::Player), 1_000).unwrap();
        t.ready(a).unwrap();
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
        t.cut_shoe(a, 500).unwrap();
        t.place_bet(a, BetKind::Main(BetSpot::Tie), 1_000).unwrap();
        t.ready(a).unwrap();
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
    fn rebuy_tops_up_the_roll_without_touching_the_shoe() {
        // Buying more chips must NOT reshuffle: the coups already played stay on
        // the roads and the shoe keeps its position, exactly like handing cash
        // to the dealer mid-shoe.
        let mut t = table();
        let a = t.join("a", 5_000).unwrap();
        t.cut_shoe(a, 500).unwrap();
        for _ in 0..4 {
            t.place_bet(a, BetKind::Main(BetSpot::Player), 1_000).unwrap();
            t.ready(a).unwrap();
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
        t.ready(a).unwrap();
        t.deal().unwrap();
        t.settle().unwrap();
        assert_eq!(t.view_for(a).unwrap().scoreboard.bead_plate.cells.len(), beads + 1);
    }

    #[test]
    fn rebuy_is_refused_mid_deal() {
        let mut t = table();
        let a = t.join("a", 5_000).unwrap();
        t.cut_shoe(a, 500).unwrap();
        t.place_bet(a, BetKind::Main(BetSpot::Player), 1_000).unwrap();
        t.ready(a).unwrap();
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
            t.cut_shoe(a, 500).unwrap();
            // play until the shoe reshuffles: the bead plate keeps growing, so
            // detect the reshuffle by watching for the coup that follows it
            let mut coups = 0u32;
            let mut prev_remaining = usize::MAX;
            loop {
                t.place_bet(a, BetKind::Main(BetSpot::Player), 100).unwrap();
                t.ready(a).unwrap();
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
                t.cut_shoe(p, 500).unwrap();
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
                    t.ready(p).unwrap();
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
        t.cut_shoe(a, 500).unwrap();
        for expected in 1..=6 {
            t.place_bet(a, BetKind::Main(BetSpot::Player), 1_000).unwrap();
            t.ready(a).unwrap();
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
mod ready_tests {
    //! Everyone must ready up before the coup deals — a bet alone no longer
    //! marks a seat decided.
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
    fn ready_requires_a_bet() {
        let mut t = table();
        let a = t.join("a", 100_000).unwrap();
        t.cut_shoe(a, 500).unwrap();
        assert!(matches!(
            t.ready(a),
            Err(TableError::Command(CommandError::NoBetsPlaced))
        ));
        t.place_bet(a, BetKind::Main(BetSpot::Player), 1_000).unwrap();
        t.ready(a).unwrap();
        assert!(t.view_for(a).unwrap().seats[0].ready);
    }

    #[test]
    fn a_bet_after_ready_unreadies_the_seat() {
        let mut t = table();
        let a = t.join("a", 100_000).unwrap();
        t.cut_shoe(a, 500).unwrap();
        t.place_bet(a, BetKind::Main(BetSpot::Player), 1_000).unwrap();
        t.ready(a).unwrap();
        assert!(t.view_for(a).unwrap().seats[0].ready);
        t.place_bet(a, BetKind::Main(BetSpot::Banker), 500).unwrap();
        assert!(!t.view_for(a).unwrap().seats[0].ready, "a changed mind un-readies");
    }

    #[test]
    fn clearing_bets_also_unreadies_the_seat() {
        let mut t = table();
        let a = t.join("a", 100_000).unwrap();
        t.cut_shoe(a, 500).unwrap();
        t.place_bet(a, BetKind::Main(BetSpot::Player), 1_000).unwrap();
        t.ready(a).unwrap();
        t.clear_bets(a).unwrap();
        assert!(!t.view_for(a).unwrap().seats[0].ready);
    }

    #[test]
    fn deal_waits_on_a_betted_but_unready_seat_and_proceeds_once_ready() {
        let mut t = table();
        let a = t.join("a", 100_000).unwrap();
        t.cut_shoe(a, 500).unwrap();
        let b = t.join("b", 100_000).unwrap();
        t.place_bet(a, BetKind::Main(BetSpot::Player), 1_000).unwrap();
        t.place_bet(b, BetKind::Main(BetSpot::Banker), 1_000).unwrap();
        // both bet, neither has readied — the deal must wait
        assert_eq!(t.deal(), Err(TableError::WaitingOnPlayers));
        assert!(!t.all_ready());
        t.ready(a).unwrap();
        assert_eq!(t.deal(), Err(TableError::WaitingOnPlayers), "b still hasn't readied");
        assert!(!t.all_ready());
        t.ready(b).unwrap();
        assert!(t.all_ready());
        t.deal().unwrap();
    }

    #[test]
    fn sitting_out_seats_never_block_ready_up() {
        let mut t = table();
        let a = t.join("a", 100_000).unwrap();
        t.cut_shoe(a, 500).unwrap();
        let b = t.join("b", 100_000).unwrap();
        t.place_bet(a, BetKind::Main(BetSpot::Player), 1_000).unwrap();
        t.sit_out(b).unwrap();
        assert_eq!(t.deal(), Err(TableError::WaitingOnPlayers), "a hasn't readied yet");
        t.ready(a).unwrap();
        assert!(t.all_ready());
        t.deal().unwrap();
    }

    #[test]
    fn broke_seats_never_block_ready_up() {
        let mut t = Table::new(
            TableConfig { table_min: 100, table_max: 10_000, ruleset: Ruleset::Commission, max_seats: 7 },
            7,
        );
        let a = t.join("a", 5_000).unwrap();
        t.cut_shoe(a, 500).unwrap();
        let broke = t.join("broke", 50).unwrap(); // below the table minimum
        t.place_bet(a, BetKind::Main(BetSpot::Banker), 100).unwrap();
        assert_eq!(t.deal(), Err(TableError::WaitingOnPlayers), "a hasn't readied yet");
        t.ready(a).unwrap();
        assert!(t.all_ready(), "the broke seat never blocks readiness");
        let _ = broke;
        t.deal().unwrap();
    }

    #[test]
    fn settle_resets_ready_for_the_next_coup() {
        let mut t = table();
        let a = t.join("a", 100_000).unwrap();
        t.cut_shoe(a, 500).unwrap();
        t.place_bet(a, BetKind::Main(BetSpot::Player), 1_000).unwrap();
        t.ready(a).unwrap();
        t.deal().unwrap();
        t.settle().unwrap();
        assert!(!t.view_for(a).unwrap().seats[0].ready, "a fresh coup starts unready");
        assert!(!t.all_ready(), "an empty felt isn't all-ready");
    }

    #[test]
    fn unready_flips_the_seat_back_and_a_later_deal_is_refused() {
        let mut t = table();
        let a = t.join("a", 100_000).unwrap();
        t.cut_shoe(a, 500).unwrap();
        t.place_bet(a, BetKind::Main(BetSpot::Player), 1_000).unwrap();
        t.ready(a).unwrap();
        assert!(t.all_ready());
        t.unready(a).unwrap();
        assert!(t.view_for(a).unwrap().seats[0].ready == false);
        assert!(!t.all_ready());
        assert_eq!(t.deal(), Err(TableError::WaitingOnPlayers));
    }

    #[test]
    fn ready_and_unready_are_refused_outside_betting() {
        let mut t = table();
        let a = t.join("a", 100_000).unwrap();
        t.cut_shoe(a, 500).unwrap();
        t.place_bet(a, BetKind::Main(BetSpot::Player), 1_000).unwrap();
        t.ready(a).unwrap();
        t.deal().unwrap();
        assert!(matches!(
            t.ready(a),
            Err(TableError::Command(CommandError::WrongPhase { .. }))
        ));
        assert!(matches!(
            t.unready(a),
            Err(TableError::Command(CommandError::WrongPhase { .. }))
        ));
    }

    #[test]
    fn all_ready_is_false_with_no_seats() {
        let t = table();
        assert!(!t.all_ready());
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
        t.cut_shoe(rich, 500).unwrap();
        let broke = t.join("broke", 50).unwrap(); // below the 100 minimum

        t.place_bet(rich, BetKind::Main(BetSpot::Banker), 100).unwrap();
        t.ready(rich).unwrap();
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
        t.cut_shoe(a, 500).unwrap();
        let b = t.join("b", 100).unwrap(); // exactly the minimum — still playable

        t.place_bet(a, BetKind::Main(BetSpot::Banker), 100).unwrap();
        assert!(
            matches!(t.deal(), Err(TableError::WaitingOnPlayers)),
            "a player who can still bet must not be dealt past"
        );

        t.place_bet(b, BetKind::Main(BetSpot::Player), 100).unwrap();
        t.ready(a).unwrap();
        t.ready(b).unwrap();
        t.deal().expect("both decided now");
    }

    #[test]
    fn going_broke_mid_session_unblocks_the_next_coup() {
        // The realistic path: a player busts on a hand, then can't act.
        let mut t = table();
        let a = t.join("a", 5_000).unwrap();
        t.cut_shoe(a, 500).unwrap();
        let b = t.join("b", 150).unwrap();
        t.place_bet(a, BetKind::Main(BetSpot::Banker), 100).unwrap();
        t.place_bet(b, BetKind::Main(BetSpot::Player), 100).unwrap();
        t.ready(a).unwrap();
        t.ready(b).unwrap();
        t.deal().unwrap();
        t.settle().unwrap();

        // Whatever the result, drain b below the minimum and confirm the table
        // still moves without them.
        while t.view_for(a).unwrap().seats.iter().find(|s| s.id == b).unwrap().bankroll >= 100 {
            let left = t.view_for(a).unwrap().seats.iter().find(|s| s.id == b).unwrap().bankroll;
            t.place_bet(b, BetKind::Main(BetSpot::Tie), left.min(10_000)).unwrap();
            t.place_bet(a, BetKind::Main(BetSpot::Banker), 100).unwrap();
            t.ready(a).unwrap();
            t.ready(b).unwrap();
            t.deal().unwrap();
            t.settle().unwrap();
        }

        t.place_bet(a, BetKind::Main(BetSpot::Banker), 100).unwrap();
        t.ready(a).unwrap();
        t.deal().expect("the busted seat must not hold the table hostage");
    }
}

#[cfg(test)]
mod dealer_flip_tests {
    //! The high-limit courtesy: the player squeezing their hand may ask the
    //! dealer to turn one or both of the house-held hand's cards early.
    use super::*;
    use crate::session::CardView;
    use crate::settle::BetSpot;

    fn table_seeded(seed: u64) -> Table {
        Table::new(
            TableConfig {
                table_min: 100,
                table_max: 1_000_000,
                ruleset: Ruleset::Commission,
                max_seats: 7,
            },
            seed,
        )
    }

    fn up(v: &TableView, side: Side, i: usize) -> bool {
        let cards = match side {
            Side::Player => &v.player.cards,
            Side::Banker => &v.banker.cards,
        };
        matches!(cards[i], CardView::FaceUp(_))
    }

    /// One seat, betting Player: the Player hand is theirs, the Banker hand
    /// is the dealer's.
    fn player_squeezer_dealt(seed: u64) -> (Table, PlayerId) {
        let mut t = table_seeded(seed);
        let a = t.join("a", 100_000).unwrap();
        t.cut_shoe(a, 500).unwrap();
        t.place_bet(a, BetKind::Main(BetSpot::Player), 5_000).unwrap();
        t.ready(a).unwrap();
        t.deal().unwrap();
        (t, a)
    }

    #[test]
    fn flip_one_turns_the_first_dealer_card_then_the_other() {
        let (mut t, a) = player_squeezer_dealt(42);
        t.request_dealer_flip(a, FlipRequest::One).unwrap();
        let v = t.view_for(a).unwrap();
        assert!(up(&v, Side::Banker, 0));
        assert!(!up(&v, Side::Banker, 1));
        // the squeezer's own cards are untouched
        assert!(!up(&v, Side::Player, 0) && !up(&v, Side::Player, 1));

        t.request_dealer_flip(a, FlipRequest::One).unwrap();
        let v = t.view_for(a).unwrap();
        assert!(up(&v, Side::Banker, 0) && up(&v, Side::Banker, 1));

        // both up: nothing left to ask for
        assert_eq!(t.request_dealer_flip(a, FlipRequest::One), Err(TableError::NothingToTurn));
        assert_eq!(t.request_dealer_flip(a, FlipRequest::Both), Err(TableError::NothingToTurn));
    }

    #[test]
    fn flip_both_turns_both_dealer_cards_at_once() {
        let (mut t, a) = player_squeezer_dealt(42);
        // the table reports which hand it turned, so the dealer can say so
        assert_eq!(t.request_dealer_flip(a, FlipRequest::Both), Ok(Side::Banker));
        let v = t.view_for(a).unwrap();
        assert!(up(&v, Side::Banker, 0) && up(&v, Side::Banker, 1));
        assert!(!up(&v, Side::Player, 0) && !up(&v, Side::Player, 1));
    }

    #[test]
    fn flip_both_after_flip_one_turns_the_remaining_card() {
        let (mut t, a) = player_squeezer_dealt(42);
        t.request_dealer_flip(a, FlipRequest::One).unwrap();
        t.request_dealer_flip(a, FlipRequest::Both).unwrap();
        let v = t.view_for(a).unwrap();
        assert!(up(&v, Side::Banker, 0) && up(&v, Side::Banker, 1));
    }

    #[test]
    fn no_request_before_the_deal() {
        let mut t = table_seeded(42);
        let a = t.join("a", 100_000).unwrap();
        t.cut_shoe(a, 500).unwrap();
        t.place_bet(a, BetKind::Main(BetSpot::Player), 5_000).unwrap();
        assert!(matches!(
            t.request_dealer_flip(a, FlipRequest::One),
            Err(TableError::Command(CommandError::WrongPhase { .. }))
        ));
    }

    #[test]
    fn only_the_seat_holding_a_squeeze_may_ask() {
        // b sits out: holds nothing, so has no standing to ask the dealer.
        let mut t = table_seeded(42);
        let a = t.join("a", 100_000).unwrap();
        t.cut_shoe(a, 500).unwrap();
        let b = t.join("b", 100_000).unwrap();
        t.place_bet(a, BetKind::Main(BetSpot::Player), 5_000).unwrap();
        t.ready(a).unwrap();
        t.sit_out(b).unwrap();
        t.deal().unwrap();
        assert_eq!(t.request_dealer_flip(b, FlipRequest::One), Err(TableError::NothingToTurn));
        // the holder's own request still stands
        t.request_dealer_flip(a, FlipRequest::One).unwrap();
    }

    #[test]
    fn cannot_ask_for_a_hand_another_player_holds() {
        // b holds the Banker squeeze — a asks the dealer, not another player.
        let mut t = table_seeded(42);
        let a = t.join("a", 100_000).unwrap();
        t.cut_shoe(a, 500).unwrap();
        let b = t.join("b", 100_000).unwrap();
        t.place_bet(a, BetKind::Main(BetSpot::Player), 5_000).unwrap();
        t.place_bet(b, BetKind::Main(BetSpot::Banker), 5_000).unwrap();
        t.ready(a).unwrap();
        t.ready(b).unwrap();
        t.deal().unwrap();
        assert_eq!(
            t.request_dealer_flip(a, FlipRequest::One),
            Err(TableError::NotYourSqueeze { side: Side::Banker, house: false })
        );
        assert_eq!(
            t.request_dealer_flip(b, FlipRequest::One),
            Err(TableError::NotYourSqueeze { side: Side::Player, house: false })
        );
    }

    #[test]
    fn holding_both_hands_leaves_nothing_for_the_dealer() {
        let mut t = table_seeded(42);
        let a = t.join("a", 100_000).unwrap();
        t.cut_shoe(a, 500).unwrap();
        t.place_bet(a, BetKind::Main(BetSpot::Player), 5_000).unwrap();
        t.place_bet(a, BetKind::Main(BetSpot::Banker), 5_000).unwrap();
        t.ready(a).unwrap();
        t.deal().unwrap();
        assert_eq!(t.request_dealer_flip(a, FlipRequest::One), Err(TableError::NothingToTurn));
    }

    #[test]
    fn no_request_once_your_own_hand_is_fully_up() {
        // With the Player hand exposed the dealer turns Banker as a matter of
        // course — the request is moot and must not race the pacer.
        let (mut t, a) = player_squeezer_dealt(42);
        t.reveal(a, Side::Player, 0).unwrap();
        // one card still down: the ask is still open
        t.request_dealer_flip(a, FlipRequest::One).unwrap();
        t.reveal(a, Side::Player, 1).unwrap();
        assert!(t.dealer_flip_pending());
        assert_eq!(t.request_dealer_flip(a, FlipRequest::One), Err(TableError::NothingToTurn));
    }

    #[test]
    fn a_banker_squeezer_has_nothing_to_ask_the_dealer_is_already_turning_player() {
        // Ritual order puts the Player hand first, so when the house holds it
        // the pacer is already turning those cards — nothing to hurry along.
        let mut t = table_seeded(42);
        let a = t.join("a", 100_000).unwrap();
        t.cut_shoe(a, 500).unwrap();
        t.place_bet(a, BetKind::Main(BetSpot::Banker), 5_000).unwrap();
        t.ready(a).unwrap();
        t.deal().unwrap();
        assert!(t.dealer_flip_pending());
        assert_eq!(t.request_dealer_flip(a, FlipRequest::One), Err(TableError::NothingToTurn));
    }

    #[test]
    fn the_request_does_not_start_the_dealer_on_anything_else() {
        // After the courtesy flip the dealer waits again: the squeezer's own
        // cards are still theirs to turn, and any third card keeps ritual order.
        let (mut t, a) = player_squeezer_dealt(42);
        t.request_dealer_flip(a, FlipRequest::Both).unwrap();
        assert!(!t.dealer_flip_pending());
        t.reveal(a, Side::Player, 0).unwrap();
        t.reveal(a, Side::Player, 1).unwrap();
        let v = t.view_for(a).unwrap();
        if v.player.cards.len() == 3 {
            // the Player third is the squeezer's; the dealer still waits
            assert!(!t.dealer_flip_pending());
            t.reveal(a, Side::Player, 2).unwrap();
        }
        // whatever the house still holds (a Banker third) is his to turn now
        assert_eq!(t.dealer_flip_pending(), t.view_for(a).unwrap().banker.cards.len() == 3);
    }

    #[test]
    fn a_dealer_third_card_is_dealt_normally_after_the_request() {
        // Find a coup where the Banker draws, ask for both, then walk the
        // ritual: the third card is exposed by the pacer in its usual turn.
        for seed in 1..200u64 {
            let (mut t, a) = player_squeezer_dealt(seed);
            if t.view_for(a).unwrap().banker.cards.len() != 3 {
                continue;
            }
            t.request_dealer_flip(a, FlipRequest::Both).unwrap();
            let v = t.view_for(a).unwrap();
            assert!(!up(&v, Side::Banker, 2), "third card stays down");
            t.reveal(a, Side::Player, 0).unwrap();
            t.reveal(a, Side::Player, 1).unwrap();
            if t.view_for(a).unwrap().player.cards.len() == 3 {
                t.reveal(a, Side::Player, 2).unwrap();
            }
            assert_eq!(t.dealer_next_side(), Some(Side::Banker));
            assert!(t.dealer_flip_one());
            assert!(up(&t.view_for(a).unwrap(), Side::Banker, 2));
            assert!(!t.dealer_flip_pending());
            return;
        }
        panic!("no seed in range produced a Banker third card");
    }

    #[test]
    fn the_request_changes_nothing_about_the_outcome_or_payout() {
        // Same seed, same bet: one table asks, the other doesn't. The coup
        // resolves identically — the request is about reveal order only.
        let (mut asked, a1) = player_squeezer_dealt(7);
        let (mut plain, a2) = player_squeezer_dealt(7);
        asked.request_dealer_flip(a1, FlipRequest::Both).unwrap();
        asked.settle().unwrap();
        plain.settle().unwrap();
        let va = asked.view_for(a1).unwrap();
        let vp = plain.view_for(a2).unwrap();
        assert_eq!(va.outcome, vp.outcome);
        assert_eq!(va.bankroll, vp.bankroll);
        assert_eq!(va.payouts, vp.payouts);
    }
}

#[cfg(test)]
mod squeeze_gap_tests {
    //! Multiplayer squeeze gaps: a holder who drops or stalls hands their
    //! squeeze to the house, peeks follow the ritual at a shared table, and a
    //! refusal says whether the dealer or another seat holds the hand.
    use super::*;
    use crate::settle::BetSpot;

    fn shared() -> Table {
        Table::new(
            TableConfig { table_min: 100, table_max: 1_000_000, ruleset: Ruleset::Commission, max_seats: 7 },
            11,
        )
    }

    fn solo() -> Table {
        Table::new(
            TableConfig { table_min: 100, table_max: 1_000_000, ruleset: Ruleset::Commission, max_seats: 1 },
            11,
        )
    }

    /// a squeezes Player, b squeezes Banker.
    fn two_squeezers() -> (Table, PlayerId, PlayerId) {
        let mut t = shared();
        let a = t.join("a", 100_000).unwrap();
        t.cut_shoe(a, 500).unwrap();
        let b = t.join("b", 100_000).unwrap();
        t.place_bet(a, BetKind::Main(BetSpot::Player), 5_000).unwrap();
        t.place_bet(b, BetKind::Main(BetSpot::Banker), 5_000).unwrap();
        t.ready(a).unwrap();
        t.ready(b).unwrap();
        t.deal().unwrap();
        (t, a, b)
    }

    // --- surrender_squeeze: the house takes over without touching the seat ---

    #[test]
    fn surrendering_hands_the_squeeze_to_the_house_and_keeps_the_seat_and_bets() {
        let (mut t, a, b) = two_squeezers();
        let before = t.view_for(a).unwrap();
        assert_eq!(t.surrender_squeeze(a), vec![Side::Player]);
        let v = t.view_for(a).unwrap();
        assert_eq!(v.player_squeezer, None, "the house holds Player now");
        assert_eq!(v.banker_squeezer, Some(b), "b's squeeze is untouched");
        assert_eq!(v.bets, before.bets, "bets ride");
        assert_eq!(v.bankroll, before.bankroll);
        assert_eq!(t.seats(), 2, "still seated");
        // the dealer now turns the Player hand
        assert_eq!(t.dealer_next_side(), Some(Side::Player));
        assert!(t.dealer_flip_one());
    }

    #[test]
    fn surrendering_is_idempotent_and_a_no_op_for_non_holders() {
        let (mut t, a, b) = two_squeezers();
        assert_eq!(t.surrender_squeeze(a), vec![Side::Player]);
        assert_eq!(t.surrender_squeeze(a), Vec::<Side>::new());
        let c = t.join("c", 100_000).unwrap();
        assert_eq!(t.surrender_squeeze(c), Vec::<Side>::new());
        assert_eq!(t.view_for(b).unwrap().banker_squeezer, Some(b));
        // outside a deal there's nothing to surrender
        let mut fresh = shared();
        let p = fresh.join("p", 100_000).unwrap();
        assert_eq!(fresh.surrender_squeeze(p), Vec::<Side>::new());
    }

    #[test]
    fn surrendering_both_hands_reports_both() {
        let mut t = shared();
        let a = t.join("a", 100_000).unwrap();
        t.cut_shoe(a, 500).unwrap();
        t.place_bet(a, BetKind::Main(BetSpot::Player), 1_000).unwrap();
        t.place_bet(a, BetKind::Main(BetSpot::Banker), 1_000).unwrap();
        t.ready(a).unwrap();
        t.deal().unwrap();
        assert_eq!(t.surrender_squeeze(a), vec![Side::Player, Side::Banker]);
    }

    #[test]
    fn surrendering_one_side_leaves_the_holders_other_hand_alone() {
        let mut t = shared();
        let a = t.join("a", 100_000).unwrap();
        t.cut_shoe(a, 500).unwrap();
        t.place_bet(a, BetKind::Main(BetSpot::Player), 1_000).unwrap();
        t.place_bet(a, BetKind::Main(BetSpot::Banker), 1_000).unwrap();
        t.ready(a).unwrap();
        t.deal().unwrap();
        assert!(t.surrender_squeeze_side(a, Side::Player));
        let v = t.view_for(a).unwrap();
        assert_eq!(v.player_squeezer, None, "the house holds Player now");
        assert_eq!(v.banker_squeezer, Some(a), "a still squeezes Banker");
        // again is a no-op; a side a doesn't hold is a no-op; a stranger is a no-op
        assert!(!t.surrender_squeeze_side(a, Side::Player));
        let c = t.join("c", 100_000).unwrap();
        assert!(!t.surrender_squeeze_side(c, Side::Banker));
        assert_eq!(t.view_for(a).unwrap().banker_squeezer, Some(a));
    }

    // --- stalled_squeeze: which human holder is the table waiting on ---

    #[test]
    fn the_table_waits_on_the_holder_of_the_next_card_in_ritual_order() {
        let (mut t, a, b) = two_squeezers();
        assert_eq!(t.stalled_squeeze(), Some((a, Side::Player)));
        t.reveal(a, Side::Player, 0).unwrap();
        t.reveal(a, Side::Player, 1).unwrap();
        assert_eq!(t.stalled_squeeze(), Some((b, Side::Banker)));
        t.reveal(b, Side::Banker, 0).unwrap();
        t.reveal(b, Side::Banker, 1).unwrap();
        // thirds (if any) follow the same rule; a finished coup waits on nobody
        while let Some((pid, side)) = t.stalled_squeeze() {
            t.reveal(pid, side, 2).unwrap();
        }
        assert!(t.stalled_squeeze().is_none());
    }

    #[test]
    fn the_house_turning_its_own_hand_stalls_nobody() {
        let mut t = shared();
        let b = t.join("b", 100_000).unwrap();
        t.cut_shoe(b, 500).unwrap();
        t.place_bet(b, BetKind::Main(BetSpot::Banker), 1_000).unwrap();
        t.ready(b).unwrap();
        t.deal().unwrap();
        // Player hand is the house's and comes first: the pacer is at work
        assert!(t.stalled_squeeze().is_none());
        while t.dealer_flip_one() {}
        assert_eq!(t.stalled_squeeze(), Some((b, Side::Banker)));
    }

    #[test]
    fn names_are_available_for_the_dealer_to_speak() {
        let (t, a, _) = two_squeezers();
        assert_eq!(t.name_of(a), Some("a"));
        assert_eq!(t.name_of(PlayerId(99)), None);
    }

    // --- peek follows the ritual at a shared table ---

    #[test]
    fn at_a_shared_table_a_peek_ahead_of_the_ritual_is_refused() {
        let (mut t, a, b) = two_squeezers();
        assert_eq!(t.peek(b, Side::Banker, 0), Err(TableError::OutOfOrder));
        t.peek(a, Side::Player, 0).unwrap();
        t.reveal(a, Side::Player, 0).unwrap();
        assert_eq!(t.peek(b, Side::Banker, 0), Err(TableError::OutOfOrder));
        t.reveal(a, Side::Player, 1).unwrap();
        t.peek(b, Side::Banker, 0).unwrap();
        t.peek(b, Side::Banker, 1).unwrap();
    }

    #[test]
    fn a_peek_says_whether_it_lifted_anything() {
        // The server winds its squeeze clock on a peek; one that changes
        // nothing must not count as activity, or a holder could keep the
        // whole table waiting by re-sending the same peek forever.
        let (mut t, a, _b) = two_squeezers();
        assert_eq!(t.peek(a, Side::Player, 0), Ok(true), "first lift");
        assert_eq!(t.peek(a, Side::Player, 0), Ok(false), "already peeked");
        assert_eq!(t.peek(a, Side::Player, 1), Ok(true), "the other card");
        t.reveal(a, Side::Player, 0).unwrap();
        assert_eq!(t.peek(a, Side::Player, 0), Ok(false), "a face-up card can't be peeked");
    }

    #[test]
    fn solo_keeps_its_peek_ahead() {
        // The solo client lets you fiddle your Banker card while the dealer
        // turns the Player hand ("peeking is fine, no dealer scolding").
        let mut t = solo();
        let p = t.join("me", 100_000).unwrap();
        t.cut_shoe(p, 500).unwrap();
        t.place_bet(p, BetKind::Main(BetSpot::Banker), 1_000).unwrap();
        t.ready(p).unwrap();
        t.deal().unwrap();
        t.peek(p, Side::Banker, 0).unwrap();
        assert_eq!(t.reveal(p, Side::Banker, 0), Err(TableError::OutOfOrder));
    }

    // --- the refusal says who holds the hand ---

    #[test]
    fn a_refusal_distinguishes_the_dealer_from_another_seat() {
        let (mut t, a, b) = two_squeezers();
        assert_eq!(
            t.peek(a, Side::Banker, 0),
            Err(TableError::NotYourSqueeze { side: Side::Banker, house: false })
        );
        assert_eq!(
            t.peek(b, Side::Player, 0),
            Err(TableError::NotYourSqueeze { side: Side::Player, house: false })
        );
        let mut t = shared();
        let a = t.join("a", 100_000).unwrap();
        t.cut_shoe(a, 500).unwrap();
        t.place_bet(a, BetKind::Main(BetSpot::Player), 1_000).unwrap();
        t.ready(a).unwrap();
        t.deal().unwrap();
        assert_eq!(
            t.reveal(a, Side::Banker, 0),
            Err(TableError::NotYourSqueeze { side: Side::Banker, house: true })
        );
    }
}

#[cfg(test)]
mod shoe_lifecycle_tests {
    //! ShoeCut phase, the host's cut, and the realistic cut-card end.
    use super::tests::open_table;
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

    /// Play one full coup for `pid` (bet Player, ready, deal, reveal
    /// everything it can, let the dealer flip the rest) and settle it.
    fn play_one_hand(t: &mut Table, pid: PlayerId) {
        t.place_bet(pid, BetKind::Main(BetSpot::Player), 100).unwrap();
        t.ready(pid).unwrap();
        t.deal().unwrap();
        for _ in 0..12 {
            let v = t.view_for(pid).unwrap();
            for i in 0..v.player.cards.len() {
                let _ = t.reveal(pid, Side::Player, i);
            }
            while t.dealer_flip_pending() {
                t.dealer_flip_one();
            }
        }
        t.settle().unwrap();
    }

    /// Play coups until the cut card is flagged (but the shoe hasn't ended
    /// yet — one more hand is still owed).
    fn play_until_cut_card_out(t: &mut Table, pid: PlayerId) {
        loop {
            play_one_hand(t, pid);
            if t.view_for(pid).unwrap().shoe.cut_card_out {
                break;
            }
        }
    }

    #[test]
    fn a_new_table_starts_in_shoe_cut_with_no_cutter() {
        let t = table();
        assert_eq!(t.host(), None);
        assert_eq!(t.shoe_number(), 0);
        let v = t.view_public();
        assert_eq!(v.phase, PhaseTag::ShoeCut);
        assert_eq!(v.shoe.cutter, None);
        assert_eq!(v.shoe.cut_reason, Some(ShoeCutReason::NewTable));
        assert_eq!(v.shoe.number, 0);
    }

    #[test]
    fn first_join_becomes_host_and_cutter() {
        let mut t = table();
        let a = t.join("a", 100_000).unwrap();
        assert_eq!(t.host(), Some(a));
        assert_eq!(t.view_for(a).unwrap().shoe.cutter, Some(a));
        // a second seat does not take over the cut
        let b = t.join("b", 100_000).unwrap();
        assert_eq!(t.host(), Some(a));
        assert_eq!(t.view_for(b).unwrap().shoe.cutter, Some(a));
        assert!(t.view_for(a).unwrap().seats[0].host);
        assert!(!t.view_for(b).unwrap().seats[1].host);
    }

    #[test]
    fn only_the_host_may_cut() {
        let mut t = table();
        let a = t.join("a", 100_000).unwrap();
        let b = t.join("b", 100_000).unwrap();
        assert_eq!(t.cut_shoe(b, 500), Err(TableError::NotYourCut));
        t.cut_shoe(a, 500).unwrap();
        assert_eq!(t.view_for(a).unwrap().phase, PhaseTag::Betting);
    }

    #[test]
    fn cut_moves_to_betting_and_numbers_the_shoe() {
        let mut t = table();
        let a = t.join("a", 100_000).unwrap();
        assert_eq!(t.view_for(a).unwrap().phase, PhaseTag::ShoeCut);
        t.cut_shoe(a, 500).unwrap();
        let v = t.view_for(a).unwrap();
        assert_eq!(v.phase, PhaseTag::Betting);
        assert_eq!(v.shoe.number, 1);
        assert!(v.shoe.last_cut.is_some());
        assert_eq!(t.shoe_number(), 1);
    }

    #[test]
    fn betting_is_refused_in_shoe_cut() {
        let mut t = table();
        let a = t.join("a", 100_000).unwrap();
        assert_eq!(
            t.place_bet(a, BetKind::Main(BetSpot::Player), 1_000),
            Err(TableError::Command(CommandError::WrongPhase {
                expected: PhaseTag::Betting,
                found: PhaseTag::ShoeCut,
            }))
        );
        assert_eq!(
            t.deal(),
            Err(TableError::Command(CommandError::WrongPhase {
                expected: PhaseTag::Betting,
                found: PhaseTag::ShoeCut,
            }))
        );
        assert!(!t.all_ready());
        // rename/rebuy/join/leave (and the cut itself) are still allowed
        t.rename(a, "alice").unwrap();
        t.rebuy(a, 1_000).unwrap();
    }

    #[test]
    fn host_leaving_hands_the_cut_to_the_next_seat() {
        let mut t = table();
        let a = t.join("a", 100_000).unwrap();
        let b = t.join("b", 100_000).unwrap();
        assert_eq!(t.host(), Some(a));
        t.leave(a).unwrap();
        assert_eq!(t.host(), Some(b));
        assert_eq!(t.view_for(b).unwrap().shoe.cutter, Some(b));
        assert!(t.view_for(b).unwrap().seats[0].host);
        // the new host can cut
        t.cut_shoe(b, 500).unwrap();
        assert_eq!(t.shoe_number(), 1);
    }

    #[test]
    fn leaving_never_changes_the_shoe() {
        let (mut t, a) = open_table(5);
        let b = t.join("b", 100_000).unwrap();
        for _ in 0..3 {
            // sitting_out resets every coup — b sits out fresh each round
            t.sit_out(b).unwrap();
            play_one_hand(&mut t, a);
        }
        let shoe_number_before = t.shoe_number();
        let history_len_before = t.view_for(a).unwrap().scoreboard.bead_plate.cells.len();
        t.leave(b).unwrap();
        assert_eq!(t.shoe_number(), shoe_number_before);
        assert_eq!(t.view_for(a).unwrap().scoreboard.bead_plate.cells.len(), history_len_before);
        assert_ne!(t.view_for(a).unwrap().phase, PhaseTag::ShoeCut, "leaving never touches the phase");
    }

    #[test]
    fn cut_card_out_allows_exactly_one_more_hand() {
        let (mut t, a) = open_table(3);
        play_until_cut_card_out(&mut t, a);
        // the shoe hasn't ended yet — the felt is still open (Settled here is
        // the just-finished coup's display; the underlying phase is Betting).
        assert_ne!(t.view_for(a).unwrap().phase, PhaseTag::ShoeCut, "one more hand still owed");

        // exactly one more hand deals and settles normally...
        play_one_hand(&mut t, a);

        // ...and only now does the shoe end.
        let v = t.view_for(a).unwrap();
        assert_eq!(v.phase, PhaseTag::ShoeCut);
        assert_eq!(v.shoe.cut_reason, Some(ShoeCutReason::CutCardOut));
        assert_eq!(v.shoe.cutter, t.host());
        assert!(matches!(
            t.deal(),
            Err(TableError::Command(CommandError::WrongPhase {
                expected: PhaseTag::Betting,
                found: PhaseTag::ShoeCut,
            }))
        ));
    }

    #[test]
    fn cut_after_shoe_end_clears_the_roads() {
        let (mut t, a) = open_table(3);
        play_until_cut_card_out(&mut t, a);
        play_one_hand(&mut t, a); // the one more hand — the shoe now ends

        let before = t.view_for(a).unwrap();
        assert_eq!(before.phase, PhaseTag::ShoeCut);
        assert!(!before.scoreboard.big_road.columns.is_empty(), "roads stay up until the cut");
        let bankroll_before = before.bankroll;

        t.cut_shoe(a, 500).unwrap();
        let after = t.view_for(a).unwrap();
        assert!(after.scoreboard.big_road.columns.is_empty(), "the cut wipes the roads");
        assert_eq!(after.shoe.number, 2);
        assert_eq!(after.bankroll, bankroll_before, "bankroll survives the cut");
    }

    #[test]
    fn the_shoe_never_reshuffles_silently() {
        let (mut t, a) = open_table(11);
        let mut cuts = 1u32; // open_table already made the first cut
        for _ in 0..200 {
            if t.view_for(a).unwrap().phase == PhaseTag::ShoeCut {
                t.cut_shoe(a, 500).unwrap();
                cuts += 1;
            }
            let before = t.shoe_number();
            play_one_hand(&mut t, a);
            // the shoe number moves ONLY at a cut, never across a deal/settle
            assert_eq!(t.shoe_number(), before);
        }
        assert_eq!(t.shoe_number(), cuts);
    }
}

#[cfg(test)]
mod vote_tests {
    //! The New Shoe majority vote: propose, vote, expire, and the effect of
    //! a pass on the table.
    use super::tests::open_table;
    use super::*;
    use crate::settle::BetSpot;

    #[test]
    fn proposer_counts_as_yes_and_a_lone_seat_passes_immediately() {
        let (mut t, host) = open_table(1);
        t.propose_new_shoe(host).unwrap();
        assert!(!t.vote_open());
        let v = t.view_for(host).unwrap();
        assert_eq!(v.phase, PhaseTag::ShoeCut);
        assert_eq!(v.shoe.cut_reason, Some(ShoeCutReason::Vote));
    }

    #[test]
    fn majority_of_three_passes_on_the_second_yes() {
        let (mut t, a) = open_table(1);
        let b = t.join("b", 100_000).unwrap();
        t.join("c", 100_000).unwrap();
        t.propose_new_shoe(a).unwrap();
        // 1 yes of 3 seats: 1*2 == 2, not > 3 — still open.
        assert!(t.vote_open());
        t.vote_new_shoe(b, true).unwrap();
        // 2 yes of 3 seats: 2*2 == 4 > 3 — passes.
        assert!(!t.vote_open());
        assert_eq!(t.view_for(a).unwrap().phase, PhaseTag::ShoeCut);
    }

    #[test]
    fn two_nos_of_three_fail() {
        let (mut t, a) = open_table(1);
        let b = t.join("b", 100_000).unwrap();
        let c = t.join("c", 100_000).unwrap();
        t.propose_new_shoe(a).unwrap();
        t.vote_new_shoe(b, false).unwrap();
        // 1 no of 3 seats: 1*2 == 2, not >= 3 — still open.
        assert!(t.vote_open());
        t.vote_new_shoe(c, false).unwrap();
        // 2 no of 3 seats: 2*2 == 4 >= 3 — fails.
        assert!(!t.vote_open());
        assert_eq!(t.view_for(a).unwrap().phase, PhaseTag::Betting);
    }

    #[test]
    fn expire_fails_an_open_vote() {
        let (mut t, a) = open_table(1);
        t.join("b", 100_000).unwrap();
        t.propose_new_shoe(a).unwrap();
        assert!(t.vote_open());
        t.vote_expire();
        assert!(!t.vote_open());
        assert_eq!(t.view_for(a).unwrap().phase, PhaseTag::Betting);
        // a no-op without an open vote
        t.vote_expire();
        assert!(!t.vote_open());
    }

    #[test]
    fn a_vote_needs_betting_phase() {
        let mut t = Table::new(
            TableConfig { table_min: 100, table_max: 1_000_000, ruleset: Ruleset::Commission, max_seats: 7 },
            1,
        );
        let a = t.join("a", 100_000).unwrap();
        assert!(matches!(
            t.propose_new_shoe(a),
            Err(TableError::Command(CommandError::WrongPhase {
                expected: PhaseTag::Betting,
                found: PhaseTag::ShoeCut
            }))
        ));
        t.cut_shoe(a, 500).unwrap();
        t.place_bet(a, BetKind::Main(BetSpot::Player), 100).unwrap();
        t.ready(a).unwrap();
        t.deal().unwrap();
        assert!(matches!(
            t.propose_new_shoe(a),
            Err(TableError::Command(CommandError::WrongPhase {
                expected: PhaseTag::Betting,
                found: PhaseTag::Dealing
            }))
        ));
    }

    #[test]
    fn voter_leaving_recounts() {
        let (mut t, a) = open_table(1);
        let b = t.join("b", 100_000).unwrap();
        let c = t.join("c", 100_000).unwrap();
        t.propose_new_shoe(a).unwrap();
        assert!(t.vote_open());
        t.leave(b).unwrap();
        // 1 yes of 2 seats: 1*2 == 2, not > 2 — not yet a majority.
        assert!(t.vote_open(), "1 yes of 2 seats is not yet a majority");
        t.vote_new_shoe(c, true).unwrap();
        // 2 yes of 2 seats: 2*2 == 4 > 2 — passes.
        assert!(!t.vote_open());
        assert_eq!(t.view_for(a).unwrap().phase, PhaseTag::ShoeCut);
    }

    #[test]
    fn pass_returns_staged_bets_and_moves_to_shoe_cut() {
        let (mut t, a) = open_table(1);
        let b = t.join("b", 100_000).unwrap();
        t.place_bet(a, BetKind::Main(BetSpot::Player), 5_000).unwrap();
        let bankroll_before = t.view_for(a).unwrap().bankroll;
        t.propose_new_shoe(a).unwrap();
        // 1 yes of 2 seats — not yet a majority.
        assert!(t.vote_open());
        t.vote_new_shoe(b, true).unwrap();
        assert!(!t.vote_open());
        let v = t.view_for(a).unwrap();
        assert_eq!(v.phase, PhaseTag::ShoeCut);
        assert_eq!(v.bankroll, bankroll_before, "bets are staged only — bankroll is untouched");
        assert!(v.bets.is_empty(), "staged bets are cleared, not settled");
        assert_eq!(v.shoe.cut_reason, Some(ShoeCutReason::Vote));
        assert_eq!(v.shoe.cutter, Some(a), "the host holds the cut");
    }

    #[test]
    fn changing_a_vote_is_allowed_until_resolved() {
        let (mut t, a) = open_table(1);
        let b = t.join("b", 100_000).unwrap();
        t.join("c", 100_000).unwrap();
        t.join("d", 100_000).unwrap();
        t.propose_new_shoe(a).unwrap();
        t.vote_new_shoe(b, true).unwrap();
        // 2 yes of 4 seats: 2*2 == 4, not > 4 — still open.
        assert!(t.vote_open());
        let v = t.view_for(a).unwrap().shoe.vote.clone().unwrap();
        assert_eq!(v.yes, vec![a, b]);
        assert!(v.no.is_empty());

        // b changes their mind to no.
        t.vote_new_shoe(b, false).unwrap();
        assert!(t.vote_open());
        let v = t.view_for(a).unwrap().shoe.vote.clone().unwrap();
        assert_eq!(v.yes, vec![a]);
        assert_eq!(v.no, vec![b]);

        // and back to yes again.
        t.vote_new_shoe(b, true).unwrap();
        assert!(t.vote_open());
        let v = t.view_for(a).unwrap().shoe.vote.clone().unwrap();
        assert_eq!(v.yes, vec![a, b]);
        assert!(v.no.is_empty());
    }

    #[test]
    fn second_proposal_while_open_is_refused() {
        let (mut t, a) = open_table(1);
        let b = t.join("b", 100_000).unwrap();
        t.propose_new_shoe(a).unwrap();
        assert!(t.vote_open());
        assert_eq!(t.propose_new_shoe(b), Err(TableError::VoteOpen));
    }
}
