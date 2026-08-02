# OmniDeck website

The public marketing site — this is **not** the desktop application. It's a
static site that introduces OmniDeck and links people to the Windows
installer, GitHub, and docs. The presentation app itself lives entirely in
`/freeflow` at the repo root and this folder never imports from it, builds
it, or reads its source.

## Structure

```
website/
├── index.html                  Home page — all sections live here
├── docs/                       Standalone doc pages (Getting Started, OBS Setup, ...)
├── assets/
│   ├── css/style.css           Whole design system — no framework
│   ├── js/main.js              Nav, scroll state, screenshot swap-in
│   ├── js/downloads.js         Reads data/releases.json, fills in buttons
│   └── img/                    Logo + screenshot placeholders
├── data/releases.json          Version + per-platform download links (see below)
├── scripts/generate-releases-json.mjs   Used by the GitHub Action, below
└── netlify.toml                 Optional — only relevant if you deploy with Netlify
```

Plain HTML/CSS/JS, no build step, no `node_modules`, no framework. That's a
deliberate choice for a marketing page: it loads fast, there's nothing to
compile, and it can't fail to build in a way that blocks an app release.

## Local preview

Any static file server works, e.g.:

```
npx serve website
```

or just open `website/index.html` directly in a browser — the only feature
that needs an actual server is the `fetch('data/releases.json')` call in
`downloads.js` (fetch doesn't run over `file://` in every browser). If that
fetch fails for any reason, the page falls back to whatever static content
is already written into `index.html`, so it never looks broken either way.

## Updating download links

Everything version- and download-related on the page — the hero badge, the
primary "Download for Windows" button, the three Downloads cards, and the
footer version — is read from **`data/releases.json`** at page load, not
hardcoded in HTML. To ship a new release:

**Option A — by hand.** Edit `data/releases.json` and commit it. That's the
entire update.

**Option B — automatically.** `.github/workflows/update-website-release.yml`
watches for a GitHub Release being published, runs
`scripts/generate-releases-json.mjs` to match the release's uploaded assets
(`*.exe`/`*.msi` → Windows, `*.dmg`/`*.pkg` → macOS, `*.AppImage`/`*.deb`/
`*.rpm` → Linux) against `data/releases.json`, and commits the result. If
your host redeploys on every push to `main` (GitHub Pages, or Netlify/Vercel
watching the repo), the new links go live automatically with no one touching
the website's code. A platform with no matching asset in a given release
(e.g. macOS before it has a build) is left exactly as it was — it won't get
overwritten with something broken.

To wire this up: publish releases from whatever workflow builds the Tauri
app (adding installers as release assets), and this Action does the rest.
The two workflows never need to know about each other beyond "a Release got
published" — the app's build pipeline can change freely without touching
this file.

## Screenshots

`index.html`'s Screenshots section points four `<img>` tags at
`assets/img/screenshots/{editor,output,media,library}.png`, which don't
exist yet. Until they do, `main.js` shows a drawn placeholder behind each
one. To add a real screenshot, just drop a PNG in at the matching filename —
`main.js` detects the successful image load and fades the placeholder out.
No HTML or CSS changes needed.

## Deploying

The site is a plain static folder, so any static host works:

- **GitHub Pages** — set the Pages source to this folder (e.g. via a
  `gh-pages` deploy action, or Pages' "serve from `/website`" option if your
  default branch supports it).
- **Netlify** — set "Base directory" to `website`, leave the build command
  empty, "Publish directory" to `.` (the included `netlify.toml` already
  says this).
- **Vercel / Cloudflare Pages** — set the project's Root Directory to
  `website`; no build command needed.

None of these need any knowledge of `/freeflow`, Rust, or Tauri — the
desktop app keeps building exactly as it did before this folder existed.
