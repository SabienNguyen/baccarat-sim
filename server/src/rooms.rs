//! Rooms: each holds one multiplayer `Table` plus the channels to every
//! seated connection. All game state is guarded by the room's own lock;
//! after any accepted command, every seat gets a fresh view pushed.

use crate::protocol::{RoomInfo, ServerMsg, Tier};
use baccarat_engine::settle::Ruleset;
use baccarat_engine::table::{FlipRequest, PlayerId, Table, TableConfig, TableError};
use futures_util::FutureExt;
use rand::Rng;
use std::collections::HashMap;
use std::panic::AssertUnwindSafe;
use std::sync::Arc;
use tokio::sync::{mpsc, Mutex};

pub const MAX_SEATS: usize = 7;

/// The house dealer's rhythm: one card flip per beat.
pub const DEALER_FLIP_MS: u64 = 1100;

/// The casino floor only has so much room.
pub const MAX_ROOMS: usize = 200;

/// How long a freshly created room may sit un-seated before the sweep may
/// reap it. Long enough to cover the create→seat handoff; short enough that a
/// creator who drops before seating can't strand an empty room for long.
const SEAT_GRACE: std::time::Duration = std::time::Duration::from_secs(30);

/// Outbound queue depth per connection. Bounded so a client that stops
/// reading can't grow its queue without limit; overflow drops the message
/// (every `State` push is a full snapshot, so a later one supersedes it) and
/// a genuinely dead client is reaped by the idle timeout.
pub const OUT_QUEUE: usize = 256;

/// How long a dropped player keeps their seat and bankroll. Long enough to
/// survive a tunnel, a backgrounded phone, or a Wi-Fi handover; short enough
/// that an abandoned seat doesn't hold a chair at a busy table forever.
pub const HOLD: std::time::Duration = std::time::Duration::from_secs(120);

/// How long a dropped squeezer's cards wait for them. The seat and its bets
/// are held for the full HOLD, but the whole table is waiting on those cards,
/// so after this the house dealer turns them for this coup only.
pub const SQUEEZE_GRACE: std::time::Duration = std::time::Duration::from_millis(SQUEEZE_GRACE_MS);
pub const SQUEEZE_GRACE_MS: u64 = 8_000;

/// How long a connected squeezer may sit on face-down cards before the
/// dealer turns them. Measured from the last accepted command that moved the
/// coup along (deal, peek, reveal, dealer flip); each one starts it over.
pub const SQUEEZE_CLOCK: std::time::Duration = std::time::Duration::from_millis(SQUEEZE_CLOCK_MS);
pub const SQUEEZE_CLOCK_MS: u64 = 45_000;

/// What the dealer calls a seat whose name he can't find (it left mid-line).
const NAMELESS: &str = "A player";

/// A squeeze the house just took over, and the dealer's line about it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Taken {
    pub pid: PlayerId,
    pub side: baccarat_engine::scoreboard::Side,
    pub line: String,
}

pub struct Room {
    pub id: String,
    pub tier: Tier,
    pub private: bool,
    pub table: Table,
    /// Outbound channel per seated player.
    pub conns: HashMap<PlayerId, mpsc::Sender<ServerMsg>>,
    /// A dealer-flip pacer task is already running for this room.
    pub pacing: bool,
    /// When the room was created — gates the sweep during the create→seat gap.
    created: std::time::Instant,
    /// True once anyone has ever been seated; an empty room is only reaped
    /// after it has held a player (or aged out un-seated, see SEAT_GRACE).
    seated_once: bool,
    /// Reconnect token -> the seat it can reclaim. A token is a bearer
    /// credential for someone's money, so it is only ever sent to the player it
    /// belongs to, and it is dropped the moment the seat is given up.
    tokens: HashMap<String, PlayerId>,
    /// Seats whose socket dropped, and when. They keep their bankroll and their
    /// place at the table until HOLD elapses; the sweep evicts them after that.
    held: HashMap<PlayerId, std::time::Instant>,
    /// Generation of the squeeze clock. Each arming bumps it; a clock task
    /// that wakes to find a newer generation is stale and stands down.
    squeeze_gen: u64,
}

impl Room {
    /// The dealer speaks to the whole table.
    pub fn announce(&self, message: String) {
        for tx in self.conns.values() {
            let _ = tx.try_send(ServerMsg::Announce { message: message.clone() });
        }
    }

    /// Tell every seat the room is closing (e.g. the process is shutting
    /// down), so clients see a reason instead of a bare socket reset.
    pub fn close_all(&self, reason: &str) {
        for tx in self.conns.values() {
            let _ = tx.try_send(ServerMsg::Closed { reason: reason.to_string() });
        }
    }

    pub fn new(id: String, tier: Tier, private: bool) -> Self {
        let (table_min, table_max, _) = tier.stakes();
        let seed: u64 = rand::thread_rng().gen(); // OS-entropy seeded shoe chain
        Room {
            id,
            tier,
            private,
            table: Table::new(
                TableConfig { table_min, table_max, ruleset: Ruleset::Commission, max_seats: MAX_SEATS },
                seed,
            ),
            conns: HashMap::new(),
            pacing: false,
            created: std::time::Instant::now(),
            tokens: HashMap::new(),
            held: HashMap::new(),
            seated_once: false,
            squeeze_gen: 0,
        }
    }

    /// Seat a connection. Marks the room as having been occupied, so a later
    /// sweep may reap it once it empties — but never before its first seat
    /// (which would strand a room a client created but hasn't sat down at yet).
    pub fn seat(&mut self, pid: PlayerId, tx: mpsc::Sender<ServerMsg>) {
        self.conns.insert(pid, tx);
        self.seated_once = true;
        self.held.remove(&pid);
    }

