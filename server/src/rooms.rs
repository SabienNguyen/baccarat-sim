//! Rooms: each holds one multiplayer `Table` plus the channels to every
//! seated connection. All game state is guarded by the room's own lock;
//! after any accepted command, every seat gets a fresh view pushed.

use crate::protocol::{RoomInfo, ServerMsg, Tier};
use baccarat_engine::settle::Ruleset;
use baccarat_engine::table::{PlayerId, Table, TableConfig, TableError};
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
    pub fn hold_seat(&mut self, pid: PlayerId) {
        self.conns.remove(&pid);
        self.held.insert(pid, std::time::Instant::now());
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
            let mut room = room.lock().await;
            let reapable = room.seated_once || room.created.elapsed() > SEAT_GRACE;
            // A held seat is still a seat: run the clock before judging emptiness.
            room.expire_held();
            if room.is_vacant() && reapable {
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

/// Human dealer speech for refusals, mirrored from the web's narrateError.
pub fn error_message(err: &TableError) -> String {
    use baccarat_engine::session::CommandError as E;
    match err {
        TableError::TableFull => "Table's full, friend — try another.".into(),
        TableError::NoSuchPlayer => "You're not seated at this table.".into(),
        TableError::WaitingOnPlayers => {
            "Waiting on the table — everyone bets or sits out first.".into()
        }
        TableError::NotYourSqueeze { side } => {
            format!("The {side:?} hand's cards are in another player's hands.")
        }
        TableError::OutOfOrder => "Order, order — Player hand first, then Banker.".into(),
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
