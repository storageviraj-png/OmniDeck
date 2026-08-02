// src-tauri/src/server.rs
//
// The embedded local server for OmniDeck's "local mode": serves the
// existing static controller.html/output.html/js/css files completely
// unchanged, and runs one WebSocket room per install for the live-state
// channel (what's actually on air right now). This is the ONLY thing local
// mode replaces — the presentations/songs/images/videos libraries keep
// using Firestore directly regardless of mode (see js/presentations.js).
//
// Security model:
//   - Each room has two tokens: a CONTROL token (read/write) and a VIEWER
//     token (read-only). Generated once per install, persisted to disk.
//   - /ws?room=&token=  is the live-state channel. A control-token socket
//     may send `push` messages; a viewer-token socket may only receive —
//     anything it sends is silently ignored, never trusted. Any other
//     token is rejected before the upgrade completes.
//   - /api/room-info?room=&token=  returns the room's viewer token, but
//     ONLY to a caller who already proves control-token possession. This
//     is how the controller UI builds the "paste into OBS" URL without
//     the viewer token ever needing to sit in the controller's own
//     address bar.
//   - No accounts, no internet exposure by default — binding to 0.0.0.0
//     makes this reachable on the LAN (needed for a projector PC or a
//     second controller machine) but nothing routes it past the router
//     unless the church explicitly forwards the port. The trust boundary
//     is "can reach this machine's network," which is what makes this
//     workable without user accounts.
//
// NOTE ON VERIFICATION: written carefully against axum 0.7 / tokio 1 /
// tower-http 0.5 idioms, but this environment has no Rust toolchain to
// compile-check it — run `cargo check` after dropping this in and fix
// whatever the compiler flags (most likely: exact crate versions/feature
// flags in Cargo.toml drifting from what's shown here).

use axum::{
    extract::{
        ws::{Message, WebSocket, WebSocketUpgrade},
        Query, State,
    },
    http::StatusCode,
    response::IntoResponse,
    routing::get,
    Json, Router,
};
use serde::{Deserialize, Serialize};
use std::{net::SocketAddr, path::PathBuf, sync::Arc};
use tokio::sync::{broadcast, RwLock};
use tower_http::services::ServeDir;
use uuid::Uuid;

#[derive(Clone, Serialize, Deserialize)]
pub struct Room {
    pub room_id: String,
    pub control_token: String,
    pub viewer_token: String,
}

impl Room {
    pub fn generate() -> Self {
        // Room id is short and friendly but NOT itself a secret — the
        // tokens are what actually gate access. Tokens are full UUIDs:
        // long, random, effectively unguessable.
        let room_id = Uuid::new_v4().simple().to_string()[..6].to_string();
        Room {
            room_id,
            control_token: Uuid::new_v4().to_string(),
            viewer_token: Uuid::new_v4().to_string(),
        }
    }

    /// Loads the persisted room from disk, or generates and saves a new
    /// one on first launch. `path` should be inside Tauri's app-data dir
    /// (e.g. `app_data_dir.join("room.json")`) so it survives restarts.
    pub fn load_or_create(path: &PathBuf) -> std::io::Result<Self> {
        if let Ok(bytes) = std::fs::read(path) {
            if let Ok(room) = serde_json::from_slice::<Room>(&bytes) {
                return Ok(room);
            }
        }
        let room = Room::generate();
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        std::fs::write(path, serde_json::to_vec_pretty(&room)?)?;
        Ok(room)
    }
}

// The live-state payload is intentionally opaque to the server — it's
// whatever shape controller.js/output.html agree on (slides, currentIndex,
// blackout, currentPresentationId, ...). The server only stores it, bumps
// a version on write, and rebroadcasts it; it never inspects the fields.
struct RoomRuntime {
    state: RwLock<(u64, serde_json::Value)>, // (version, data)
    tx: broadcast::Sender<String>,           // pre-serialized {"type":"state",...} JSON
}

#[derive(Clone)]
pub struct AppState {
    room: Room,
    runtime: Arc<RoomRuntime>,
}

#[derive(Deserialize)]
struct RoomQuery {
    room: String,
    token: String,
}

#[derive(Serialize)]
struct RoomInfoResponse {
    #[serde(rename = "viewerToken")]
    viewer_token: String,
}