    /// Mint the credential that lets this seat be reclaimed after a drop.
    pub fn issue_token(&mut self, pid: PlayerId) -> String {
        let token: String = {
            use rand::Rng;
            let mut rng = rand::thread_rng();
            (0..32)
                .map(|_| {
                    const CHARS: &[u8] = b"abcdefghijklmnopqrstuvwxyz0123456789";
                    CHARS[rng.gen_range(0..CHARS.len())] as char
                })
                .collect()
        };
        self.tokens.insert(token.clone(), pid);
        token
    }

    /// The socket went away. Keep the seat and the money; start the clock.
    /// This is deliberately *not* `table.leave` — that forfeited a disconnected
    /// player's bankroll, and let a busted one rejoin for a free rebuy.
    ///
    /// Returns the instant of this drop; `squeeze_grace_expired` uses it to
    /// tell this drop's grace timer from one belonging to an earlier drop.
    pub fn hold_seat(&mut self, pid: PlayerId) -> std::time::Instant {
        self.conns.remove(&pid);
        let since = std::time::Instant::now();
        self.held.insert(pid, since);
        since
    }

    /// Squeezers of the current coup whose socket is already gone, with the
    /// instant of their drop — each listed once. A drop during Betting arms
    /// a grace that finds nothing to surrender; the deal that follows must
    /// arm a fresh one for these, or the table waits the full SQUEEZE_CLOCK
    /// on a dead socket.
    pub fn held_squeezers(&self) -> Vec<(PlayerId, std::time::Instant)> {
        use baccarat_engine::scoreboard::Side;
        let mut out: Vec<(PlayerId, std::time::Instant)> = Vec::new();
        for side in [Side::Player, Side::Banker] {
            let Some(pid) = self.table.squeezer(side) else { continue };
            if out.iter().any(|(p, _)| *p == pid) {
                continue;
            }
            if let Some(since) = self.held.get(&pid) {
                out.push((pid, *since));
            }
        }
        out
    }

    /// The squeeze grace ran out. If the seat is still held from THAT drop
    /// (not back, not re-dropped later), the house takes its squeeze(s) for
    /// this coup. Idempotent: a second call finds nothing left to surrender.
    ///
    /// Nothing is announced here: the caller must `broadcast()` the new view
    /// FIRST and only then `announce` each returned line (the client clears
    /// its announcement on every State, so a line sent before the view is
    /// wiped the instant it lands).
    pub fn squeeze_grace_expired(&mut self, pid: PlayerId, since: std::time::Instant) -> Vec<Taken> {
        if self.held.get(&pid) != Some(&since) {
            return Vec::new();
        }
        self.surrender_to_the_house(pid, "stepped away")
    }

    /// The squeeze clock ran out. Whoever the table is waiting on — the human
    /// holder of the next face-down card in ritual order — loses that hand
    /// to the dealer for this coup. A hand the house is already turning, or
    /// a finished coup, stalls nobody and nothing changes. Same announce
    /// contract as `squeeze_grace_expired`: broadcast, then speak.
    pub fn squeeze_clock_expired(&mut self) -> Vec<Taken> {
        let Some((pid, side)) = self.table.stalled_squeeze() else {
            return Vec::new();
        };
        // Only the hand the table is waiting on: a holder of both who stalls
        // on Player is still connected and can turn Banker when its turn comes.
        if !self.table.surrender_squeeze_side(pid, side) {
            return Vec::new();
        }
        vec![self.taken(pid, side, "is taking too long")]
    }

    /// Hand every squeeze a seat holds to the dealer. For a dead socket:
    /// nothing that seat holds can be turned by anyone else.
    fn surrender_to_the_house(&mut self, pid: PlayerId, why: &str) -> Vec<Taken> {
        self.table
            .surrender_squeeze(pid)
            .into_iter()
            .map(|side| self.taken(pid, side, why))
            .collect()
    }

    /// "{name} {why} — the dealer turns the X hand."
    fn taken(&self, pid: PlayerId, side: baccarat_engine::scoreboard::Side, why: &str) -> Taken {
        let name = self.table.name_of(pid).unwrap_or(NAMELESS);
        Taken { pid, side, line: format!("{name} {why} — the dealer turns the {side:?} hand.") }
    }

    /// Push everyone the new view, THEN say what the dealer just did about
    /// it. Order matters — see `squeeze_grace_expired`.
    pub fn broadcast_then_announce(&mut self, taken: &[Taken]) {
        self.broadcast();
        for t in taken {
            self.announce(t.line.clone());
        }
    }

    /// Which arming of the squeeze clock is current. Bumps on every arming;
    /// a wake that sees a newer generation stands down.
    pub fn squeeze_generation(&self) -> u64 {
        self.squeeze_gen
    }

    /// Trade a token back for its seat, if that seat is still being held.
    /// Fails closed: an unknown token, or one whose seat has already been
    /// evicted or is still actively connected, reclaims nothing.
    pub fn reclaim(&mut self, token: &str) -> Option<PlayerId> {
        let pid = *self.tokens.get(token)?;
        if !self.held.contains_key(&pid) {
            return None;
        }
        self.held.remove(&pid);
        Some(pid)
    }

    /// Give up a seat for good — a deliberate leave, or a hold that ran out.
    pub fn release(&mut self, pid: PlayerId) {
        self.conns.remove(&pid);
        self.held.remove(&pid);
        self.tokens.retain(|_, v| *v != pid);
        let _ = self.table.leave(pid);
    }

    /// Evict seats whose hold expired. Returns true if any seat was freed.
    pub fn expire_held(&mut self) -> bool {
        let now = std::time::Instant::now();
        let gone: Vec<PlayerId> = self
            .held
            .iter()
            .filter(|(_, since)| now.duration_since(**since) >= HOLD)
            .map(|(pid, _)| *pid)
            .collect();
        for pid in &gone {
            self.release(*pid);
        }
        !gone.is_empty()
    }

    /// A room is only idle when nobody is connected *and* nobody is being held.
    pub fn is_vacant(&self) -> bool {
        self.conns.is_empty() && self.held.is_empty()
    }

