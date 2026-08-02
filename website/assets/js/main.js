/* =============================================================================
   OmniDeck marketing site — interaction layer.

   Deliberately small and framework-free: a sticky header state, a mobile
   menu toggle, the footer year, and the screenshot swap-in described below.
   Nothing here talks to the desktop app or its sync layer — this file only
   ever touches this page's own DOM.
   ============================================================================= */

(function () {
  'use strict';

  // ---- Sticky header state -------------------------------------------------
  var header = document.getElementById('siteHeader');
  var onScroll = function () {
    if (window.scrollY > 8) header.classList.add('is-scrolled');
    else header.classList.remove('is-scrolled');
  };
  onScroll();
  window.addEventListener('scroll', onScroll, { passive: true });

  // ---- Mobile menu ----------------------------------------------------------
  var toggle = document.getElementById('navToggle');
  var mobile = document.getElementById('navMobile');
  if (toggle && mobile) {
    toggle.addEventListener('click', function () {
      var isOpen = mobile.classList.toggle('is-open');
      toggle.setAttribute('aria-expanded', String(isOpen));
    });
    mobile.querySelectorAll('a').forEach(function (link) {
      link.addEventListener('click', function () {
        mobile.classList.remove('is-open');
        toggle.setAttribute('aria-expanded', 'false');
      });
    });
  }

  // ---- Footer year ------------------------------------------------------------
  var yearEl = document.getElementById('footerYear');
  if (yearEl) yearEl.textContent = new Date().getFullYear();

  // ---- Screenshots: swap the drawn placeholder for a real image the moment
  // one successfully loads at the expected path (assets/img/screenshots/*.png).
  // Drop a file in with the matching name and the placeholder disappears on
  // its own — no HTML/CSS edits needed. See website/README.md.
  document.querySelectorAll('img[data-shot]').forEach(function (img) {
    if (img.complete && img.naturalWidth > 0) {
      img.classList.add('is-loaded');
      return;
    }
    img.addEventListener('load', function () {
      if (img.naturalWidth > 0) img.classList.add('is-loaded');
    });
    // A 404 for a not-yet-provided screenshot is expected, not an error to
    // report — the placeholder underneath simply stays visible.
    img.addEventListener('error', function () { /* keep placeholder */ });
  });
})();
