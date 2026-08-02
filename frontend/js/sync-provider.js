// ============================================================================
// FREEFLOW / OmniDeck — sync provider selection.
//
// Picks the transport for the LIVE STATE channel only:
//   - Local WebSocket (this machine's OmniDeck desktop app, or another
//     OmniDeck instance reachable on the LAN) when the page was opened
//     with ?room=&token= in the URL — the default for local/LAN use,
//     zero internet dependency, LAN-speed latency.
//   - Firestore, otherwise — used when "Remote Access" is enabled and the
//     page is reached over the internet without a local room in its URL.
//
// controller.js and output.html import ONLY from this file for the live
// state, never directly from sync-local.js or firestore-sync.js — so
// neither needs to know or care which transport is actually active.
//
// Everything else (presentations, songs, images, videos) always goes
// through firestore-sync.js directly — unaffected by this file entirely.
// ============================================================================
import { LIVE_STATE_PATH } from './config.js';
import { watchDoc as watchFirestoreDoc, writeDoc as writeFirestoreDoc } from './firestore-sync.js';
import { isLocalModeAvailable, watchLiveState as watchLocal, pushLiveState as pushLocal, currentRoomParams, fetchOutputUrl as fetchLocalOutputUrl } from './sync-local.js';

const useLocal = isLocalModeAvailable();

export function isLocalMode() {
  return useLocal;
}

export function watchLiveState(onData, opts) {
  return useLocal
    ? watchLocal(onData, opts)
    : watchFirestoreDoc(LIVE_STATE_PATH, onData, opts);
}

export async function pushLiveState(data) {
  return useLocal
    ? pushLocal(data)
    : writeFirestoreDoc(LIVE_STATE_PATH, data);
}

// For controller.html's "Connections" panel: builds the shareable
// controller URL for a second machine on the LAN. Only meaningful in local
// mode — Firestore/remote mode has no per-room URL, every operator just
// opens the same controller.html. The output/viewer URL is built
// separately in controller.js, which asks the local server for the room's
// VIEWER token directly rather than assuming this page's own token (a
// control token) is safe to hand to an output display.
export function shareableControllerUrl() {
  if (!useLocal) return null;
  const { room, token } = currentRoomParams();
  return `${location.protocol}//${location.host}/controller.html?room=${encodeURIComponent(room)}&token=${encodeURIComponent(token)}`;
}

// Wraps sync-local's fetchOutputUrl — only meaningful in local mode.
export async function fetchOutputUrl() {
  if (!useLocal) return null;
  return fetchLocalOutputUrl();
}
