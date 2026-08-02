# OmniDeck

Offline-first, open-source church presentation and live-streaming platform.
Built with [Tauri v2](https://tauri.app/) — one codebase, native desktop apps
for Windows, Linux, and macOS.

OmniDeck runs a local server on the operator's own machine and controls what
appears on stage output over a local WebSocket/HTTP connection — no internet
connection is required to run a live service. See `docs/ARCHITECTURE.md` for
how the pieces fit together and why.

## Project structure

```
OmniDeck/
├── frontend/          The desktop app's UI — plain HTML/CSS/JS, no bundler.
│   ├── controller.html    Operator-facing control surface (editor, library, playlist)
│   ├── output.html        The on-air stage — what OBS/a projector/a monitor shows
│   ├── css/                Stylesheets, including the locally-built Tailwind
│   │                        bundle and self-hosted fonts (see below)
│   ├── js/                  All application logic — one file per concern
│   │                        (see docs/ARCHITECTURE.md for the module map)
│   └── fonts/               Vendored font files (self-hosted, no CDN)
├── src-tauri/          The Rust backend — a Tauri app wrapping a local
│   │                    embedded HTTP/WebSocket server (see server.rs)
│   ├── src/main.rs          Tauri app entrypoint, window management
│   ├── src/server.rs        The local room server (axum + WebSocket)
│   ├── tauri.conf.json      App/bundle configuration
│   ├── capabilities/         Tauri's permission model
│   └── icons/                 App icons for all three platforms
├── website/            The public marketing/docs site (Netlify-deployed).
│   Deliberately decoupled from the app — see .github/workflows/.
├── .github/workflows/   CI — currently just the website's download-link
│   updater (see "Release workflow" below).
├── package.json         Root Node project (Tauri CLI + Tailwind CLI only —
│   the frontend has no framework/bundler dependency by design).
└── tailwind.config.js    Tailwind's content scan config.
```

## Development setup

**Prerequisites** (all platforms):
- [Rust](https://rustup.rs/) — stable toolchain, 1.77 or newer
- [Node.js](https://nodejs.org/) 18+
- [pnpm](https://pnpm.io/installation)

Platform-specific prerequisites are in the per-platform sections below —
install those *before* the steps here.

```bash
git clone <this repo>
cd OmniDeck
pnpm install       # installs @tauri-apps/cli + tailwindcss (devDependencies only)
pnpm tauri dev     # regenerates frontend/css/tailwind.css, then launches the app
```

There's no dev server to point at — `frontend/` is plain HTML/CSS/JS loaded
by the Rust backend's own embedded server (see `docs/ARCHITECTURE.md`), so
`tauri dev` just compiles Rust and opens a window. Edit a `frontend/js/*.js`
file and reload the window (Ctrl/Cmd+R) to see changes; no build step is
needed for JS/HTML edits themselves.

If you change which Tailwind utility classes are used in `controller.html`
or `frontend/js/*.js`, the CSS bundle needs regenerating:

```bash
pnpm build:css
```

This also runs automatically before every `pnpm tauri dev` / `pnpm tauri
build` (wired via `beforeDevCommand`/`beforeBuildCommand` in
`tauri.conf.json`), so you rarely need to run it by hand.

### Optional: remote/library sync (Firestore)

Songs, images, videos, and saved presentations can optionally sync through
Firebase/Firestore. This is entirely opt-in — a church running purely local
mode never needs it. To enable it, fill in real values in
`frontend/js/config.js` (replace every `"REPLACE_ME"`). Leave it as-is to
run fully local/offline.

## Build process

```bash
pnpm install
pnpm tauri build
```

This produces a native installer/bundle for whichever platform you run it
on (Tauri cross-compiles poorly in practice — build on the OS you're
targeting, or use CI runners per platform). Output lands in
`src-tauri/target/release/bundle/`.

### Windows build

Prerequisites:
- [Microsoft C++ Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/) (or Visual Studio with the "Desktop development with C++" workload)
- WebView2 Runtime — preinstalled on Windows 10 (2004+) and Windows 11; Tauri's installer bundles it for older systems

```powershell
pnpm install
pnpm tauri build
```

Produces an NSIS installer (`.exe`) and an MSI under
`src-tauri\target\release\bundle\{nsis,msi}\`.

### Linux build

Prerequisites (Debian/Ubuntu — adjust package names for other distros):

```bash
sudo apt update
sudo apt install -y \
  libwebkit2gtk-4.1-dev \
  libgtk-3-dev \
  build-essential \
  curl wget file \
  libxdo-dev \
  libssl-dev \
  libayatana-appindicator3-dev \
  librsvg2-dev
```

```bash
pnpm install
pnpm tauri build
```

Produces a `.deb` and an AppImage under
`src-tauri/target/release/bundle/{deb,appimage}/`.

### macOS build

Prerequisites:
- Xcode Command Line Tools: `xcode-select --install`

```bash
pnpm install
pnpm tauri build
```

Produces a `.app` bundle and a `.dmg` under
`src-tauri/target/release/bundle/{macos,dmg}/`.

> **Known gap:** `src-tauri/icons/icon.icns` in this repo was generated
> programmatically (not via `tauri icon`), which covers the common icon
> sizes but skips Apple's full recommended set. Before a real macOS
> release, run `pnpm tauri icon src-tauri/icons/icon.png` once on a
> machine with the Tauri CLI to regenerate a complete, tool-verified icon
> set (safe to do at any time — it only touches `src-tauri/icons/`).

## Release workflow

There are two separate, deliberately decoupled release concerns:

1. **Building and publishing the app installers** — not yet automated in
   this repo (no CI workflow builds/publishes Windows/Linux/macOS
   installers today). Until that exists, cut a release by running
   `pnpm tauri build` on each target platform and manually attaching the
   resulting installers to a GitHub Release.
2. **The website's download links** — *is* automated:
   `.github/workflows/update-website-release.yml` fires whenever a GitHub
   Release is published, regenerates `website/data/releases.json` from the
   release's assets, and commits it. The website itself never needs a
   manual update after a release goes out.

Adding a proper multi-platform build-and-publish workflow (e.g. via
[`tauri-apps/tauri-action`](https://github.com/tauri-apps/tauri-action) on
a build matrix) is the natural next step here, but is intentionally left
for a dedicated task rather than bundled into this one.

## License

MIT — see [LICENSE](./LICENSE).