    pub fn info(&self) -> RoomInfo {
        RoomInfo {
            id: self.id.clone(),
            tier: self.tier,
            seats: self.table.seats(),
            max_seats: MAX_SEATS,
        }
    }

    /// Push each seated player their own fresh view.
    pub fn broadcast(&mut self) {
        let views: Vec<(PlayerId, _)> = self
            .conns
            .keys()
            .filter_map(|pid| self.table.view_for(*pid).ok().map(|v| (*pid, v)))
            .collect();
        for (pid, view) in views {
            if let Some(tx) = self.conns.get(&pid) {
                let _ = tx.try_send(ServerMsg::State { view });
            }
        }
    }
}

#[derive(Clone, Default)]
pub struct Registry {
    rooms: Arc<Mutex<HashMap<String, Arc<Mutex<Room>>>>>,
}

impl Registry {
    pub fn new() -> Self {
        Self::default()
    }

    /// Six characters, unambiguous alphabet — doubles as the invite code.
    fn new_room_id() -> String {
        const ALPHABET: &[u8] = b"ABCDEFGHJKMNPQRSTUVWXYZ23456789";
        let mut rng = rand::thread_rng();
        (0..6)
            .map(|_| ALPHABET[rng.gen_range(0..ALPHABET.len())] as char)
            .collect()
    }

    /// None when the floor is at capacity.
    pub async fn create(&self, tier: Tier, private: bool) -> Option<Arc<Mutex<Room>>> {
        let mut rooms = self.rooms.lock().await;
        if rooms.len() >= MAX_ROOMS {
            return None;
        }
        let id = loop {
            let id = Self::new_room_id();
            if !rooms.contains_key(&id) {
                break id;
            }
        };
        let room = Arc::new(Mutex::new(Room::new(id.clone(), tier, private)));
        rooms.insert(id.clone(), room.clone());
        tracing::info!(room = %id, ?tier, private, total = rooms.len(), "room created");
        Some(room)
    }

    pub async fn get(&self, id: &str) -> Option<Arc<Mutex<Room>>> {
        self.rooms.lock().await.get(&id.to_uppercase()).cloned()
    }

    /// How many rooms are on the floor right now (for /health).
    pub async fn room_count(&self) -> usize {
        self.rooms.lock().await.len()
    }

    /// Every room, public or private — for shutdown notices.
    pub async fn all_rooms(&self) -> Vec<Arc<Mutex<Room>>> {
        self.rooms.lock().await.values().cloned().collect()
    }

    /// Public rooms only — private tables are join-by-code.
    pub async fn list_public(&self) -> Vec<RoomInfo> {
        // Snapshot the Arcs and release the map lock BEFORE touching any
        // room lock: holding the registry across per-room awaits would let
        // one busy room stall every create/join/lobby-refresh floor-wide.
        let rooms: Vec<Arc<Mutex<Room>>> =
            self.rooms.lock().await.values().cloned().collect();
        let mut infos = Vec::new();
        for room in rooms {
            let room = room.lock().await;
            if !room.private {
                infos.push(room.info());
            }
        }
        // liveliest tables first: most seats taken, then stable by code
        infos.sort_by(|a, b| b.seats.cmp(&a.seats).then(a.id.cmp(&b.id)));
        infos
    }

    /// Drop rooms nobody is connected to anymore. A freshly created room is
    /// spared until its creator seats (or it ages past SEAT_GRACE), so a
    /// concurrent sweep can't strand a room during the create→seat handoff.
    pub async fn sweep(&self) {
        // Same discipline as list_public: inspect rooms without holding the
        // registry lock. Candidates are then re-verified under the map lock
        // (with try_lock — a contended room is in use, so not dead) so a join
        // that raced the inspection can't lose its room.
        let snapshot: Vec<(String, Arc<Mutex<Room>>)> = self
            .rooms
            .lock()
            .await
            .iter()
            .map(|(id, room)| (id.clone(), room.clone()))
            .collect();
        let mut candidates = Vec::new();
        for (id, room) in snapshot {
            let mut guard = room.lock().await;
            let reapable = guard.seated_once || guard.created.elapsed() > SEAT_GRACE;
            // A held seat is still a seat: run the clock before judging emptiness.
            // When one is evicted the table changed under everyone else — tell
            // them, and let the dealer pick up any squeeze the seat was holding
            // (`table.leave` handed it to the house; without a pace the cards
            // would sit face down until someone else acted).
            if guard.expire_held() {
                guard.broadcast();
                maybe_pace(room.clone());
            }
            if guard.is_vacant() && reapable {
                candidates.push(id);
            }
        }
        if candidates.is_empty() {
            return;
        }
        let mut rooms = self.rooms.lock().await;
        for id in candidates {
            let still_dead = match rooms.get(&id) {
                Some(room) => match room.try_lock() {
                    Ok(mut room) => {
                        room.expire_held();
                        room.is_vacant()
                            && (room.seated_once || room.created.elapsed() > SEAT_GRACE)
                    }
                    Err(_) => false, // contended = in use = alive
                },
                None => false,
            };
            if still_dead {
                rooms.remove(&id);
                tracing::info!(room = %id, total = rooms.len(), "room swept");
            }
        }
    }
}

/// When the table has house cards waiting, start a pacer task that flips
/// them one per beat so the whole table watches the dealer work.
pub fn maybe_pace(room: Arc<Mutex<Room>>) {
    tokio::spawn(async move {
        {
            let mut guard = room.lock().await;
            if guard.pacing || !guard.table.dealer_flip_pending() {
                return;
            }
            guard.pacing = true;
        }
        // Run the flip loop under catch_unwind and ALWAYS clear `pacing`
        // afterward. A panic in this background task would otherwise leave
        // `pacing = true` forever, and every later `maybe_pace` short-circuits
        // on that flag — silently soft-locking house-hand reveals for the rest
        // of the room's life (the same wedge the handle_command guard closes).
        let result = AssertUnwindSafe(pace_loop(&room)).catch_unwind().await;
        let mut guard = room.lock().await;
        guard.pacing = false;
        if result.is_err() {
            tracing::error!(room = %guard.id, "dealer pacer panicked — pacing reset");
        }
    });
}

