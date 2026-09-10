//! The table service: one WebSocket endpoint speaking the protocol, a room
//! registry, and static hosting for the built SPA. The shoe never leaves
//! this process.

mod protocol;
mod rooms;

use axum::extract::ws::{Message, WebSocket, WebSocketUpgrade};
use axum::extract::State;
use axum::http::{header, HeaderValue, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::get;
use axum::{Json, Router};
use futures_util::{FutureExt, SinkExt, StreamExt};
use protocol::{ClientMsg, ServerMsg, PROTOCOL_VERSION};
use rooms::{
    arm_squeeze_clock, arm_squeeze_grace, error_message, maybe_pace, Registry, Room, OUT_QUEUE,
};
use std::panic::AssertUnwindSafe;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;
use tokio::sync::{mpsc, Mutex};
use tower_http::services::{ServeDir, ServeFile};
use tower_http::set_header::SetResponseHeaderLayer;

/// A connection silent for this long forfeits its seat (and unblocks the
/// table it may be stalling). The web client sends a message on every action,
/// so this only fires on a genuinely away player.
const IDLE_LIMIT: std::time::Duration = std::time::Duration::from_secs(300);

/// Hard ceiling on concurrent WebSocket connections. Rooms and seats are
/// bounded (MAX_ROOMS × MAX_SEATS), but without this a client could hold
/// unlimited idle sockets, each costing a task and a queue.
const MAX_CONNS: usize = 1024;

/// Unknown-room-code strikes before the connection is closed. The invite
/// code is a private table's only privacy control; without a budget it can
/// be brute-forced at wire speed.
const MAX_JOIN_FAILURES: u32 = 10;

/// Largest WebSocket message we accept, enforced at the transport so an
/// oversized frame is rejected before it's buffered. The protocol's real
/// messages are well under this; a small headroom over the app-level check
/// keeps JSON overhead from tripping legitimate traffic.
const MAX_WS_MESSAGE: usize = 8 * 1024;

/// How often the reaper runs the room sweep on its own. Held seats used to
/// expire only when some connection event happened to trigger a sweep, so a
/// quiet table could sit on a dead seat well past HOLD.
const REAP_EVERY: std::time::Duration = std::time::Duration::from_secs(10);

static CONNS: AtomicUsize = AtomicUsize::new(0);

/// RAII slot in the connection budget — released on drop, panic included.
struct ConnSlot;

impl ConnSlot {
    fn try_acquire() -> Option<ConnSlot> {
        if CONNS.fetch_add(1, Ordering::Relaxed) < MAX_CONNS {
            Some(ConnSlot)
        } else {
            CONNS.fetch_sub(1, Ordering::Relaxed);
            None
        }
    }
}

impl Drop for ConnSlot {
    fn drop(&mut self) {
        CONNS.fetch_sub(1, Ordering::Relaxed);
    }
}

/// Kept permissive enough for the app's real needs (inlined wasm, Google
/// Fonts, same-origin websockets) while shutting the usual injection doors.
const CSP: &str = "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; \
    style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; \
    font-src 'self' https://fonts.gstatic.com; img-src 'self' data:; \
    connect-src 'self' ws: wss:; object-src 'none'; base-uri 'self'; \
    frame-ancestors 'none'";

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt::init();
    let registry = Registry::new();

    // The reaper: expire held seats and drop dead rooms on a clock, not only
    // when a socket happens to open or close. `sweep` releases the registry
    // lock before touching any room, so this never stalls joins.
    tokio::spawn({
        let registry = registry.clone();
        async move {
            let mut every = tokio::time::interval(REAP_EVERY);
            every.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
            loop {
                every.tick().await;
                registry.sweep().await;
            }
        }
    });

    let spa_dir = std::env::var("SPA_DIR").unwrap_or_else(|_| "web/dist".into());
    let spa = ServeDir::new(&spa_dir)
        .fallback(ServeFile::new(format!("{spa_dir}/index.html")));

    let app = Router::new()
        .route("/ws", get(ws_handler))
        .route("/health", get(health))
        .fallback_service(spa)
        .layer(SetResponseHeaderLayer::if_not_present(
            header::CONTENT_SECURITY_POLICY,
            HeaderValue::from_static(CSP),
        ))
        .layer(SetResponseHeaderLayer::if_not_present(
            header::X_CONTENT_TYPE_OPTIONS,
            HeaderValue::from_static("nosniff"),
        ))
        .layer(SetResponseHeaderLayer::if_not_present(
            header::REFERRER_POLICY,
            HeaderValue::from_static("strict-origin-when-cross-origin"),
        ))
        .layer(SetResponseHeaderLayer::if_not_present(
            header::X_FRAME_OPTIONS,
            HeaderValue::from_static("DENY"),
        ))
        .with_state(registry.clone());

    let port = std::env::var("PORT").unwrap_or_else(|_| "8788".into());
    let addr = format!("0.0.0.0:{port}");
    tracing::info!("table service listening on {addr}");
    let listener = tokio::net::TcpListener::bind(&addr).await.expect("bind");
    axum::serve(listener, app)
        .with_graceful_shutdown(shutdown_signal(registry))
        .await
        .expect("serve");
}