enum TokenScope {
    Control,
    Viewer,
    Invalid,
}

fn scope_for(app: &AppState, q: &RoomQuery) -> TokenScope {
    if q.room != app.room.room_id {
        return TokenScope::Invalid;
    }
    if q.token == app.room.control_token {
        TokenScope::Control
    } else if q.token == app.room.viewer_token {
        TokenScope::Viewer
    } else {
        TokenScope::Invalid
    }
}

async fn room_info(State(app): State<AppState>, Query(q): Query<RoomQuery>) -> impl IntoResponse {
    match scope_for(&app, &q) {
        TokenScope::Control => {
            Json(RoomInfoResponse { viewer_token: app.room.viewer_token.clone() }).into_response()
        }
        _ => (StatusCode::FORBIDDEN, "invalid room or token").into_response(),
    }
}

async fn ws_handler(
    ws: WebSocketUpgrade,
    State(app): State<AppState>,
    Query(q): Query<RoomQuery>,
) -> impl IntoResponse {
    match scope_for(&app, &q) {
        TokenScope::Invalid => (StatusCode::FORBIDDEN, "invalid room or token").into_response(),
        scope => {
            let can_write = matches!(scope, TokenScope::Control);
            ws.on_upgrade(move |socket| handle_socket(socket, app, can_write))
                .into_response()
        }
    }
}

#[derive(Deserialize)]
#[serde(tag = "type", rename_all = "lowercase")]
enum ClientMessage {
    Push { data: serde_json::Value },
}

async fn handle_socket(mut socket: WebSocket, app: AppState, can_write: bool) {
    // Send the current state immediately so a newly-connected client
    // (output.html loading, or a reconnect) doesn't sit blank.
    {
        let (version, data) = &*app.runtime.state.read().await;
        let msg = serde_json::json!({ "type": "state", "data": data, "version": version });
        if socket.send(Message::Text(msg.to_string())).await.is_err() {
            return;
        }
    }

    let mut rx = app.runtime.tx.subscribe();
    loop {
        tokio::select! {
            incoming = socket.recv() => {
                match incoming {
                    Some(Ok(Message::Text(text))) => {
                        if !can_write { continue; } // viewer-token sockets: anything they send is ignored, never trusted
                        if let Ok(ClientMessage::Push { data }) = serde_json::from_str::<ClientMessage>(&text) {
                            let msg = {
                                let mut state = app.runtime.state.write().await;
                                state.0 += 1;
                                state.1 = data;
                                serde_json::json!({ "type": "state", "data": &state.1, "version": state.0 }).to_string()
                            };
                            let _ = app.runtime.tx.send(msg);
                        }
                    }
                    Some(Ok(Message::Close(_))) | None => break,
                    Some(Err(_)) => break,
                    _ => {}
                }
            }
            broadcast_msg = rx.recv() => {
                match broadcast_msg {
                    Ok(text) => { if socket.send(Message::Text(text)).await.is_err() { break; } }
                    Err(_) => break, // lagged or closed — let the client's own reconnect logic recover
                }
            }
        }
    }
}

/// Starts the local server on `port`, serving `static_dir` (the project's
/// existing controller.html/output.html/js/css, unchanged) plus the
/// room's WebSocket and room-info endpoints. Runs forever once bound —
/// spawn this on its own tokio task from main.rs.
pub async fn run(port: u16, static_dir: PathBuf, room: Room) -> std::io::Result<()> {
    let runtime = Arc::new(RoomRuntime {
        state: RwLock::new((0, serde_json::json!({}))),
        tx: broadcast::channel(64).0,
    });
    let app_state = AppState { room, runtime };

    let app = Router::new()
        .route("/ws", get(ws_handler))
        .route("/api/room-info", get(room_info))
        .fallback_service(ServeDir::new(static_dir))
        .with_state(app_state);

    // 0.0.0.0 so a projector PC or a second controller on the same LAN can
    // reach this — see the module doc comment on why that's still safe
    // without accounts.
    let addr = SocketAddr::from(([0, 0, 0, 0], port));
    let listener = tokio::net::TcpListener::bind(addr).await?;
    axum::serve(listener, app).await
}