/// A squeezer's socket dropped: give them SQUEEZE_GRACE to come back, then
/// have the house turn their cards for this coup. `since` is what `hold_seat`
/// returned for this drop, so a reconnect-and-redrop can't be mistaken for
/// the drop this timer belongs to. The lock is held only around the check,
/// never across the sleep — same discipline as `pace_loop`.
pub fn arm_squeeze_grace(room: Arc<Mutex<Room>>, pid: PlayerId, since: std::time::Instant) {
    tokio::spawn(async move {
        tokio::time::sleep(SQUEEZE_GRACE).await;
        let gone = {
            let mut guard = room.lock().await;
            let gone = guard.squeeze_grace_expired(pid, since);
            if !gone.is_empty() {
                guard.broadcast_then_announce(&gone);
                tracing::info!(room = %guard.id, ?gone, "squeeze grace elapsed — house takes the hand");
            }
            gone
        };
        if !gone.is_empty() {
            maybe_pace(room);
        }
    });
}

/// (Re)start the room's squeeze clock. Called after every accepted command
/// that moves the coup along; the newest arming wins, older ones stand down
/// when they wake and see a later generation. When it fires, whoever the
/// table is waiting on loses that hand to the dealer, and — if the coup is
/// still being turned — the clock is wound again for the next holder.
pub fn arm_squeeze_clock(room: Arc<Mutex<Room>>) {
    tokio::spawn(async move {
        let mine = {
            let mut guard = room.lock().await;
            guard.squeeze_gen += 1;
            guard.squeeze_gen
        };
        tokio::time::sleep(SQUEEZE_CLOCK).await;
        let (taken, still_turning) = {
            let mut guard = room.lock().await;
            if guard.squeeze_gen != mine {
                return; // a later command re-armed the clock
            }
            let taken = guard.squeeze_clock_expired();
            if !taken.is_empty() {
                guard.broadcast_then_announce(&taken);
                tracing::info!(room = %guard.id, ?taken, "squeeze clock elapsed — house takes the hand");
            }
            let still_turning =
                guard.table.dealer_flip_pending() || guard.table.stalled_squeeze().is_some();
            (taken, still_turning)
        };
        if !taken.is_empty() {
            maybe_pace(room.clone());
        }
        if still_turning {
            arm_squeeze_clock(room);
        }
    });
}

/// The flip loop itself: announce each hand once, then turn one card per beat
/// until the house has nothing left to reveal.
async fn pace_loop(room: &Arc<Mutex<Room>>) {
    let mut announced: Option<baccarat_engine::scoreboard::Side> = None;
    loop {
        // announce each hand once before its first flip
        {
            let guard = room.lock().await;
            match guard.table.dealer_next_side() {
                Some(side) if announced != Some(side) => {
                    announced = Some(side);
                    guard.announce(format!("Turning the {side:?} hand…"));
                }
                _ => {}
            }
        }
        tokio::time::sleep(std::time::Duration::from_millis(DEALER_FLIP_MS)).await;
        let mut guard = room.lock().await;
        if guard.table.dealer_flip_one() {
            guard.broadcast();
        }
        if !guard.table.dealer_flip_pending() {
            return;
        }
    }
}

/// The dealer's line when a squeezer asks for a house card early, spoken to
/// the whole table so everyone knows why that hand turned out of order.
/// `house` is the side `request_dealer_flip` reported turning.
pub fn flip_request_line(
    table: &Table,
    pid: PlayerId,
    house: baccarat_engine::scoreboard::Side,
    count: FlipRequest,
) -> String {
    let name = table.name_of(pid).unwrap_or(NAMELESS);
    match count {
        FlipRequest::One => format!("{name} asks for one — the dealer turns a {house:?} card."),
        FlipRequest::Both => format!("{name} asks for both — the dealer turns the {house:?} hand."),
    }
}