/// Wait for SIGTERM/ctrl-c, then warn every table before the process goes
/// down — clients see a reason instead of a bare socket reset when a deploy
/// or autoscale stop lands mid-hand.
async fn shutdown_signal(registry: Registry) {
    let ctrl_c = async {
        let _ = tokio::signal::ctrl_c().await;
    };
    #[cfg(unix)]
    let terminate = async {
        match tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate()) {
            Ok(mut sig) => {
                sig.recv().await;
            }
            Err(_) => std::future::pending::<()>().await,
        }
    };
    #[cfg(not(unix))]
    let terminate = std::future::pending::<()>();

    tokio::select! {
        _ = ctrl_c => {}
        _ = terminate => {}
    }
    tracing::info!("shutdown signal received — notifying tables");
    for room in registry.all_rooms().await {
        room.lock()
            .await
            .close_all("The casino is closing for a moment — please rejoin shortly.");
    }
    // Give the writer tasks a beat to flush the notices before we stop.
    tokio::time::sleep(std::time::Duration::from_millis(750)).await;
}

async fn health(State(registry): State<Registry>) -> Json<serde_json::Value> {
    Json(serde_json::json!({
        "status": "ok",
        "rooms": registry.room_count().await,
        "connections": CONNS.load(Ordering::Relaxed),
    }))
}

async fn ws_handler(ws: WebSocketUpgrade, State(registry): State<Registry>) -> Response {
    match ConnSlot::try_acquire() {
        // Cap the frame/message size at the transport, not just after
        // reassembly: tungstenite's defaults buffer up to 64 MiB before our
        // 4 KiB text-length check ever runs, so a client could stream huge
        // messages that are allocated and UTF-8-validated only to be dropped.
        Some(slot) => ws
            .max_message_size(MAX_WS_MESSAGE)
            .max_frame_size(MAX_WS_MESSAGE)
            .on_upgrade(move |socket| handle_socket(socket, registry, slot)),
        None => {
            tracing::warn!("connection refused: at MAX_CONNS ({MAX_CONNS})");
            (StatusCode::SERVICE_UNAVAILABLE, "The casino is at capacity.").into_response()
        }
    }
}

/// One connection = at most one seat at one table.
struct Seat {
    room: Arc<Mutex<Room>>,
    pid: baccarat_engine::table::PlayerId,
}

