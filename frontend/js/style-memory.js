// ============================================================================
// FREEFLOW — style memory. Remembers the last formatting the operator used
// for each slide type (and each element "slot" within it — e.g. a scripture
// slide's verse text vs. its reference line are remembered separately), so
// new slides inherit it automatically instead of starting from the
// hard-coded schema defaults every time. Formatting only resets when the
// operator explicitly presses Reset (see resetStyleMemory).
//
// Lives entirely in this browser's localStorage — this is operator/device
// preference, not slide content, so it deliberately does NOT go through
// Firestore (which stays the single source of truth for what's live).
//
// Generic by design: it stores every field on an element/background EXCEPT
// the per-instance ones (id, kind, content, src, lang), so any new
// formatting property added to slide-model.js later is automatically
// remembered too, with no changes needed here.
// ============================================================================

const STORAGE_KEY = 'freeflow_style_memory_v1';

// Fields on an element that are per-instance DATA, not formatting — never
// copied into memory and never overwritten by it.
const ELEMENT_DATA_KEYS = new Set(['id', 'kind', 'content', 'src', 'lang']);

function loadAll() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch (e) {
    console.warn('[FreeFlow] style memory read failed, starting fresh', e);
    return {};
  }
}

function saveAll(all) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
  } catch (e) {
    console.warn('[FreeFlow] style memory write failed (localStorage unavailable?)', e);
  }
}

function elementKey(slideType, elIndex) {
  return `${slideType}::${elIndex}`;
}

// Call after the operator changes an element's formatting (inspector edit,
// drag, resize) so the next slide of this type/slot starts from it.
export function rememberElementStyle(slideType, elIndex, el) {
  const all = loadAll();
  all.elements = all.elements || {};
  const style = {};
  for (const k of Object.keys(el)) {
    if (!ELEMENT_DATA_KEYS.has(k)) style[k] = el[k];
  }
  all.elements[elementKey(slideType, elIndex)] = style;
  saveAll(all);
}

// Call right after creating a new element for a slide, before it's shown —
// merges any remembered formatting on top of the schema defaults.
export function applyRememberedElementStyle(slideType, elIndex, el) {
  const all = loadAll();
  const remembered = all.elements && all.elements[elementKey(slideType, elIndex)];
  if (remembered) Object.assign(el, remembered);
  return el;
}

export function rememberBackground(slideType, background) {
  const all = loadAll();
  all.backgrounds = all.backgrounds || {};
  all.backgrounds[slideType] = { ...background };
  saveAll(all);
}

export function applyRememberedBackground(slideType, background) {
  const all = loadAll();
  const remembered = all.backgrounds && all.backgrounds[slideType];
  if (remembered) Object.assign(background, remembered);
  return background;
}

export function rememberTransition(slideType, transition) {
  const all = loadAll();
  all.transitions = all.transitions || {};
  all.transitions[slideType] = transition;
  saveAll(all);
}

export function applyRememberedTransition(slideType, slide) {
  const all = loadAll();
  const remembered = all.transitions && all.transitions[slideType];
  if (remembered) slide.transition = remembered;
  return slide;
}

// Applies all remembered formatting (elements + background + transition) to
// a freshly-created slide. Call this once, right after building a slide
// from slide-model.js's factories and before adding it to the playlist.
export function applyRememberedStyle(slide) {
  slide.elements.forEach((el, i) => applyRememberedElementStyle(slide.type, i, el));
  applyRememberedBackground(slide.type, slide.background);
  applyRememberedTransition(slide.type, slide);
  return slide;
}

// Clears remembered formatting. Pass a slideType to reset only that type;
// omit it to wipe everything. Only ever called from an explicit Reset
// button — never automatically.
export function resetStyleMemory(slideType) {
  const all = loadAll();
  if (slideType) {
    if (all.elements) {
      for (const k of Object.keys(all.elements)) {
        if (k.startsWith(`${slideType}::`)) delete all.elements[k];
      }
    }
    if (all.backgrounds) delete all.backgrounds[slideType];
    if (all.transitions) delete all.transitions[slideType];
  } else {
    all.elements = {};
    all.backgrounds = {};
    all.transitions = {};
  }
  saveAll(all);
}