/// Human dealer speech for refusals, mirrored from the web's narrateError.
pub fn error_message(err: &TableError) -> String {
    use baccarat_engine::session::CommandError as E;
    match err {
        TableError::TableFull => "Table's full, friend — try another.".into(),
        TableError::NoSuchPlayer => "You're not seated at this table.".into(),
        TableError::WaitingOnPlayers => {
            "Waiting on the table — everyone bets or sits out first.".into()
        }
        TableError::NotYourSqueeze { side, house: true } => {
            format!("The dealer holds the {side:?} hand.")
        }
        TableError::NotYourSqueeze { side, house: false } => {
            format!("The {side:?} hand's cards are in another player's hands.")
        }
        TableError::OutOfOrder => "Order, order — Player hand first, then Banker.".into(),
        TableError::NothingToTurn => "Nothing for the dealer to turn just now.".into(),
        TableError::Command(E::BetAboveMaximum { max, .. }) => {
            format!("Too rich for this table — the max is ${}.{:02}.", max / 100, max % 100)
        }
        TableError::Command(E::BetBelowMinimum { min, .. }) => {
            format!("That's shy of the minimum — ${}.{:02} to play.", min / 100, min % 100)
        }
        TableError::Command(E::InsufficientBankroll { .. }) => {
            "Your rack can't cover that one.".into()
        }
        TableError::Command(E::NoBetsPlaced) => "Chips down first — then we deal.".into(),
        TableError::Command(E::WrongPhase { .. }) => "Not just now — let's finish this hand.".into(),
        TableError::Command(E::BadCardIndex { .. }) => "That card isn't on the felt.".into(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use baccarat_engine::session::BetKind;
    use baccarat_engine::settle::BetSpot;

    #[tokio::test]
    async fn create_join_play_settle_through_a_room() {
        let registry = Registry::new();
        let room = registry.create(Tier::Mid, false).await.unwrap();
        {
            let mut room = room.lock().await;
            let (.., buy_in) = room.tier.stakes();
            let a = room.table.join("a", buy_in).unwrap();
            let b = room.table.join("b", buy_in).unwrap();
            room.table.place_bet(a, BetKind::Main(BetSpot::Player), 2_500).unwrap();
            room.table.place_bet(b, BetKind::Main(BetSpot::Banker), 5_000).unwrap();
            room.table.deal().unwrap();
            room.table.settle().unwrap();
            let va = room.table.view_for(a).unwrap();
            assert!(va.payouts.is_some());
            assert_eq!(va.seats.len(), 2);
        }
    }

    #[tokio::test]
    async fn private_rooms_stay_out_of_the_public_list() {
        let registry = Registry::new();
        let _pub = registry.create(Tier::Low, false).await.unwrap();
        let priv_room = registry.create(Tier::High, true).await.unwrap();
        let listed = registry.list_public().await;
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].tier, Tier::Low);
        // but the private room is reachable by its code
        let code = priv_room.lock().await.id.clone();
        assert!(registry.get(&code).await.is_some());
        assert!(registry.get(&code.to_lowercase()).await.is_some()); // case-insensitive
    }

    #[tokio::test]
    async fn sweeping_removes_a_room_once_everyone_has_left() {
        let registry = Registry::new();
        let room = registry.create(Tier::Mid, false).await.unwrap();
        let id = room.lock().await.id.clone();
        // someone sits, plays, then leaves — now the room is truly dead
        {
            let mut g = room.lock().await;
            let (tx, _rx) = mpsc::channel(OUT_QUEUE);
            let pid = g.table.join("a", 1_000_000).unwrap();
            g.seat(pid, tx);
            g.conns.remove(&pid);
        }
        registry.sweep().await;
        assert!(registry.get(&id).await.is_none());
    }

    #[tokio::test]
    async fn sweep_spares_a_room_created_but_not_yet_seated() {
        // The create→seat handoff: a client holds the room's Arc but hasn't
        // sat down when another client's disconnect fires a sweep. The room
        // must survive, or the creator seats into a room the registry dropped.
        let registry = Registry::new();
        let room = registry.create(Tier::Mid, false).await.unwrap();
        let id = room.lock().await.id.clone();

        registry.sweep().await; // fires during the gap before the creator seats
        assert!(registry.get(&id).await.is_some(), "room reaped mid-seat");

        // the creator now seats — into the same room the registry still holds
        {
            let mut g = room.lock().await;
            let (tx, _rx) = mpsc::channel(OUT_QUEUE);
            let pid = g.table.join("a", 1_000_000).unwrap();
            g.seat(pid, tx);
        }
        assert!(registry.get(&id).await.is_some());
    }

    #[tokio::test]
    async fn the_floor_has_a_capacity() {
        let registry = Registry::new();
        for _ in 0..MAX_ROOMS {
            assert!(registry.create(Tier::Low, false).await.is_some());
        }
        assert!(registry.create(Tier::Low, false).await.is_none());
    }

    #[test]
    fn room_codes_are_six_unambiguous_chars() {
        for _ in 0..100 {
            let id = Registry::new_room_id();
            assert_eq!(id.len(), 6);
            assert!(id.chars().all(|c| !"01OIL".contains(c)));
        }
    }
}

#[cfg(test)]
mod reconnect_tests {
    use super::*;

    fn room_with_player() -> (Room, PlayerId) {
        let mut room = Room::new("TEST01".into(), Tier::Mid, false);
        let (.., buy_in) = room.tier.stakes();
        let pid = room.table.join("alice", buy_in).unwrap();
        let (tx, _rx) = mpsc::channel(OUT_QUEUE);
        room.seat(pid, tx);
        (room, pid)
    }

    #[test]
    fn a_dropped_socket_keeps_the_seat_and_the_money() {
        let (mut room, pid) = room_with_player();
        let before = room.table.view_for(pid).unwrap().bankroll;

        let token = room.issue_token(pid);
        room.hold_seat(pid);

        // no connection, but the seat is still at the table with its bankroll
        assert!(room.conns.is_empty());
        assert!(!room.is_vacant(), "a held seat must keep the room alive");
        assert_eq!(room.table.view_for(pid).unwrap().bankroll, before);

        let (tx, _rx) = mpsc::channel(OUT_QUEUE);
        let back = room.reclaim(&token).expect("token should reclaim the seat");
        assert_eq!(back, pid);
        room.seat(back, tx);
        assert_eq!(room.table.view_for(pid).unwrap().bankroll, before);
    }

    #[test]
    fn a_token_is_single_use_against_a_live_seat() {
        // Reclaiming only works while the seat is held. Once someone is back on
        // it, the same token must not hand a second connection the same chair.
        let (mut room, pid) = room_with_player();
        let token = room.issue_token(pid);
        room.hold_seat(pid);
        assert_eq!(room.reclaim(&token), Some(pid));
        let (tx, _rx) = mpsc::channel(OUT_QUEUE);
        room.seat(pid, tx);
        assert_eq!(room.reclaim(&token), None, "seat is live again — no takeover");
    }

    #[test]
    fn an_unknown_token_reclaims_nothing() {
        let (mut room, pid) = room_with_player();
        room.issue_token(pid);
        room.hold_seat(pid);
        assert_eq!(room.reclaim("not-a-real-token"), None);
        assert_eq!(room.reclaim(""), None);
    }

    #[test]
    fn releasing_a_seat_burns_its_tokens() {
        // A deliberate leave must not leave a credential that still works.
        let (mut room, pid) = room_with_player();
        let token = room.issue_token(pid);
        room.hold_seat(pid);
        room.release(pid);
        assert_eq!(room.reclaim(&token), None);
        assert!(room.is_vacant());
    }

    #[test]
    fn an_expired_hold_frees_the_chair() {
        let (mut room, pid) = room_with_player();
        let token = room.issue_token(pid);
        room.hold_seat(pid);

        assert!(!room.expire_held(), "still inside the hold window");
        assert!(!room.is_vacant());

        // wind the clock back past HOLD
        room.held.insert(pid, std::time::Instant::now() - HOLD - std::time::Duration::from_secs(1));
        assert!(room.expire_held(), "hold elapsed — seat should be freed");
        assert!(room.is_vacant());
        assert_eq!(room.reclaim(&token), None);
    }
}