async fn handle_socket(socket: WebSocket, registry: Registry, _slot: ConnSlot) {
    let (mut ws_tx, mut ws_rx) = socket.split();
    // Outbound queue: room broadcasts land here and drain to the socket.
    // Bounded (see OUT_QUEUE) — a stalled reader drops broadcasts instead of
    // growing the queue without limit.
    let (tx, mut rx) = mpsc::channel::<ServerMsg>(OUT_QUEUE);

    let writer = tokio::spawn(async move {
        while let Some(msg) = rx.recv().await {
            let text = match serde_json::to_string(&msg) {
                Ok(t) => t,
                Err(_) => continue,
            };
            if ws_tx.send(Message::Text(text)).await.is_err() {
                break;
            }
        }
    });

    let mut seat: Option<Seat> = None;
    let mut failed_joins: u32 = 0;

    loop {
        // A silent client eventually forfeits its seat: with no messages for
        // IDLE_LIMIT it's away, and a seated idler otherwise blocks the whole
        // table's next deal. On timeout we tell them why before closing.
        match tokio::time::timeout(IDLE_LIMIT, ws_rx.next()).await {
            Ok(Some(Ok(Message::Text(text)))) => {
                if text.len() > 4096 {
                    let _ = tx.try_send(ServerMsg::Error { message: "Message too large.".into() });
                    continue;
                }
                let Ok(cmd) = serde_json::from_str::<ClientMsg>(&text) else {
                    let _ = tx.try_send(ServerMsg::Error { message: "Unrecognized message.".into() });
                    continue;
                };
                // A panic below must not skip the seat cleanup after the
                // loop — an unwinding connection would otherwise leave a
                // ghost seat that blocks the table's deals forever.
                let dispatch =
                    AssertUnwindSafe(handle_command(cmd, &registry, &tx, &mut seat, &mut failed_joins))
                        .catch_unwind()
                        .await;
                match dispatch {
                    Ok(true) => {}
                    Ok(false) => break, // server chose to end this connection
                    Err(_) => {
                        tracing::error!("command handler panicked — closing the connection");
                        let _ = tx.try_send(ServerMsg::Closed {
                            reason: "The dealer fumbled that one — please rejoin.".into(),
                        });
                        break;
                    }
                }
            }
            Ok(Some(Ok(_))) => continue, // non-text frame (ping/binary): ignore
            Ok(Some(Err(_))) | Ok(None) => break, // socket errored or closed
            Err(_) => {
                // Idle past the limit — away too long.
                let reason = if seat.is_some() {
                    "You were away too long — the table gave up your seat."
                } else {
                    "Closed for inactivity — reconnect when you're ready."
                };
                tracing::info!(seated = seat.is_some(), "idle connection evicted");
                let _ = tx.try_send(ServerMsg::Closed { reason: reason.into() });
                break;
            }
        }
    }

    // Connection gone: stand up and tell the table.
    if let Some(Seat { room, pid }) = seat.take() {
        let since = {
            let mut guard = room.lock().await;
            // Hold the seat rather than stand the player up: a dropped socket
            // used to forfeit their whole bankroll, and let a busted player
            // rejoin for a free full rebuy. The sweep evicts the seat once HOLD
            // elapses, so an abandoned chair still frees itself.
            let since = guard.hold_seat(pid);
            guard.broadcast();
            tracing::info!(room = %guard.id, "seat held for reconnect");
            since
        };
        // The seat waits the full HOLD, but the table can't wait that long on
        // face-down cards: if they aren't back within the grace, the house
        // dealer turns their hand for this coup.
        arm_squeeze_grace(room.clone(), pid, since);
        maybe_pace(room);
        registry.sweep().await;
    }
    // Drop the outbound sender so the writer drains any queued message (the
    // Closed notice above) and exits on its own — don't abort it out from
    // under an unsent close reason.
    drop(tx);
    let _ = writer.await;
}

