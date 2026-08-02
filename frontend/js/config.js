// ============================================================================
// FREEFLOW — shared config. Loaded by both controller.html and output.html.
//
// This file is ONLY needed for Firestore/remote mode (the presentations,
// songs, images, and videos libraries, plus optional remote/internet
// access). Local mode (the desktop app, LAN-only) needs none of this at
// all — it never reads firebaseConfig.
//
// To enable remote mode / the libraries: create your own free Firebase
// project (console.firebase.google.com), enable Firestore + Storage +
// Anonymous Authentication, and paste your project's config below in place
// of REPLACE_ME. Never commit your real values to a public fork — keep
// this file untracked/gitignored once filled in.
// ============================================================================

export const firebaseConfig = {
  apiKey: "REPLACE_ME",
  authDomain: "REPLACE_ME",
  databaseURL: "REPLACE_ME",
  projectId: "REPLACE_ME",
  storageBucket: "REPLACE_ME",
  messagingSenderId: "REPLACE_ME",
  appId: "REPLACE_ME"
};

// Bump this only if you want to reset every operator to a fresh, empty state.
export const APP_ID = "freeflow-live";

// Single live-state document — this is what output.html listens to.
export const LIVE_STATE_PATH = ['artifacts', APP_ID, 'public', 'data', 'freeflow_state', 'current'];

// Collections (library content, persisted independently of what's live)
export const SONGS_COLLECTION   = ['artifacts', APP_ID, 'public', 'data', 'songs'];
export const SLIDES_COLLECTION  = ['artifacts', APP_ID, 'public', 'data', 'text_slides'];
export const IMAGES_COLLECTION  = ['artifacts', APP_ID, 'public', 'data', 'images'];
export const VIDEOS_COLLECTION  = ['artifacts', APP_ID, 'public', 'data', 'videos'];

// Presentations library — split in two so listing hundreds of presentations
// stays fast: PRESENTATIONS_COLLECTION holds only small metadata (name,
// folder, favorite, timestamps, a tiny thumbnail snapshot) for the library
// grid; PRESENTATION_CONTENT_COLLECTION holds each presentation's actual
// slides array, fetched by id only when that presentation is opened. Same
// document id is used in both. See js/presentations.js.
export const PRESENTATIONS_COLLECTION = ['artifacts', APP_ID, 'public', 'data', 'presentations'];
export const PRESENTATION_CONTENT_COLLECTION = ['artifacts', APP_ID, 'public', 'data', 'presentation_content'];

export const SCRIPT_FONT_FALLBACK = {
  en: 'sans-serif',
  te: '"Noto Sans Telugu", sans-serif',
  hi: '"Noto Sans Devanagari", sans-serif'
};