#[cfg(test)]
mod flip_request_line_tests {
    use super::*;
    use baccarat_engine::scoreboard::Side;
    use baccarat_engine::session::BetKind;
    use baccarat_engine::settle::BetSpot;

    fn seated_player_squeezer() -> (Table, PlayerId) {
        let mut table = Table::new(
            TableConfig { table_min: 100, table_max: 1_000_000, ruleset: Ruleset::Commission, max_seats: 7 },
            3,
        );
        let pid = table.join("Sabien", 100_000).unwrap();
        table.place_bet(pid, BetKind::Main(BetSpot::Player), 5_000).unwrap();
        table.deal().unwrap();
        (table, pid)
    }

    #[test]
    fn names_the_asker_and_the_house_hand() {
        let (mut table, pid) = seated_player_squeezer();
        let house = table.request_dealer_flip(pid, FlipRequest::One).unwrap();
        assert_eq!(house, Side::Banker, "the table says which hand it turned");
        let line = flip_request_line(&table, pid, house, FlipRequest::One);
        assert_eq!(line, "Sabien asks for one — the dealer turns a Banker card.");
        let both = flip_request_line(&table, pid, house, FlipRequest::Both);
        assert_eq!(both, "Sabien asks for both — the dealer turns the Banker hand.");
    }

    #[test]
    fn a_seat_with_no_name_gets_the_same_fallback_as_a_surrender() {
        let (table, _pid) = seated_player_squeezer();
        let stranger = PlayerId(999);
        let line = flip_request_line(&table, stranger, Side::Banker, FlipRequest::One);
        assert_eq!(line, "A player asks for one — the dealer turns a Banker card.");
    }

    #[test]
    fn a_refused_request_has_dealer_speech() {
        assert!(!error_message(&TableError::NothingToTurn).is_empty());
    }
}

#[cfg(test)]
mod squeeze_gap_tests {
    //! A dropped or stalled squeezer hands the cards to the house instead of
    //! freezing the table; the sweep tells the table what changed; refusals
    //! say who really holds the hand.
    use super::*;
    use baccarat_engine::scoreboard::Side;
    use baccarat_engine::session::BetKind;
    use baccarat_engine::settle::BetSpot;
    use std::time::Duration;

    /// a squeezes Player, b squeezes Banker; both connected, cards out.
    fn dealt_room() -> (Room, PlayerId, PlayerId, mpsc::Receiver<ServerMsg>, mpsc::Receiver<ServerMsg>) {
        let mut room = Room::new("TEST02".into(), Tier::Mid, false);
        let (.., buy_in) = room.tier.stakes();
        let a = room.table.join("alice", buy_in).unwrap();
        let b = room.table.join("bob", buy_in).unwrap();
        let (ta, ra) = mpsc::channel(OUT_QUEUE);
        let (tb, rb) = mpsc::channel(OUT_QUEUE);
        room.seat(a, ta);
        room.seat(b, tb);
        room.table.place_bet(a, BetKind::Main(BetSpot::Player), 2_500).unwrap();
        room.table.place_bet(b, BetKind::Main(BetSpot::Banker), 2_500).unwrap();
        room.table.deal().unwrap();
        (room, a, b, ra, rb)
    }

    fn drain(rx: &mut mpsc::Receiver<ServerMsg>) -> Vec<ServerMsg> {
        let mut out = Vec::new();
        while let Ok(m) = rx.try_recv() {
            out.push(m);
        }
        out
    }

    fn announcements(msgs: &[ServerMsg]) -> Vec<String> {
        msgs.iter()
            .filter_map(|m| match m {
                ServerMsg::Announce { message } => Some(message.clone()),
                _ => None,
            })
            .collect()
    }

    fn states(msgs: &[ServerMsg]) -> usize {
        msgs.iter().filter(|m| matches!(m, ServerMsg::State { .. })).count()
    }

    fn sides(taken: &[Taken]) -> Vec<Side> {
        taken.iter().map(|t| t.side).collect()
    }

    fn who(taken: &[Taken]) -> Vec<(PlayerId, Side)> {
        taken.iter().map(|t| (t.pid, t.side)).collect()
    }

    // --- fix 5: the refusal names the real holder ---

    #[test]
    fn a_house_held_hand_is_the_dealers_not_another_players() {
        let house = error_message(&TableError::NotYourSqueeze { side: Side::Banker, house: true });
        assert_eq!(house, "The dealer holds the Banker hand.");
        let other = error_message(&TableError::NotYourSqueeze { side: Side::Player, house: false });
        assert_eq!(other, "The Player hand's cards are in another player's hands.");
    }

    // --- fix 1a: a dropped squeezer's grace ---

    #[test]
    fn a_squeezer_still_gone_after_the_grace_hands_the_cards_to_the_dealer() {
        let (mut room, a, b, _ra, mut rb) = dealt_room();
        let since = room.hold_seat(a);
        drain(&mut rb);
        let taken = room.squeeze_grace_expired(a, since);
        assert_eq!(sides(&taken), vec![Side::Player]);
        let v = room.table.view_for(b).unwrap();
        assert_eq!(v.player_squeezer, None);
        assert_eq!(v.banker_squeezer, Some(b));
        assert_eq!(room.table.seats(), 2, "the seat is still held, bets riding");
        assert!(room.held.contains_key(&a));
        assert!(announcements(&drain(&mut rb)).is_empty(), "nothing is said until the view is out");
        room.broadcast_then_announce(&taken);
        let said = announcements(&drain(&mut rb));
        assert_eq!(said, vec!["alice stepped away — the dealer turns the Player hand.".to_string()]);
    }