/// Returns false when the server decides the connection should close (e.g.
/// too many bad invite-code guesses).
async fn handle_command(
    cmd: ClientMsg,
    registry: &Registry,
    tx: &mpsc::Sender<ServerMsg>,
    seat: &mut Option<Seat>,
    failed_joins: &mut u32,
) -> bool {
    match cmd {
        ClientMsg::ListRooms => {
            let rooms = registry.list_public().await;
            let _ = tx.try_send(ServerMsg::Rooms { rooms });
        }
        ClientMsg::CreateRoom { name, tier, private } => {
            // Guard before allocating: `sit` refuses when already seated, and a
            // room created for a refused sit would orphan (empty rooms are only
            // reclaimed on Leave/disconnect). A seated client spamming create —
            // or a double-clicked button — would leak rooms up to MAX_ROOMS.
            if seat.is_some() {
                let _ = tx.try_send(ServerMsg::Error { message: "You're already at a table.".into() });
            } else {
                match registry.create(tier, private).await {
                    Some(room) => {
                        sit(room, &name, tx, seat).await;
                    }
                    None => {
                        let _ = tx.try_send(ServerMsg::Error {
                            message: "The floor is full — join an open table instead.".into(),
                        });
                    }
                }
            }
        }
        ClientMsg::Rejoin { room, token } => {
            if seat.is_some() {
                let _ = tx.try_send(ServerMsg::Error { message: "You're already at a table.".into() });
                return true;
            }
            // A wrong token is indistinguishable from a bad room code, so it
            // spends the same strike budget: the token is a bearer credential
            // for someone's bankroll and must not be brute-forceable.
            let reclaimed = match registry.get(&room).await {
                Some(room) => {
                    let mut guard = room.lock().await;
                    match guard.reclaim(&token) {
                        Some(pid) => {
                            guard.seat(pid, tx.clone());
                            *seat = Some(Seat { room: room.clone(), pid });
                            match guard.table.view_for(pid) {
                                Ok(view) => {
                                    let fresh = guard.issue_token(pid);
                                    let _ = tx.try_send(ServerMsg::Joined {
                                        room: guard.id.clone(),
                                        player: pid,
                                        tier: guard.tier,
                                        view,
                                        proto: PROTOCOL_VERSION,
                                        token: fresh,
                                    });
                                    guard.broadcast();
                                    tracing::info!(room = %guard.id, "seat reclaimed");
                                    true
                                }
                                // The seat vanished between reclaim and view —
                                // undo the commit rather than hold a ghost.
                                Err(_) => {
                                    guard.release(pid);
                                    *seat = None;
                                    false
                                }
                            }
                        }
                        None => false,
                    }
                }
                None => false,
            };
            if reclaimed {
                *failed_joins = 0;
            } else {
                *failed_joins += 1;
                let _ = tx.try_send(ServerMsg::Error {
                    message: "That seat is gone — join as a new player.".into(),
                });
                if *failed_joins >= MAX_JOIN_FAILURES {
                    return false;
                }
            }
        }
        ClientMsg::JoinRoom { room, name } => match registry.get(&room).await {
            Some(room) => {
                // Reset the strike budget only on a real seating — not on any
                // lookup hit. Otherwise an attacker interleaves one known code
                // (their own room, or any from ListRooms) every few guesses to
                // zero the counter and brute-force invite codes forever on one
                // socket. A refused sit ("already seated") must not reset it.
                if sit(room, &name, tx, seat).await {
                    *failed_joins = 0;
                }
            }
            None => {
                // The room code doubles as a private table's invite code, so
                // bad guesses get a budget: log them, and cut the connection
                // once it looks like a brute-force rather than a typo.
                *failed_joins += 1;
                tracing::warn!(strikes = *failed_joins, "join attempt for unknown room code");
                if *failed_joins >= MAX_JOIN_FAILURES {
                    let _ = tx.try_send(ServerMsg::Closed {
                        reason: "Too many unknown table codes — check your invite and reconnect."
                            .into(),
                    });
                    return false;
                }
                let _ = tx.try_send(ServerMsg::Error { message: "No table by that code.".into() });
            }
        },
        ClientMsg::Leave => {
            if let Some(Seat { room, pid }) = seat.take() {
                {
                    let mut guard = room.lock().await;
                    guard.conns.remove(&pid);
                    let _ = guard.table.leave(pid);
                    guard.broadcast();
                }
                maybe_pace(room);
                registry.sweep().await;
                let _ = tx.try_send(ServerMsg::Left);
            }
        }
        // table commands need a seat
        table_cmd => {
            let Some(Seat { room, pid }) = seat.as_ref() else {
                let _ = tx.try_send(ServerMsg::Error { message: "Take a seat first.".into() });
                return true;
            };
            let pid = *pid;
            let mut room = room.lock().await;
            // A dealer-flip request is the one command the dealer speaks to:
            // the whole table should hear why a house card turned early.
            let flip_ask = match &table_cmd {
                ClientMsg::DealerFlip { count } => Some(*count),
                _ => None,
            };
            // Commands that move the coup along wind the squeeze clock: from
            // here the holder of the next face-down card has SQUEEZE_CLOCK to
            // act before the dealer turns it for them. A peek only counts
            // when it actually lifts a card — re-sending the same peek must
            // not buy the holder another SQUEEZE_CLOCK, over and over.
            let mut advances_coup = matches!(
                table_cmd,
                ClientMsg::Deal | ClientMsg::Reveal { .. } | ClientMsg::DealerFlip { .. }
            );
            let result = match table_cmd {
                ClientMsg::Bet { kind, amount } => room.table.place_bet(pid, kind, amount),
                ClientMsg::SitOut => room.table.sit_out(pid),
                ClientMsg::ClearBets => room.table.clear_bets(pid),
                ClientMsg::Deal => room.table.deal(),
                ClientMsg::Peek { hand, index } => {
                    room.table.peek(pid, hand, index).map(|lifted| advances_coup = lifted)
                }
                ClientMsg::Reveal { hand, index } => room.table.reveal(pid, hand, index),
                ClientMsg::DealerFlip { count } => room.table.request_dealer_flip(pid, count),
                ClientMsg::Settle => room.table.settle(),
                ClientMsg::NewShoe => room.table.new_shoe(),
                _ => unreachable!("non-table commands handled above"),
            };
            match result {
                Ok(()) => {
                    room.broadcast();
                    if let Some(count) = flip_ask {
                        room.announce(rooms::flip_request_line(&room.table, pid, count));
                    }
                    drop(room);
                    if let Some(Seat { room, .. }) = seat.as_ref() {
                        maybe_pace(room.clone());
                        if advances_coup {
                            arm_squeeze_clock(room.clone());
                        }
                    }
                }
                Err(e) => {
                    let _ = tx.try_send(ServerMsg::Error { message: error_message(&e) });
                }
            }
        }
    }
    true
}

