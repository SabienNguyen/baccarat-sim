//! The table service: one WebSocket endpoint speaking the protocol, a room
//! registry, and static hosting for the built SPA. The shoe never leaves
//! this process.

mod protocol;
mod rooms;

use axum::extract::ws::{Message, WebSocket, WebSocketUpgrade};
use axum::extract::State;
use axum::response::IntoResponse;
use axum::routing::get;
use axum::Router;
use futures_util::{SinkExt, StreamExt};
use protocol::{ClientMsg, ServerMsg};
use rooms::{error_message, maybe_pace, Registry, Room};
use std::sync::Arc;
use tokio::sync::{mpsc, Mutex};
use tower_http::services::{ServeDir, ServeFile};

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt::init();
    let registry = Registry::new();

    let spa_dir = std::env::var("SPA_DIR").unwrap_or_else(|_| "web/dist".into());
    let spa = ServeDir::new(&spa_dir)
        .fallback(ServeFile::new(format!("{spa_dir}/index.html")));

    let app = Router::new()
        .route("/ws", get(ws_handler))
        .fallback_service(spa)
        .with_state(registry);

    let port = std::env::var("PORT").unwrap_or_else(|_| "8788".into());
    let addr = format!("0.0.0.0:{port}");
    tracing::info!("table service listening on {addr}");
    let listener = tokio::net::TcpListener::bind(&addr).await.expect("bind");
    axum::serve(listener, app).await.expect("serve");
}

async fn ws_handler(ws: WebSocketUpgrade, State(registry): State<Registry>) -> impl IntoResponse {
    ws.on_upgrade(move |socket| handle_socket(socket, registry))
}

/// One connection = at most one seat at one table.
struct Seat {
    room: Arc<Mutex<Room>>,
    pid: baccarat_engine::table::PlayerId,
}

async fn handle_socket(socket: WebSocket, registry: Registry) {
    let (mut ws_tx, mut ws_rx) = socket.split();
    // Outbound queue: room broadcasts land here and drain to the socket.
    let (tx, mut rx) = mpsc::unbounded_channel::<ServerMsg>();

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

    while let Some(Ok(msg)) = ws_rx.next().await {
        let Message::Text(text) = msg else { continue };
        if text.len() > 4096 {
            let _ = tx.send(ServerMsg::Error { message: "Message too large.".into() });
            continue;
        }
        let parsed: Result<ClientMsg, _> = serde_json::from_str(&text);
        let Ok(cmd) = parsed else {
            let _ = tx.send(ServerMsg::Error { message: "Unrecognized message.".into() });
            continue;
        };
        handle_command(cmd, &registry, &tx, &mut seat).await;
    }

    // Connection gone: stand up and tell the table.
    if let Some(Seat { room, pid }) = seat.take() {
        {
            let mut guard = room.lock().await;
            guard.conns.remove(&pid);
            let _ = guard.table.leave(pid);
            guard.broadcast();
        }
        maybe_pace(room);
        registry.sweep().await;
    }
    writer.abort();
}

async fn handle_command(
    cmd: ClientMsg,
    registry: &Registry,
    tx: &mpsc::UnboundedSender<ServerMsg>,
    seat: &mut Option<Seat>,
) {
    match cmd {
        ClientMsg::ListRooms => {
            let rooms = registry.list_public().await;
            let _ = tx.send(ServerMsg::Rooms { rooms });
        }
        ClientMsg::CreateRoom { name, tier, private } => {
            let room = registry.create(tier, private).await;
            sit(room, &name, tx, seat).await;
        }
        ClientMsg::JoinRoom { room, name } => match registry.get(&room).await {
            Some(room) => sit(room, &name, tx, seat).await,
            None => {
                let _ = tx.send(ServerMsg::Error { message: "No table by that code.".into() });
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
                let _ = tx.send(ServerMsg::Left);
            }
        }
        // table commands need a seat
        table_cmd => {
            let Some(Seat { room, pid }) = seat.as_ref() else {
                let _ = tx.send(ServerMsg::Error { message: "Take a seat first.".into() });
                return;
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
                    let _ = tx.send(ServerMsg::Error { message: error_message(&e) });
                }
            }
        }
    }
}

async fn sit(
    room: Arc<Mutex<Room>>,
    name: &str,
    tx: &mpsc::UnboundedSender<ServerMsg>,
    seat: &mut Option<Seat>,
) {
    if seat.is_some() {
        let _ = tx.send(ServerMsg::Error { message: "You're already at a table.".into() });
        return;
    }
    let mut guard = room.lock().await;
    let (.., buy_in) = guard.tier.stakes();
    let name = if name.trim().is_empty() { "guest" } else { name.trim() };
    match guard.table.join(&name.chars().take(24).collect::<String>(), buy_in) {
        Ok(pid) => {
            guard.conns.insert(pid, tx.clone());
            let view = guard.table.view_for(pid).expect("just joined");
            let _ = tx.send(ServerMsg::Joined {
                room: guard.id.clone(),
                player: pid,
                tier: guard.tier,
                view,
            });
            guard.broadcast();
            let (id, tier) = (guard.id.clone(), guard.tier);
            drop(guard);
            tracing::info!("seat taken at {id} ({tier:?})");
            *seat = Some(Seat { room, pid });
        }
        Err(e) => {
            let _ = tx.send(ServerMsg::Error { message: error_message(&e) });
        }
    }
}
