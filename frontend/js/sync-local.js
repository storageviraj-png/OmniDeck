// ============================================================================
// FREEFLOW / OmniDeck — local-mode sync provider.
//
// Talks to the OmniDeck desktop app's embedded WebSocket server instead of
// Firestore. Only ever used for the LIVE STATE channel (what's on air right
// now) — the presentations/songs/images/videos libraries always go through
// Firestore directly (see presentations.js), since they aren't on the
// must-never-fail-mid-service path and don't need sub-second sync. See
// sync-provider.js for how this and firestore-sync.js are chosen between.
//
// Room + token come from the page's own URL (?room=...&token=...) — the
// desktop app opens its own controller window with these already in the
// address bar, and the same query string is what gets shared (as a full
// URL) to a second controller machine or pasted into OBS's Browser Source
// for output.html. Same mechanism for both pages; the server enforces
// whether a token is control (read/write) or viewer (read-only) — see
// src-tauri/src/main.rs.
// ============================================================================

function paramsFromUrl() {
  const p = new URLSearchParams(location.search);
  return { room: p.get('room'), token: p.get('token') };
}

export function isLocalModeAvailable() {
  const { room, token } = paramsFromUrl();
  return Boolean(room && token);
}

let ws = null;
let onDataCb = () => {};
let reconnectAttempt = 0;
let destroyed = false;
let logFn = () => {};

function wsUrl() {
  const { room, token } = paramsFromUrl();
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${location.host}/ws?room=${encodeURIComponent(room)}&token=${encodeURIComponent(token)}`;
}

function connect() {
  if (destroyed) return;
  ws = new WebSocket(wsUrl());
  ws.onopen = () => { reconnectAttempt = 0; logFn('local connection established'); };
  ws.onmessage = (evt) => {
    let msg;
    try { msg = JSON.parse(evt.data); } catch (e) { logFn('malformed message from local server', e); return; }
    if (msg.type === 'state') onDataCb(msg.data, { fromCache: false });
    else if (msg.type === 'error') logFn('local server rejected connection', msg.message);
  };
  ws.onclose = () => {
    if (destroyed) return;
    logFn('local connection lost, reconnecting');
    reconnectAttempt += 1;
    setTimeout(connect, Math.min(1000 * 2 ** (reconnectAttempt - 1), 10000));
  };
  ws.onerror = () => { try { ws.close(); } catch (e) {} };
}

// Same call shape as firestore-sync.js's watchDoc, minus the path (there's
// only ever one live-state channel per room, so no path array is needed).
export function watchLiveState(onData, { log = () => {} } = {}) {
  onDataCb = onData;
  logFn = log;
  destroyed = false;
  connect();
  return { stop: () => { destroyed = true; if (ws) ws.close(); } };
}

export async function pushLiveState(data) {
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    throw new Error('Local connection not ready yet — try again in a moment');
  }
  ws.send(JSON.stringify({ type: 'push', data }));
}

// For the "Connections" panel: building shareable controller/output URLs.
export function currentRoomParams() {
  return paramsFromUrl();
}

// The viewer token is deliberately NOT in this page's own URL (this page
// holds the more powerful control token) — it's fetched on demand from the
// local server's tiny HTTP endpoint, which only hands it out to a caller
// who already proves control-token possession. See src-tauri/src/main.rs.
export async function fetchOutputUrl() {
  const { room, token } = paramsFromUrl();
  const res = await fetch(`/api/room-info?room=${encodeURIComponent(room)}&token=${encodeURIComponent(token)}`);
  if (!res.ok) throw new Error(`Local server returned ${res.status}`);
  const info = await res.json();
  return `${location.protocol}//${location.host}/output.html?room=${encodeURIComponent(room)}&token=${encodeURIComponent(info.viewerToken)}`;
}
