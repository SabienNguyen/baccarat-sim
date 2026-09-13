//! The wire protocol: JSON over WebSocket, reusing the engine's serializable
//! types so the web client's generated typings keep working.

use baccarat_engine::scoreboard::Side;
use baccarat_engine::session::BetKind;
use baccarat_engine::table::{FlipRequest, PlayerId, TableView};
use serde::{Deserialize, Serialize};

/// Bumped on any breaking wire change. Sent with `Joined` so a stale client
/// can tell "please refresh" apart from a generic bad message.
pub const PROTOCOL_VERSION: u32 = 1;

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
            Tier::High => (50_000, 50_000_000, 25_000_000),
        }
    }
}

#[derive(Debug, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ClientMsg {
    ListRooms,
    CreateRoom { name: String, tier: Tier, private: bool },
    JoinRoom { room: String, name: String },
    /// Reclaim a seat kept warm after a drop. The token came from `Joined`.
    Rejoin { room: String, token: String },
    /// Stand behind the seats: every push the table gets, no chair, no chips.
    /// Works on a full table and, by code, on a private one.
    Watch { room: String },
    /// Keepalive. A spectator sends nothing else, and a silent connection is
    /// otherwise evicted as away (see IDLE_LIMIT).
    Ping,
    /// Stand up — from a seat or from the rail.
    Leave,
    /// Change the name the table sees for this seat. Sanitized like a join.
    Rename { name: String },
    Bet { kind: BetKind, amount: i64 },
    SitOut,
    ClearBets,
    Deal,
    Peek { hand: Side, index: usize },
    Reveal { hand: Side, index: usize },
    /// The squeezer asks the dealer to turn one or both of the house hand's
    /// cards before finishing their own — the high-limit courtesy.
    DealerFlip { count: FlipRequest },
    Settle,
    NewShoe,
}

#[derive(Debug, Clone, Serialize)]
pub struct RoomInfo {
    pub id: String,
    pub tier: Tier,
    pub seats: usize,
    pub max_seats: usize,
    /// Spectators at the rail.
    pub watchers: usize,
}

#[derive(Debug, Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ServerMsg {
    Rooms { rooms: Vec<RoomInfo> },
    /// The dealer's voice between flips ("Turning the Banker's cards…").
    Announce { message: String },
    Joined {
        room: String,
        player: PlayerId,
        tier: Tier,
        view: TableView,
        proto: u32,
        /// Bearer credential for reclaiming this exact seat, bankroll intact,
        /// if the socket drops. Sent only to its owner; never broadcast.
        token: String,
    },
    /// Standing at the rail: the spectator's view (see `Table::view_public`).
    /// No token — there is no seat to reclaim; a dropped watcher just watches
    /// again.
    Watching { room: String, tier: Tier, view: TableView, proto: u32, watchers: usize },
    State {
        view: TableView,
        /// Spectators at the rail, so the table can show who's watching.
        watchers: usize,
    },
    /// Stood up. `reason` when the server did it — the table closed under a
    /// spectator — so the client can say why in the lobby.
    Left {
        #[serde(skip_serializing_if = "Option::is_none")]
        reason: Option<String>,
    },
    Error { message: String },
    /// The server is closing this connection for a stated reason (e.g. the
    /// seat was given up after being away). The client shows `reason`.
    Closed { reason: String },
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

        let m: ClientMsg =
            serde_json::from_str(r#"{"type":"dealer_flip","count":"Both"}"#).unwrap();
        assert!(matches!(m, ClientMsg::DealerFlip { count: FlipRequest::Both }));

        let m: ClientMsg = serde_json::from_str(r#"{"type":"rename","name":"alice"}"#).unwrap();
        assert!(matches!(m, ClientMsg::Rename { ref name } if name == "alice"));

        let m: ClientMsg = serde_json::from_str(r#"{"type":"watch","room":"ab12cd"}"#).unwrap();
        assert!(matches!(m, ClientMsg::Watch { ref room } if room == "ab12cd"));
        let m: ClientMsg = serde_json::from_str(r#"{"type":"ping"}"#).unwrap();
        assert!(matches!(m, ClientMsg::Ping));
    }

    #[test]
    fn a_plain_left_carries_no_reason_field() {
        // Older clients match `{"type":"left"}` exactly; a server-initiated
        // stand-up adds the reason, a voluntary one stays as it was.
        assert_eq!(serde_json::to_string(&ServerMsg::Left { reason: None }).unwrap(), r#"{"type":"left"}"#);
        assert_eq!(
            serde_json::to_string(&ServerMsg::Left { reason: Some("closed".into()) }).unwrap(),
            r#"{"type":"left","reason":"closed"}"#
        );
    }

    #[test]
    fn tier_stakes_match_the_web_tables() {
        assert_eq!(Tier::Low.stakes(), (100, 50_000, 50_000));
        assert_eq!(Tier::Mid.stakes(), (2_500, 500_000, 1_000_000));
        assert_eq!(Tier::High.stakes(), (50_000, 50_000_000, 25_000_000));
    }
}
