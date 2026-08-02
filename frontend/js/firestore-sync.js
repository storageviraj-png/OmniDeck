// ============================================================================
// FREEFLOW / OmniDeck — Firestore transport + thin SDK wrapper.
//
// Used for two things, both optional / not on the must-never-fail-live path:
//   1. The live-state channel, ONLY when local mode isn't available (no
//      ?room=&token= in the URL) — see sync-provider.js.
//   2. The songs/images/videos/presentations LIBRARIES, whenever Firebase is
//      configured, regardless of local/remote live-state mode — see
//      presentations.js and controller.js's loadSongs/loadImages/loadVideos.
//
// A church running purely local/LAN mode with js/config.js left at its
// REPLACE_ME defaults never needs this file to do anything — every export
// below either checks that guard first or is simply never called by
// local-mode-only code paths. Nothing here loads the Firebase SDK eagerly:
// the actual SDK modules are dynamically imported on first real use (see
// ensureReady() below), not at this file's own top level — so importing
// this module (which controller.js, presentations.js, and sync-provider.js
// all do unconditionally) costs nothing on the network by itself.
//
// SDK: Firebase v9+ modular, loaded from the same version-pinned gstatic
// CDN controller.js already uses for firebase-storage.js — this project has
// no bundler, so CDN imports are this codebase's established pattern, not
// a new one introduced here.
// ============================================================================
import { firebaseConfig } from './config.js';

const SDK_VERSION = '11.6.1';
const GSTATIC = `https://www.gstatic.com/firebasejs/${SDK_VERSION}`;

let _app = null;
let _db = null;
let _sdk = null;          // the dynamically-imported firestore module's exports
let _ready = false;
let _readyPromise = null;

// Loads the Firebase SDK modules, initializes the app/Firestore/anonymous
// auth, and caches everything needed by the synchronous wrappers below.
// Idempotent and safe to call from multiple places at once — every caller
// gets the same promise. Throws synchronously (before any network access)
// if js/config.js hasn't been filled in — callers (initFirebase, watchDoc,
// output.html) rely on catching exactly this 'CONFIG_NOT_SET' message.
function ensureReady() {
  if (firebaseConfig.apiKey === 'REPLACE_ME') {
    throw new Error('CONFIG_NOT_SET');
  }
  if (_readyPromise) return _readyPromise;

  _readyPromise = (async () => {
    const [{ initializeApp }, firestoreSdk, { getAuth, signInAnonymously }] = await Promise.all([
      import(/* @vite-ignore */ `${GSTATIC}/firebase-app.js`),
      import(/* @vite-ignore */ `${GSTATIC}/firebase-firestore.js`),
      import(/* @vite-ignore */ `${GSTATIC}/firebase-auth.js`)
    ]);

    _sdk = firestoreSdk;
    _app = initializeApp(firebaseConfig);
    _db = firestoreSdk.getFirestore(_app);

    // Anonymous auth only — this project ships with no user-account system
    // (see storage.rules/firestore.rules from the original ScriptureFlow
    // design). Firestore/Storage rules gate access by anonymous uid, not by
    // identity.
    const auth = getAuth(_app);
    await signInAnonymously(auth);

    _ready = true;
  })();

  return _readyPromise;
}

// Explicit init entry point — controller.js's boot sequence calls this
// (awaited) before touching any of the synchronous wrappers below, so that
// getDb()/collection()/doc() can stay synchronous instead of forcing every
// call site in controller.js/presentations.js to be rewritten with await.
export function initFirebase() {
  return ensureReady();
}

// Synchronous — only valid to call after initFirebase()/ensureReady() has
// resolved (guaranteed at every existing call site: controller.js awaits
// initFirebase() during boot before any of these run, and watchDoc() below
// awaits ensureReady() itself before touching Firestore).
export function getDb() {
  if (!_ready) {
    throw new Error('firestore-sync: getDb() called before initFirebase() finished — this is a bug in the caller\'s await ordering, not a config problem.');
  }
  return _db;
}

export function collection(db, ...pathSegments) {
  return _sdk.collection(db, ...pathSegments);
}

export function doc(db, ...pathSegments) {
  return _sdk.doc(db, ...pathSegments);
}

export async function addDoc(collectionRef, data) {
  await ensureReady();
  return _sdk.addDoc(collectionRef, data);
}

export async function deleteDoc(docRef) {
  await ensureReady();
  return _sdk.deleteDoc(docRef);
}

export async function getDoc(docRef) {
  await ensureReady();
  return _sdk.getDoc(docRef);
}

export async function getDocs(collectionRef) {
  await ensureReady();
  return _sdk.getDocs(collectionRef);
}

// Full overwrite of the document at `pathSegments` (array of path parts,
// e.g. LIVE_STATE_PATH or [...PRESENTATION_CONTENT_COLLECTION, id]).
// Used where the caller always sends the complete object — the live state
// document and a presentation's full slide array.
export async function writeDoc(pathSegments, data) {
  await ensureReady();
  return _sdk.setDoc(_sdk.doc(_db, ...pathSegments), data);
}

// Partial update of the document at `pathSegments` — only the given fields
// change, everything else on the document is left alone. Used for
// presentation metadata patches (rename, favorite, updatedAt, ...).
export async function patchDoc(pathSegments, fields) {
  await ensureReady();
  return _sdk.updateDoc(_sdk.doc(_db, ...pathSegments), fields);
}

// Live-subscribes to the document at `pathSegments`, calling
// onData(data, { fromCache }) on every update. Same call shape as
// sync-local.js's watchLiveState so sync-provider.js can pick either
// transport interchangeably. Returns { stop } SYNCHRONOUSLY (the actual
// subscription is wired up once the SDK finishes loading) so callers never
// need to await this — matches sync-local.js's watchLiveState exactly.
//
// Throws synchronously if config isn't set — this is what output.html's
// top-level try/catch around watchLiveState() is written to catch.
export function watchDoc(pathSegments, onData, { log = () => {} } = {}) {
  if (firebaseConfig.apiKey === 'REPLACE_ME') {
    throw new Error('CONFIG_NOT_SET');
  }

  let unsub = null;
  let stopped = false;

  ensureReady()
    .then(() => {
      if (stopped) return;
      const ref = _sdk.doc(_db, ...pathSegments);
      unsub = _sdk.onSnapshot(
        ref,
        { includeMetadataChanges: true },
        (snap) => {
          if (!snap.exists()) return;
          onData(snap.data(), { fromCache: snap.metadata.fromCache });
        },
        (err) => log('Firestore watch error', err)
      );
    })
    .catch((err) => log('Firestore init failed', err));

  return {
    stop: () => {
      stopped = true;
      if (unsub) unsub();
    }
  };
}
