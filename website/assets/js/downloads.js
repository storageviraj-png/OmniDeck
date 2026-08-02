/* =============================================================================
   OmniDeck marketing site — download links & version badge.

   This is the "how do future releases update the download links" mechanism
   described in website/README.md: every version number, button label, href,
   and badge on this page is read from data/releases.json at load time, not
   hardcoded in the HTML. To ship a new release, update that one JSON file
   (by hand, or let .github/workflows/update-website-release.yml regenerate
   it automatically when a GitHub Release is published) and every button on
   the page reflects it on next load — no HTML edits, no redeploying code.

   If the fetch fails for any reason (offline preview, JSON temporarily
   missing), the static defaults already written into index.html stay in
   place — the page never breaks, it just falls back to whatever was last
   published in the markup.
   ============================================================================= */

(function () {
  'use strict';

  fetch('data/releases.json', { cache: 'no-cache' })
    .then(function (res) { if (!res.ok) throw new Error('releases.json ' + res.status); return res.json(); })
    .then(applyReleaseData)
    .catch(function () { /* keep the static fallback content already in the HTML */ });

  function applyReleaseData(data) {
    var version = data.version;
    var windows = data.platforms && data.platforms.windows;

    // Hero badge + primary CTA reflect the flagship (Windows) build.
    var heroBadgeText = document.getElementById('heroBadgeText');
    var heroDownloadBtn = document.getElementById('heroDownloadBtn');
    if (windows && windows.status === 'available' && windows.url) {
      if (heroBadgeText) heroBadgeText.textContent = 'v' + version + ' — Live for Windows';
      if (heroDownloadBtn) heroDownloadBtn.setAttribute('href', windows.url);
    }

    // Footer version.
    var footerVersion = document.getElementById('footerVersion');
    if (footerVersion && version) footerVersion.textContent = 'OmniDeck v' + version;

    // Each platform card in the Downloads section.
    document.querySelectorAll('.download-card[data-platform]').forEach(function (card) {
      var platform = card.getAttribute('data-platform');
      var info = data.platforms && data.platforms[platform];
      if (!info) return;
      applyCardState(card, platform, info, version);
    });
  }

  function applyCardState(card, platform, info, version) {
    var badge = card.querySelector('[data-status-badge]');
    var note = card.querySelector('[data-download-note]');
    var meta = card.querySelector('[data-download-meta]');
    var actionEl = card.querySelector('[data-download-btn], button.btn');
    var isAvailable = info.status === 'available' && !!info.url;

    if (badge) {
      badge.textContent = isAvailable ? 'Ready' : 'Coming soon';
      badge.classList.toggle('badge--ready', isAvailable);
      badge.classList.toggle('badge--soon', !isAvailable);
    }
    if (note && info.note) note.textContent = info.note;
    if (meta) {
      meta.textContent = isAvailable
        ? 'v' + version + (info.size ? ' · ' + info.size : '')
        : (info.note || '');
    }

    if (!actionEl) return;
    var label = isAvailable
      ? 'Download for ' + labelFor(platform)
      : 'Notify me';

    if (isAvailable) {
      var link = ensureAnchor(actionEl);
      link.href = info.url;
      link.textContent = label;
      link.classList.remove('btn--disabled');
      link.classList.add('btn--primary');
      link.removeAttribute('aria-disabled');
      link.removeAttribute('disabled');
    } else {
      var btn = ensureButton(actionEl);
      btn.textContent = label;
      btn.classList.remove('btn--primary');
      btn.classList.add('btn--disabled');
      btn.setAttribute('aria-disabled', 'true');
      btn.setAttribute('disabled', '');
    }
  }

  function labelFor(platform) {
    if (platform === 'windows') return 'Windows';
    if (platform === 'macos') return 'macOS';
    if (platform === 'linux') return 'Linux';
    return platform;
  }

  // Swap a <button> for a real <a> (or vice versa) while keeping classes in
  // sync, so a platform can flip from "coming soon" to "available" purely
  // from data without leaving a disabled-looking button behind.
  function ensureAnchor(el) {
    if (el.tagName === 'A') return el;
    var a = document.createElement('a');
    a.className = el.className + ' btn--full';
    el.replaceWith(a);
    return a;
  }
  function ensureButton(el) {
    if (el.tagName === 'BUTTON') return el;
    var btn = document.createElement('button');
    btn.className = el.className;
    el.replaceWith(btn);
    return btn;
  }
})();
