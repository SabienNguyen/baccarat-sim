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
use rooms::{error_message, maybe_pace, Registry, Room, OUT_QUEUE};
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
        Some(slot) => ws
            .on_upgrade(move |socket| handle_socket(socket, registry, slot))
            .into_response(),
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
        {
            let mut guard = room.lock().await;
            guard.conns.remove(&pid);
            let _ = guard.table.leave(pid);
            guard.broadcast();
            tracing::info!(room = %guard.id, "seat released on disconnect");
        }
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
                    Some(room) => sit(room, &name, tx, seat).await,
                    None => {
                        let _ = tx.try_send(ServerMsg::Error {
                            message: "The floor is full — join an open table instead.".into(),
                        });
                    }
                }
            }
        }
        ClientMsg::JoinRoom { room, name } => match registry.get(&room).await {
            Some(room) => {
                *failed_joins = 0;
                sit(room, &name, tx, seat).await;
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
            let result = match table_cmd {
                ClientMsg::Bet { kind, amount } => room.table.place_bet(pid, kind, amount),
                ClientMsg::SitOut => room.table.sit_out(pid),
                ClientMsg::ClearBets => room.table.clear_bets(pid),
                ClientMsg::Deal => room.table.deal(),
                ClientMsg::Peek { hand, index } => room.table.peek(pid, hand, index),
                ClientMsg::Reveal { hand, index } => room.table.reveal(pid, hand, index),
                ClientMsg::Settle => room.table.settle(),
                ClientMsg::NewShoe => room.table.new_shoe(),
                _ => unreachable!("non-table commands handled above"),
            };
            match result {
                Ok(()) => {
                    room.broadcast();
                    drop(room);
                    if let Some(Seat { room, .. }) = seat.as_ref() {
                        maybe_pace(room.clone());
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

async fn sit(
    room: Arc<Mutex<Room>>,
    name: &str,
    tx: &mpsc::Sender<ServerMsg>,
    seat: &mut Option<Seat>,
) {
    if seat.is_some() {
        let _ = tx.try_send(ServerMsg::Error { message: "You're already at a table.".into() });
        return;
    }
    let mut guard = room.lock().await;
    let (.., buy_in) = guard.tier.stakes();
    let name = if name.trim().is_empty() { "guest" } else { name.trim() };
    match guard.table.join(&name.chars().take(24).collect::<String>(), buy_in) {
        Ok(pid) => {
            guard.seat(pid, tx.clone());
            let view = guard.table.view_for(pid).expect("just joined");
            let _ = tx.try_send(ServerMsg::Joined {
                room: guard.id.clone(),
                player: pid,
                tier: guard.tier,
                view,
                proto: PROTOCOL_VERSION,
            });
            guard.broadcast();
            let (id, tier) = (guard.id.clone(), guard.tier);
            drop(guard);
            tracing::info!("seat taken at {id} ({tier:?})");
            *seat = Some(Seat { room, pid });
        }
        Err(e) => {
            let _ = tx.try_send(ServerMsg::Error { message: error_message(&e) });
        }
    }
}