    #[test]
    fn a_deal_knows_which_squeezers_are_already_gone() {
        let mut room = Room::new("TEST04".into(), Tier::Mid, false);
        let (.., buy_in) = room.tier.stakes();
        let a = room.table.join("alice", buy_in).unwrap();
        let b = room.table.join("bob", buy_in).unwrap();
        let (ta, _ra) = mpsc::channel(OUT_QUEUE);
        let (tb, _rb) = mpsc::channel(OUT_QUEUE);
        room.seat(a, ta);
        room.seat(b, tb);
        room.table.place_bet(a, BetKind::Main(BetSpot::Player), 2_500).unwrap();
        room.table.place_bet(b, BetKind::Main(BetSpot::Banker), 2_500).unwrap();
        assert!(room.held_squeezers().is_empty(), "no coup out yet");
        let since = room.hold_seat(a);
        assert!(room.held_squeezers().is_empty(), "still no coup out");
        room.table.deal().unwrap();
        assert_eq!(room.held_squeezers(), vec![(a, since)], "alice squeezes Player from a dead socket");
        // a holder of both hands is listed once
        let mut solo = Room::new("TEST05".into(), Tier::Mid, false);
        let c = solo.table.join("carol", buy_in).unwrap();
        let (tc, _rc) = mpsc::channel(OUT_QUEUE);
        solo.seat(c, tc);
        solo.table.place_bet(c, BetKind::Main(BetSpot::Player), 2_500).unwrap();
        solo.table.place_bet(c, BetKind::Main(BetSpot::Banker), 2_500).unwrap();
        let since = solo.hold_seat(c);
        solo.table.deal().unwrap();
        assert_eq!(solo.held_squeezers(), vec![(c, since)]);
    }

    #[test]
    fn a_squeezer_back_inside_the_grace_keeps_their_cards() {
        let (mut room, a, _b, _ra, _rb) = dealt_room();
        let token = room.issue_token(a);
        let since = room.hold_seat(a);
        let back = room.reclaim(&token).unwrap();
        let (tx, _rx) = mpsc::channel(OUT_QUEUE);
        room.seat(back, tx);
        assert!(room.squeeze_grace_expired(a, since).is_empty());
        assert_eq!(room.table.view_for(a).unwrap().player_squeezer, Some(a));
    }

    #[test]
    fn a_stale_grace_from_an_earlier_drop_does_nothing() {
        // drop, come back, drop again: only the SECOND drop's grace counts
        let (mut room, a, _b, _ra, _rb) = dealt_room();
        let token = room.issue_token(a);
        let first = room.hold_seat(a);
        let back = room.reclaim(&token).unwrap();
        let (tx, _rx) = mpsc::channel(OUT_QUEUE);
        room.seat(back, tx);
        let second = room.hold_seat(a);
        assert!(room.squeeze_grace_expired(a, first).is_empty(), "stale timer");
        assert_eq!(room.table.view_for(a).unwrap().player_squeezer, Some(a));
        assert_eq!(sides(&room.squeeze_grace_expired(a, second)), vec![Side::Player]);
        // and again is a no-op
        assert!(room.squeeze_grace_expired(a, second).is_empty());
    }

    #[tokio::test(start_paused = true)]
    async fn the_grace_timer_fires_and_the_dealer_starts_turning() {
        let (room, a, b, _ra, mut rb) = dealt_room();
        let room = Arc::new(Mutex::new(room));
        let since = room.lock().await.hold_seat(a);
        drain(&mut rb);
        arm_squeeze_grace(room.clone(), a, since);
        tokio::task::yield_now().await; // let the task register its sleep
        tokio::time::advance(SQUEEZE_GRACE - Duration::from_millis(1)).await;
        tokio::task::yield_now().await;
        assert_eq!(room.lock().await.table.view_for(b).unwrap().player_squeezer, Some(a));
        tokio::time::advance(Duration::from_millis(2)).await;
        for _ in 0..8 {
            tokio::task::yield_now().await;
        }
        {
            let g = room.lock().await;
            assert_eq!(g.table.view_for(b).unwrap().player_squeezer, None);
            assert!(g.pacing, "the dealer's pacer should be at work");
        }
        let msgs = drain(&mut rb);
        assert!(states(&msgs) >= 1, "b should get a fresh view");
        assert!(announcements(&msgs).iter().any(|s| s.contains("stepped away")), "{msgs:?}");
    }

    /// Index of the first State whose view shows the house holding Player,
    /// and of the first Announce containing `phrase`. The client wipes its
    /// announcement on every State, so the line must come AFTER the view.
    fn state_then_line(msgs: &[ServerMsg], phrase: &str) -> (usize, usize) {
        let state = msgs
            .iter()
            .position(|m| matches!(m, ServerMsg::State { view } if view.player_squeezer.is_none()))
            .unwrap_or_else(|| panic!("no State with the house on Player in {msgs:?}"));
        let line = msgs
            .iter()
            .position(|m| matches!(m, ServerMsg::Announce { message } if message.contains(phrase)))
            .unwrap_or_else(|| panic!("no Announce containing {phrase:?} in {msgs:?}"));
        (state, line)
    }

    #[tokio::test(start_paused = true)]
    async fn the_grace_path_sends_the_new_view_before_the_dealers_line() {
        let (room, a, _b, _ra, mut rb) = dealt_room();
        let room = Arc::new(Mutex::new(room));
        let since = room.lock().await.hold_seat(a);
        drain(&mut rb);
        arm_squeeze_grace(room.clone(), a, since);
        tokio::task::yield_now().await;
        tokio::time::advance(SQUEEZE_GRACE + Duration::from_millis(1)).await;
        for _ in 0..8 {
            tokio::task::yield_now().await;
        }
        let msgs = drain(&mut rb);
        let (state, line) = state_then_line(&msgs, "stepped away");
        assert!(state < line, "State must precede the Announce: {msgs:?}");
    }

