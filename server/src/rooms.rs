//! Rooms: each holds one multiplayer `Table` plus the channels to every
//! seated connection. All game state is guarded by the room's own lock;
//! after any accepted command, every seat gets a fresh view pushed.

use crate::protocol::{RoomInfo, ServerMsg, Tier};
use baccarat_engine::settle::Ruleset;
use baccarat_engine::table::{PlayerId, Table, TableConfig, TableError};
use rand::Rng;
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::{mpsc, Mutex};

pub const MAX_SEATS: usize = 7;

/// The house dealer's rhythm: one card flip per beat.
pub const DEALER_FLIP_MS: u64 = 1100;

pub struct Room {
    pub id: String,
    pub tier: Tier,
    pub private: bool,
    pub table: Table,
    /// Outbound channel per seated player.
    pub conns: HashMap<PlayerId, mpsc::UnboundedSender<ServerMsg>>,
    /// A dealer-flip pacer task is already running for this room.
    pub pacing: bool,
}

impl Room {
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
        }
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
                let _ = tx.send(ServerMsg::State { view });
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

    pub async fn create(&self, tier: Tier, private: bool) -> Arc<Mutex<Room>> {
        let mut rooms = self.rooms.lock().await;
        let id = loop {
            let id = Self::new_room_id();
            if !rooms.contains_key(&id) {
                break id;
            }
        };
        let room = Arc::new(Mutex::new(Room::new(id.clone(), tier, private)));
        rooms.insert(id, room.clone());
        room
    }

    pub async fn get(&self, id: &str) -> Option<Arc<Mutex<Room>>> {
        self.rooms.lock().await.get(&id.to_uppercase()).cloned()
    }

    /// Public rooms only — private tables are join-by-code.
    pub async fn list_public(&self) -> Vec<RoomInfo> {
        let rooms = self.rooms.lock().await;
        let mut infos = Vec::new();
        for room in rooms.values() {
            let room = room.lock().await;
            if !room.private {
                infos.push(room.info());
            }
        }
        infos.sort_by(|a, b| a.id.cmp(&b.id));
        infos
    }

    /// Drop rooms nobody is connected to anymore.
    pub async fn sweep(&self) {
        let mut rooms = self.rooms.lock().await;
        let mut dead = Vec::new();
        for (id, room) in rooms.iter() {
            if room.lock().await.conns.is_empty() {
                dead.push(id.clone());
            }
        }
        for id in dead {
            rooms.remove(&id);
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
        loop {
            tokio::time::sleep(std::time::Duration::from_millis(DEALER_FLIP_MS)).await;
            let mut guard = room.lock().await;
            if guard.table.dealer_flip_one() {
                guard.broadcast();
            }
            if !guard.table.dealer_flip_pending() {
                guard.pacing = false;
                return;
            }
        }
    });
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
            format!("The {side:?} cards are in another player's hands.")
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
        let room = registry.create(Tier::Mid, false).await;
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
        let _pub = registry.create(Tier::Low, false).await;
        let priv_room = registry.create(Tier::High, true).await;
        let listed = registry.list_public().await;
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].tier, Tier::Low);
        // but the private room is reachable by its code
        let code = priv_room.lock().await.id.clone();
        assert!(registry.get(&code).await.is_some());
        assert!(registry.get(&code.to_lowercase()).await.is_some()); // case-insensitive
    }

    #[tokio::test]
    async fn sweeping_removes_empty_rooms() {
        let registry = Registry::new();
        let room = registry.create(Tier::Mid, false).await;
        let id = room.lock().await.id.clone();
        registry.sweep().await;
        assert!(registry.get(&id).await.is_none());
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
