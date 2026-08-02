#!/usr/bin/env node
/**
 * Regenerates website/data/releases.json from a GitHub Release payload.
 *
 * Run by .github/workflows/update-website-release.yml whenever a Release is
 * published, but safe to run by hand too:
 *
 *   RELEASE_JSON=$(gh api repos/OWNER/omnideck/releases/latest) \
 *     node website/scripts/generate-releases-json.mjs
 *
 * It only ever touches website/data/releases.json — it doesn't read or write
 * anything under /freeflow, so a release build has no way to affect this
 * script and vice versa.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_PATH = join(__dirname, '..', 'data', 'releases.json');

const raw = process.env.RELEASE_JSON;
if (!raw) {
  console.error('RELEASE_JSON env var not set — nothing to do.');
  process.exit(1);
}

const release = JSON.parse(raw);
const version = String(release.tag_name || '').replace(/^v/i, '');
const assets = Array.isArray(release.assets) ? release.assets : [];

// Filename patterns for each platform's installer/package. Add more patterns
// here as the build matrix grows — this is the one place platform detection
// lives.
const MATCHERS = {
  windows: /\.(exe|msi)$/i,
  macos: /\.(dmg|pkg)$/i,
  linux: /\.(AppImage|deb|rpm)$/i,
};

function findAsset(pattern) {
  return assets.find((a) => pattern.test(a.name));
}

function toMB(bytes) {
  if (!bytes) return null;
  return Math.round(bytes / 1024 / 1024) + ' MB';
}

// Start from whatever is already on disk so platforms without a matching
// asset in *this* release (e.g. macOS still isn't built) keep their existing
// "coming soon" entry instead of being wiped out.
const existing = JSON.parse(readFileSync(OUT_PATH, 'utf8'));

for (const [platform, pattern] of Object.entries(MATCHERS)) {
  const asset = findAsset(pattern);
  if (!asset) continue; // leave this platform's existing entry untouched
  existing.platforms[platform] = {
    status: 'available',
    url: asset.browser_download_url,
    size: toMB(asset.size),
    note: existing.platforms[platform]?.note || '',
  };
}

existing.version = version || existing.version;
existing.publishedAt = (release.published_at || new Date().toISOString()).slice(0, 10);

writeFileSync(OUT_PATH, JSON.stringify(existing, null, 2) + '\n');
console.log(`Updated ${OUT_PATH} for v${existing.version}`);