    #[tokio::test(start_paused = true)]
    async fn the_clock_path_sends_the_new_view_before_the_dealers_line() {
        let (room, _a, _b, mut ra, mut rb) = dealt_room();
        let room = Arc::new(Mutex::new(room));
        drain(&mut ra);
        drain(&mut rb);
        arm_squeeze_clock(room.clone());
        tokio::task::yield_now().await;
        tokio::time::advance(SQUEEZE_CLOCK + Duration::from_millis(1)).await;
        for _ in 0..8 {
            tokio::task::yield_now().await;
        }
        for mut rx in [ra, rb] {
            let msgs = drain(&mut rx);
            let (state, line) = state_then_line(&msgs, "is taking too long");
            assert!(state < line, "State must precede the Announce: {msgs:?}");
        }
    }

    // --- fix 1b: a connected squeezer who just sits there ---

    #[test]
    fn a_stalled_holder_loses_the_hand_to_the_dealer_with_a_word() {
        let (mut room, a, b, mut ra, mut rb) = dealt_room();
        drain(&mut ra);
        drain(&mut rb);
        let taken = room.squeeze_clock_expired();
        assert_eq!(who(&taken), vec![(a, Side::Player)]);
        let v = room.table.view_for(a).unwrap();
        assert_eq!(v.player_squeezer, None);
        assert_eq!(v.banker_squeezer, Some(b), "only the stalling hand moves");
        room.broadcast_then_announce(&taken);
        assert_eq!(
            announcements(&drain(&mut ra)),
            vec!["alice is taking too long — the dealer turns the Player hand.".to_string()]
        );
        assert_eq!(announcements(&drain(&mut rb)).len(), 1, "the whole table hears it");
        // the dealer now has the Player hand; nobody is stalling until it's up
        assert!(room.squeeze_clock_expired().is_empty());
        while room.table.dealer_flip_one() {}
        assert_eq!(who(&room.squeeze_clock_expired()), vec![(b, Side::Banker)]);
    }

    #[test]
    fn a_two_hand_holder_who_stalls_loses_only_the_hand_the_table_waits_on() {
        let mut room = Room::new("TEST03".into(), Tier::Mid, false);
        let (.., buy_in) = room.tier.stakes();
        let a = room.table.join("alice", buy_in).unwrap();
        let (ta, mut ra) = mpsc::channel(OUT_QUEUE);
        room.seat(a, ta);
        room.table.place_bet(a, BetKind::Main(BetSpot::Player), 2_500).unwrap();
        room.table.place_bet(a, BetKind::Main(BetSpot::Banker), 2_500).unwrap();
        room.table.deal().unwrap();
        drain(&mut ra);
        let taken = room.squeeze_clock_expired();
        assert_eq!(who(&taken), vec![(a, Side::Player)]);
        let v = room.table.view_for(a).unwrap();
        assert_eq!(v.player_squeezer, None, "Player goes to the house");
        assert_eq!(v.banker_squeezer, Some(a), "alice keeps the Banker squeeze");
        room.broadcast_then_announce(&taken);
        let said = announcements(&drain(&mut ra));
        assert_eq!(said, vec!["alice is taking too long — the dealer turns the Player hand.".to_string()]);
    }

    #[tokio::test(start_paused = true)]
    async fn the_squeeze_clock_is_rearmed_by_each_command_and_fires_once_idle() {
        let (room, a, _b, _ra, _rb) = dealt_room();
        let room = Arc::new(Mutex::new(room));
        arm_squeeze_clock(room.clone());
        tokio::task::yield_now().await;
        tokio::time::advance(SQUEEZE_CLOCK - Duration::from_secs(1)).await;
        tokio::task::yield_now().await;
        // a acts just before the clock runs out: it starts over
        room.lock().await.table.peek(a, Side::Player, 0).unwrap();
        arm_squeeze_clock(room.clone());
        tokio::task::yield_now().await;
        tokio::time::advance(Duration::from_secs(2)).await;
        for _ in 0..4 {
            tokio::task::yield_now().await;
        }
        assert_eq!(room.lock().await.table.view_for(a).unwrap().player_squeezer, Some(a), "stale clock must not fire");
        tokio::time::advance(SQUEEZE_CLOCK).await;
        for _ in 0..8 {
            tokio::task::yield_now().await;
        }
        let g = room.lock().await;
        assert_eq!(g.table.view_for(a).unwrap().player_squeezer, None);
        assert!(g.pacing);
    }

    // --- fix 2: the sweep tells the table and re-paces ---

    #[tokio::test]
    async fn sweep_broadcasts_and_repaces_when_a_hold_expires_mid_deal() {
        let registry = Registry::new();
        let room = registry.create(Tier::Mid, false).await.unwrap();
        let (a, b, mut rb) = {
            let mut g = room.lock().await;
            let (.., buy_in) = g.tier.stakes();
            let a = g.table.join("alice", buy_in).unwrap();
            let b = g.table.join("bob", buy_in).unwrap();
            let (ta, _ra) = mpsc::channel(OUT_QUEUE);
            let (tb, rb) = mpsc::channel(OUT_QUEUE);
            g.seat(a, ta);
            g.seat(b, tb);
            g.table.place_bet(a, BetKind::Main(BetSpot::Player), 2_500).unwrap();
            g.table.place_bet(b, BetKind::Main(BetSpot::Banker), 2_500).unwrap();
            g.table.deal().unwrap();
            g.hold_seat(a);
            g.held.insert(a, std::time::Instant::now() - HOLD - Duration::from_secs(1));
            (a, b, rb)
        };
        drain(&mut rb);
        registry.sweep().await;
        for _ in 0..8 {
            tokio::task::yield_now().await;
        }
        let g = room.lock().await;
        assert_eq!(g.table.seats(), 1, "alice's expired hold was released");
        assert!(g.table.view_for(b).is_ok());
        assert!(g.table.name_of(a).is_none());
        assert!(g.pacing, "the dealer must pick up alice's hand");
        assert!(states(&drain(&mut rb)) >= 1, "bob must see the seat go");
    }
}
