//! The wire protocol: JSON over WebSocket, reusing the engine's serializable
//! types so the web client's generated typings keep working.

use baccarat_engine::scoreboard::Side;
use baccarat_engine::session::BetKind;
use baccarat_engine::table::{PlayerId, TableView};
use serde::{Deserialize, Serialize};

/// Stake tiers, mirrored from the web client's tables.ts.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Tier {
    Low,
    Mid,
    High,
}

impl Tier {
    /// (table_min, table_max, buy_in) in cents.
    pub fn stakes(self) -> (i64, i64, i64) {
        match self {
            Tier::Low => (100, 50_000, 50_000),
            Tier::Mid => (2_500, 500_000, 1_000_000),
            Tier::High => (50_000, 10_000_000, 25_000_000),
        }
    }
}

#[derive(Debug, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ClientMsg {
    ListRooms,
    CreateRoom { name: String, tier: Tier, private: bool },
    JoinRoom { room: String, name: String },
    Leave,
    Bet { kind: BetKind, amount: i64 },
    SitOut,
    ClearBets,
    Deal,
    Peek { hand: Side, index: usize },
    Reveal { hand: Side, index: usize },
    Settle,
    NewShoe,
}

#[derive(Debug, Clone, Serialize)]
pub struct RoomInfo {
    pub id: String,
    pub tier: Tier,
    pub seats: usize,
    pub max_seats: usize,
}

#[derive(Debug, Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ServerMsg {
    Rooms { rooms: Vec<RoomInfo> },
    Joined { room: String, player: PlayerId, tier: Tier, view: TableView },
    State { view: TableView },
    Left,
    Error { message: String },
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn client_messages_parse_from_json() {
        let m: ClientMsg = serde_json::from_str(
            r#"{"type":"create_room","name":"sab","tier":"mid","private":true}"#,
        )
        .unwrap();
        assert!(matches!(m, ClientMsg::CreateRoom { tier: Tier::Mid, private: true, .. }));

        let m: ClientMsg =
            serde_json::from_str(r#"{"type":"bet","kind":{"Main":"Player"},"amount":2500}"#)
                .unwrap();
        assert!(matches!(m, ClientMsg::Bet { amount: 2500, .. }));

        let m: ClientMsg =
            serde_json::from_str(r#"{"type":"peek","hand":"Banker","index":1}"#).unwrap();
        assert!(matches!(m, ClientMsg::Peek { index: 1, .. }));
    }

    #[test]
    fn tier_stakes_match_the_web_tables() {
        assert_eq!(Tier::Low.stakes(), (100, 50_000, 50_000));
        assert_eq!(Tier::Mid.stakes(), (2_500, 500_000, 1_000_000));
        assert_eq!(Tier::High.stakes(), (50_000, 10_000_000, 25_000_000));
    }
}