/// Returns true only if this connection actually took a seat.
async fn sit(
    room: Arc<Mutex<Room>>,
    name: &str,
    tx: &mpsc::Sender<ServerMsg>,
    seat: &mut Option<Seat>,
) -> bool {
    if seat.is_some() {
        let _ = tx.try_send(ServerMsg::Error { message: "You're already at a table.".into() });
        return false;
    }
    let mut guard = room.lock().await;
    let (.., buy_in) = guard.tier.stakes();
    let name = clean_name(name);
    match guard.table.join(&name, buy_in) {
        Ok(pid) => {
            guard.seat(pid, tx.clone());
            // Commit the connection-local seat NOW, before the fallible work
            // below (`view_for`'s expect, and `broadcast` which calls
            // `view_for` for every seat). If any of that panics, the caught
            // unwind's disconnect cleanup keys off `seat.is_some()` and will
            // `leave(pid)` + remove the conn — without this early commit it
            // would see `None` and leave a ghost seat wedging the room (S9).
            *seat = Some(Seat { room: room.clone(), pid });
            let view = guard.table.view_for(pid).expect("just joined");
            let token = guard.issue_token(pid);
            let _ = tx.try_send(ServerMsg::Joined {
                room: guard.id.clone(),
                player: pid,
                tier: guard.tier,
                view,
                proto: PROTOCOL_VERSION,
                token,
            });
            guard.broadcast();
            let (id, tier) = (guard.id.clone(), guard.tier);
            drop(guard);
            tracing::info!("seat taken at {id} ({tier:?})");
            true
        }
        Err(e) => {
            let _ = tx.try_send(ServerMsg::Error { message: error_message(&e) });
            false
        }
    }
}

/// Normalize a display name before it's shown to every other seat. Strips
/// Unicode control and format characters — which includes bidi overrides
/// (U+202E etc.) and zero-width joiners a peer could use to render their
/// name reversed, blank, or spoofing another seat — then trims and caps to
/// 24 chars, falling back to "guest".
fn clean_name(raw: &str) -> String {
    let filtered: String = raw
        .chars()
        .filter(|c| !c.is_control() && !is_format_char(*c))
        .collect();
    // Trim BEFORE the length cap so leading whitespace can't eat the budget.
    let capped: String = filtered.trim().chars().take(24).collect();
    if capped.is_empty() { "guest".to_string() } else { capped }
}

/// Unicode "format" (Cf) characters — zero-width joiners, bidi controls, the
/// BOM, and the Tag block. std has no category API, so match the ranges that
/// matter: anything that renders as nothing and so could carry a covert
/// (steganographic) payload or spoof a name through the seat list.
fn is_format_char(c: char) -> bool {
    matches!(c,
        '\u{00AD}'                // soft hyphen
        | '\u{061C}'              // arabic letter mark
        | '\u{180E}'              // mongolian vowel separator
        | '\u{200B}'..='\u{200F}' // zero-width space/joiners, LRM/RLM
        | '\u{202A}'..='\u{202E}' // bidi embeddings/overrides
        | '\u{2060}'..='\u{2064}' // word joiner, invisible operators
        | '\u{2066}'..='\u{206F}' // bidi isolates + deprecated format
        | '\u{FEFF}'              // zero-width no-break space / BOM
        | '\u{FFF9}'..='\u{FFFB}' // interlinear annotation
        | '\u{E0000}'..='\u{E007F}' // Tags block — invisible "ASCII smuggling" payloads
    )
}

#[cfg(test)]
mod squeeze_clock_tests {
    //! The squeeze clock is wound by commands that actually move the coup
    //! along — not by a peek that changes nothing.
    use super::*;
    use baccarat_engine::scoreboard::Side;
    use baccarat_engine::session::BetKind;
    use baccarat_engine::settle::BetSpot;
    use baccarat_engine::table::PlayerId;
    use protocol::Tier;

