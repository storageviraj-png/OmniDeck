# OmniDeck — Architecture Guide

A concise map of how this project is put together and why, for anyone
extending it. This intentionally doesn't repeat the file-by-file structure
in the root README — start there for "where is X", start here for "why does
X work this way, and how do I add to it safely."

## Why this structure

OmniDeck has one hard requirement that shapes everything else: **a live
Sunday service must not break because the church's internet is down.**
Every structural decision below traces back to that:

- No frontend framework or bundler. `frontend/` is plain HTML/CSS/ES
  modules, loaded directly — nothing to fail to compile, no build step
  standing between "I edited a file" and "it runs."
- No CDN dependencies at runtime (Tailwind, fonts — all vendored locally).
- The Rust backend embeds its own HTTP/WebSocket server rather than relying
  on Tauri's `tauri://` asset protocol, so `output.html` (running inside
  OBS's browser source, or on a second monitor, or over the church's LAN)
  talks to a real `http://` origin regardless of whether it's inside the
  desktop app at all.
- Firestore/Firebase is opt-in and additive (song/media library sync,
  optional remote access) — never on the path between "operator clicks
  next" and "the words change on screen."

## Top-level folders

- **`frontend/`** — the entire UI. No build artifacts checked in except
  `frontend/css/tailwind.css` (regenerated automatically, see README) and
  the vendored files in `frontend/fonts/`. Two independent HTML entry
  points, not one SPA:
  - `controller.html` — the operator's UI. Heavy: editor, libraries, search.
  - `output.html` — the stage. Deliberately minimal: it only ever paints
    whatever state it's told to, nothing else. This split exists because
    the two pages have completely different jobs, different security needs
    (output is read-only by design), and different places they run.
- **`src-tauri/`** — the Rust backend. A thin Tauri shell around an embedded
  `axum` server (`server.rs`); `main.rs` mostly wires window creation and
  resource paths.
- **`website/`** — the public site. Structurally and operationally
  independent of the app (own CI trigger, own deploy target) — see the
  root README's "Release workflow" section. Never import from here into
  `frontend/` or vice versa.
- **`.github/workflows/`** — CI. Currently only the website's release-link
  updater; see README for what's still manual.

## How the frontend talks to the Rust backend

Two separate channels, for two separate concerns — don't conflate them:

1. **Tauri IPC** (`window.__TAURI__`, via `invoke()`), for desktop-only
   actions: today, just `open_output_window` (spawns the second window).
   This is the only thing that requires actually running inside the Tauri
   shell — everything else in `output.html`/`controller.html` works the
   same whether they're opened as Tauri windows or as plain browser tabs
   pointed at the local server.
2. **HTTP/WebSocket, to the embedded server** (`server.rs`, default port
   4747), for everything that's actually about the presentation: pushing
   slide state, receiving it, room/token handshake. This is the channel
   that makes local mode work without Tauri at all — a confidence monitor
   on a second laptop just opens `output.html` in Chrome.

Don't add a new Tauri `invoke()` command for something that could instead
be a room-server message — that would make it desktop-only for no reason.

## How the local WebSocket server works

One room per running app instance (`server.rs`'s `Room`), generated on
first run and persisted to disk so it survives restarts. A room has two
tokens:

- **Control token** — read/write. The operator's controller window holds
  this.
- **Viewer token** — read-only. Given to `output.html` instances and to
  anyone the operator shares a confidence-monitor link with.

`/ws?room=&token=` upgrades to a WebSocket; which token you present decides
whether your socket can write. `/api/room-info?room=&token=` lets a
control-token holder fetch the room's viewer token (so the operator's UI
can generate a shareable read-only link without hardcoding it).

The server itself is intentionally dumb: it holds the latest state as an
opaque pre-serialized JSON string, bumps a version counter on every write,
and rebroadcasts to every connected socket via a `tokio::sync::broadcast`
channel. **It never inspects or validates the shape of the state** — that
contract lives entirely in `frontend/js/sync-local.js` (what the JS side
sends/expects) and `frontend/js/render-engine.js` (what `output.html` does
with it). This is deliberate: it keeps the Rust side stable even as the
slide/component schema evolves — you should almost never need to touch
`server.rs` to add a frontend feature.

`sync-provider.js` picks between this local transport and the optional
Firestore transport (`firestore-sync.js`) based on whether the page was
opened with `?room=&token=` in the URL — everything above `sync-provider.js`
(controller.js, output.html) doesn't know or care which one is active.

## How to add a new presentation component

Component kinds (text, image, video, shape, ...) are registered in exactly
one place: `frontend/js/component-types.js`'s `COMPONENT_KINDS` map. To add
a new kind:

1. Add an entry to `COMPONENT_KINDS` — `label`, `defaults` (only fields
   that differ from the shared base fields in `slide-model.js`'s
   `newElement()`), and `fields` (which kind-specific inspector fields
   `controller.js` should show).
2. Add a render function for it in `render-engine.js`'s paint dispatch.
3. That's it — `controller.js`'s "add component" UI and inspector both read
   from the registry, not from a hardcoded list, so they pick up the new
   kind automatically.

Don't add a new `if (el.kind === '...')` branch anywhere outside
`render-engine.js`'s paint dispatch — if you find yourself doing that, the
kind-specific behavior probably belongs in `component-types.js`'s
`defaults`/`fields` instead.

## Extending the project without breaking the architecture

A few standing rules that keep the above true as the project grows:

- **Preserve the one-renderer rule.** `render-engine.js`'s `paintSlide()` is
  the only code that turns slide data into DOM, and both the controller's
  live preview and `output.html` call it. Never build a second, parallel
  rendering path for a new feature — extend `paintSlide()`/`positionEl()`
  instead, or the preview and the actual stage output will drift apart.
- **New element fields are additive, not breaking.** Anything in
  `slide-model.js`'s `newElement()` should have a sensible default so old
  saved slides/presentations still render correctly when opened by a newer
  build.
- **Local mode must keep working with zero configuration.** Before adding
  any dependency, ask whether a church running fully offline with
  `config.js` left at its `REPLACE_ME` defaults would still have a working
  app. If not, gate it behind the same `firestoreConfigured`/local-mode
  checks `controller.js` already uses elsewhere.
- **No new CDN dependencies.** If a feature needs a font, icon set, or
  library, vendor it (see `frontend/css/fonts.css`'s header comment for the
  pattern this project already uses) rather than linking to a hosted copy.
- **Keep `server.rs` schema-agnostic.** It should keep not knowing what's
  inside the JSON blob it relays. If a change requires the Rust server to
  understand slide/component internals, that's a sign the change belongs
  in the JS layer instead.
- **`website/` stays decoupled.** It should never gain a build-time or
  runtime dependency on `frontend/`/`src-tauri/`, and vice versa.

## Release workflow

See the root README's "Release workflow" section — this file only covers
architecture, not process.