    /// a squeezes Player, b squeezes Banker; both connected, cards out.
    /// Returns everything a handle_command call for `a` needs.
    async fn dealt(
        registry: &Registry,
    ) -> (Arc<Mutex<Room>>, PlayerId, PlayerId, mpsc::Sender<ServerMsg>, mpsc::Receiver<ServerMsg>) {
        let room = registry.create(Tier::Mid, false).await.unwrap();
        let (ta, ra) = mpsc::channel(OUT_QUEUE);
        let (tb, _rb) = mpsc::channel(OUT_QUEUE);
        let (a, b) = {
            let mut g = room.lock().await;
            let (.., buy_in) = g.tier.stakes();
            let a = g.table.join("alice", buy_in).unwrap();
            let b = g.table.join("bob", buy_in).unwrap();
            g.seat(a, ta.clone());
            g.seat(b, tb);
            g.table.place_bet(a, BetKind::Main(BetSpot::Player), 2_500).unwrap();
            g.table.place_bet(b, BetKind::Main(BetSpot::Banker), 2_500).unwrap();
            g.table.deal().unwrap();
            (a, b)
        };
        std::mem::forget(_rb); // keep bob's queue open without draining it
        (room, a, b, ta, ra)
    }

    async fn settle_tasks() {
        for _ in 0..8 {
            tokio::task::yield_now().await;
        }
    }

    #[tokio::test(start_paused = true)]
    async fn a_repeated_peek_does_not_rewind_the_squeeze_clock() {
        let registry = Registry::new();
        let (room, a, _b, ta, _ra) = dealt(&registry).await;
        let mut seat = Some(Seat { room: room.clone(), pid: a });
        let mut strikes = 0;
        let gen0 = room.lock().await.squeeze_generation();

        // a genuine first peek winds the clock
        let peek = || ClientMsg::Peek { hand: Side::Player, index: 0 };
        assert!(handle_command(peek(), &registry, &ta, &mut seat, &mut strikes).await);
        settle_tasks().await;
        let gen1 = room.lock().await.squeeze_generation();
        assert_eq!(gen1, gen0 + 1, "a first peek is activity");

        // the same peek again changes nothing at the table: no rewind
        assert!(handle_command(peek(), &registry, &ta, &mut seat, &mut strikes).await);
        settle_tasks().await;
        assert_eq!(room.lock().await.squeeze_generation(), gen1, "a no-op peek is not activity");
        assert!(handle_command(peek(), &registry, &ta, &mut seat, &mut strikes).await);
        settle_tasks().await;
        assert_eq!(room.lock().await.squeeze_generation(), gen1);

        // peeking the OTHER card is a real lift again
        let other = ClientMsg::Peek { hand: Side::Player, index: 1 };
        assert!(handle_command(other, &registry, &ta, &mut seat, &mut strikes).await);
        settle_tasks().await;
        assert_eq!(room.lock().await.squeeze_generation(), gen1 + 1);
    }
}

#[cfg(test)]
mod tests {
    use super::clean_name;

    #[test]
    fn clean_name_strips_control_and_format_chars_and_caps_length() {
        // bidi override + zero-width joiner are removed
        assert_eq!(clean_name("ab\u{202E}cd\u{200D}"), "abcd");
        // control chars (newlines, tabs) removed
        assert_eq!(clean_name("a\nb\tc"), "abc");
        // empty / whitespace-only falls back to guest
        assert_eq!(clean_name("   "), "guest");
        assert_eq!(clean_name("\u{200B}\u{FEFF}"), "guest");
        // capped to 24 chars, then trimmed
        assert_eq!(clean_name(&"x".repeat(30)), "x".repeat(24));
        // ordinary names pass through
        assert_eq!(clean_name("  Sabien  "), "Sabien");
    }

    #[test]
    fn clean_name_strips_invisible_tag_and_other_format_chars() {
        // Tags block — invisible "ASCII smuggling" payload — is removed
        let smuggled = format!("Sam\u{E0041}\u{E0042}\u{E007F}");
        assert_eq!(clean_name(&smuggled), "Sam");
        // soft hyphen, arabic letter mark, mongolian vowel separator
        assert_eq!(clean_name("a\u{00AD}b\u{061C}c\u{180E}"), "abc");
        // a name that is ONLY an invisible payload collapses to guest
        assert_eq!(clean_name("\u{E0061}\u{E0062}\u{E0063}"), "guest");
    }
}
