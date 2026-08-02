import { firebaseConfig, LIVE_STATE_PATH, SONGS_COLLECTION, SLIDES_COLLECTION, IMAGES_COLLECTION, VIDEOS_COLLECTION } from './config.js';
import {
  initFirebase, collection, addDoc, deleteDoc, getDocs, getDb, doc
} from './firestore-sync.js';
import { watchLiveState, pushLiveState as sendLiveState, isLocalMode, shareableControllerUrl, fetchOutputUrl } from './sync-provider.js';
import * as Bible from './bible-engine.js';
import {
  newSlide, newElement, scriptureSlide, lyricsSlide, textSlide, imageSlide, videoSlide,
  announcementSlide, lowerThirdSlide, cloneSlide
} from './slide-model.js';
import { paintSlide } from './render-engine.js';
import { attachEditor } from './editor.js';
import { applyRememberedStyle, rememberElementStyle, rememberBackground, rememberTransition, resetStyleMemory } from './style-memory.js';
import {
  listPresentationMeta, createPresentationMeta, patchPresentationMeta, deletePresentation,
  loadPresentationContent, savePresentationContent, touchLastOpened
} from './presentations.js';

// ---------------------------------------------------------------------------
// Config guard
// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// Config guard — only matters for remote/Firestore mode. Local mode (the
// desktop app, ?room=&token= in the URL) never touches Firestore for the
// live state and must work with zero Firebase configuration at all; only
// the optional libraries (songs/images/videos/presentations) need it, and
// those degrade gracefully later (see loadLibraries()) rather than
// blocking the app from booting.
// ---------------------------------------------------------------------------
if (!isLocalMode() && firebaseConfig.apiKey === 'REPLACE_ME') {
  document.getElementById('configErrorScreen').classList.remove('hidden');
  throw new Error('Firebase not configured — see js/config.js');
}
const firestoreConfigured = firebaseConfig.apiKey !== 'REPLACE_ME';

// ---------------------------------------------------------------------------
// Toasts
// ---------------------------------------------------------------------------
window.toast = function (msg, kind = 'info') {
  const host = document.getElementById('toastHost');
  const el = document.createElement('div');
  const colors = { success: 'bg-emerald-600', error: 'bg-rose-600', info: 'bg-slate-800' };
  el.className = `toast ${colors[kind] || colors.info} text-white text-xs font-semibold px-4 py-2 rounded-xl shadow-lg`;
  el.textContent = msg;
  host.appendChild(el);
  setTimeout(() => el.remove(), 3200);
};

// ---------------------------------------------------------------------------
// App state (local, mirrors what gets pushed to Firestore live-state doc)
// ---------------------------------------------------------------------------
const state = {
  version: 0,
  slides: [],
  currentIndex: 0,
  blackout: true,
  selectedIndex: null,     // index into state.slides being edited/previewed
  remoteVersion: 0,
  currentPresentationId: null,   // which library entry (if any) autosaves to
  currentPresentationName: 'Untitled Presentation'
};

let songsLibrary = [];
let textSlideLibrary = [];
let imageLibrary = [];

const currentPresentationNameEl = document.getElementById('currentPresentationName');
function setCurrentPresentationName(name) {
  state.currentPresentationName = name || 'Untitled Presentation';
  currentPresentationNameEl.textContent = state.currentPresentationName;
}

// ---------------------------------------------------------------------------
// Live-state sync — local WebSocket (LAN, zero internet dependency) or
// Firestore (remote), chosen transparently by sync-provider.js.
// ---------------------------------------------------------------------------
const connStripText = document.getElementById('connStripText');
const connStripVersion = document.getElementById('connStripVersion');

function setConn(text, cls) {
  connStripText.textContent = text;
  document.getElementById('connStrip').className = `w-full px-4 py-1.5 text-[10px] font-bold flex items-center justify-between border-b shrink-0 ${cls}`;
}

let suppressIncoming = false; // true while we're the one who just wrote, avoid re-render loop artifacts

watchLiveState((data) => {
  setConn(isLocalMode() ? 'Live — local network, synced to output.html' : 'Live — synced to output.html', 'bg-emerald-50 text-emerald-700 border-emerald-200');
  connStripVersion.textContent = data ? `v${data.version}` : '';
  if (!data) return;
  state.remoteVersion = data.version || 0;
  // Only adopt remote slide/index/blackout on first load (when local is empty) —
  // afterwards THIS controller is the source of truth for edits it makes locally,
  // and pushLiveState() is what keeps the transport in sync going forward.
  if (state.slides.length === 0 && Array.isArray(data.slides)) {
    state.slides = data.slides;
    state.currentIndex = data.currentIndex || 0;
    state.blackout = data.blackout !== false;
    state.currentPresentationId = data.currentPresentationId || null;
    setCurrentPresentationName(data.currentPresentationName);
    renderPlaylist();
    selectSlide(state.currentIndex);
  }
}, { log: (...a) => { console.log('[FreeFlowController]', ...a); setConn('Reconnecting…', 'bg-amber-50 text-amber-700 border-amber-200'); } });

async function pushLiveState(note) {
  state.version += 1;
  await sendLiveState({
    version: state.version,
    slides: state.slides,
    currentIndex: state.currentIndex,
    blackout: state.blackout,
    currentPresentationId: state.currentPresentationId,
    currentPresentationName: state.currentPresentationName
  });
  if (note) toast(note, 'success');
  // Autosave into the presentation library too, so the library entry never
  // drifts from what's actually live — "everything autosaves" applies to
  // both the OBS output AND the saved presentation, from one write path.
  if (state.currentPresentationId) {
    savePresentationContent(state.currentPresentationId, state.slides).catch(e => console.warn('Library autosave failed', e));
  }
}

// ---------------------------------------------------------------------------
// Playlist rendering
// ---------------------------------------------------------------------------
const playlistEl = document.getElementById('playlistEl');
const TYPE_ICON = { scripture: '📖', lyrics: '🎵', text: '📝', image: '🖼️', announcement: '📢', lowerThird: '🏷️' };

function renderPlaylist() {
  playlistEl.innerHTML = '';
  state.slides.forEach((slide, i) => {
    const item = document.createElement('div');
    item.className = `playlist-item border rounded-lg p-2 text-xs cursor-pointer bg-white flex items-center gap-2 ${i === state.currentIndex && !state.blackout ? 'live' : ''} ${i === state.selectedIndex ? 'selected' : ''}`;
    item.draggable = true;
    item.dataset.index = i;
    item.innerHTML = `<span>${TYPE_ICON[slide.type] || '•'}</span><span class="flex-1 truncate">${escapeHTML(slide.label || slide.type)}</span>`;
    item.addEventListener('click', () => { goLive(i); });
    item.addEventListener('dblclick', () => selectSlide(i));
    item.addEventListener('dragstart', (e) => e.dataTransfer.setData('text/plain', String(i)));
    item.addEventListener('dragover', (e) => e.preventDefault());
    item.addEventListener('drop', (e) => {
      e.preventDefault();
      const from = parseInt(e.dataTransfer.getData('text/plain'), 10);
      reorderSlide(from, i);
    });
    playlistEl.appendChild(item);
  });
}

function reorderSlide(from, to) {
  if (from === to) return;
  const [moved] = state.slides.splice(from, 1);
  state.slides.splice(to, 0, moved);
  if (state.currentIndex === from) state.currentIndex = to;
  renderPlaylist();
  pushLiveState();
}

function addSlideToPlaylist(slide, { goLiveNow = false } = {}) {
  applyRememberedStyle(slide); // inherit the last formatting used for this slide type, per element slot
  state.slides.push(slide);
  renderPlaylist();
  selectSlide(state.slides.length - 1);
  pushLiveState('Added to playlist');
  if (goLiveNow) goLive(state.slides.length - 1);
}

function goLive(i) {
  state.currentIndex = i;
  state.blackout = false;
  selectSlide(i);
  renderPlaylist();
  pushLiveState();
}

function navigate(dir) {
  if (state.slides.length === 0) return;
  const next = Math.max(0, Math.min(state.slides.length - 1, state.currentIndex + dir));
  goLive(next);
}

function toggleBlackout() {
  state.blackout = !state.blackout;
  renderPlaylist();
  pushLiveState();
}

document.getElementById('btnNext').addEventListener('click', () => navigate(1));
document.getElementById('btnPrev').addEventListener('click', () => navigate(-1));
document.getElementById('btnBlackout').addEventListener('click', toggleBlackout);
document.getElementById('btnDeleteSlide').addEventListener('click', () => {
  if (state.selectedIndex == null) return;
  state.slides.splice(state.selectedIndex, 1);
  state.selectedIndex = null;
  renderPlaylist();
  paintPreview();
  pushLiveState('Slide deleted');
});

window.addEventListener('keydown', (e) => {
  if (['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName)) return;
  if (e.key === 'ArrowRight' || e.key === ' ') { e.preventDefault(); navigate(1); }
  if (e.key === 'ArrowLeft') { e.preventDefault(); navigate(-1); }
  if (e.key === 'b' || e.key === 'B') toggleBlackout();
});

// ---------------------------------------------------------------------------
// Preview canvas + editor
// ---------------------------------------------------------------------------
const previewStage = document.getElementById('previewStage');
let editor;

function currentSlide() {
  return state.selectedIndex != null ? state.slides[state.selectedIndex] : null;
}

function paintPreview() {
  const slide = currentSlide();
  paintSlide(previewStage, slide, { interactive: editor ? editor.interactive : undefined });
  refreshInspectorFromSlide();
}

editor = attachEditor(previewStage, currentSlide, () => { paintPreview(); rememberCurrentElementStyle(); pushLiveStateDebounced(); }, (elId) => {
  refreshInspectorFromSlide(elId);
});

// Persists the currently-selected element's formatting (position, size,
// font, colors, etc.) so the next slide of this type/slot inherits it.
// Shared by drag/resize (editor.js) and the inspector fields below.
function rememberCurrentElementStyle() {
  const slide = currentSlide();
  const el = getSelectedElement();
  if (!slide || !el) return;
  const idx = slide.elements.findIndex(e => e.id === el.id);
  if (idx !== -1) rememberElementStyle(slide.type, idx, el);
}

function selectSlide(i) {
  state.selectedIndex = i;
  renderPlaylist();
  paintPreview();
}

// Debounce Firestore writes while dragging so we don't spam writes every pixel.
let pushTimer = null;
function pushLiveStateDebounced() {
  clearTimeout(pushTimer);
  pushTimer = setTimeout(() => pushLiveState(), 180);
}

// ---------------------------------------------------------------------------
// Inspector — background
// ---------------------------------------------------------------------------
const bgMode = document.getElementById('bgMode');
const bgColor = document.getElementById('bgColor');
const bgGradFrom = document.getElementById('bgGradFrom');
const bgGradTo = document.getElementById('bgGradTo');
const bgGradAngle = document.getElementById('bgGradAngle');
const bgImageUrl = document.getElementById('bgImageUrl');

function refreshBgRows() {
  document.getElementById('bgColorRow').classList.toggle('hidden', bgMode.value !== 'color');
  document.getElementById('bgGradientRow').classList.toggle('hidden', bgMode.value !== 'gradient');
  document.getElementById('bgImageRow').classList.toggle('hidden', bgMode.value !== 'image');
}

function applyBgFromInspector() {
  const slide = currentSlide();
  if (!slide) return;
  slide.background = {
    mode: bgMode.value,
    color: bgColor.value,
    gradientFrom: bgGradFrom.value,
    gradientTo: bgGradTo.value,
    gradientAngle: parseInt(bgGradAngle.value, 10),
    imageUrl: bgImageUrl.value,
    imageFit: 'cover'
  };
  rememberBackground(slide.type, slide.background);
  paintPreview();
  pushLiveStateDebounced();
}
[bgMode, bgColor, bgGradFrom, bgGradTo, bgGradAngle, bgImageUrl].forEach(el => {
  el.addEventListener('input', () => { refreshBgRows(); applyBgFromInspector(); });
});

// ---------------------------------------------------------------------------
// Inspector — selected element
// ---------------------------------------------------------------------------
const elInspector = document.getElementById('elementInspector');
const elFieldsText = document.getElementById('fieldsText');
const elFieldsMedia = document.getElementById('fieldsMedia');
const elFieldsVideo = document.getElementById('fieldsVideo');
const elFieldsShape = document.getElementById('fieldsShape');
const elContent = document.getElementById('elContent');
const elFont = document.getElementById('elFont');
const elWeight = document.getElementById('elWeight');
const elFontSize = document.getElementById('elFontSize');
const elLetterSpacing = document.getElementById('elLetterSpacing');
const elOpacity = document.getElementById('elOpacity');
const elColor = document.getElementById('elColor');
const elX = document.getElementById('elX'), elY = document.getElementById('elY'), elW = document.getElementById('elW'), elH = document.getElementById('elH');
const elGlow = document.getElementById('elGlow'), elGlowColor = document.getElementById('elGlowColor');
const elOutline = document.getElementById('elOutline'), elOutlineColor = document.getElementById('elOutlineColor');
const elShadow = document.getElementById('elShadow'), elShadowColor = document.getElementById('elShadowColor');
const elImageFit = document.getElementById('elImageFit');
const elAutoplay = document.getElementById('elAutoplay'), elLoop = document.getElementById('elLoop'), elMuted = document.getElementById('elMuted'), elVolume = document.getElementById('elVolume');
const elShapeType = document.getElementById('elShapeType'), elFill = document.getElementById('elFill'), elStroke = document.getElementById('elStroke'), elStrokeWidth = document.getElementById('elStrokeWidth'), elCornerRadius = document.getElementById('elCornerRadius');

function getSelectedElement() {
  const slide = currentSlide();
  if (!slide || !editor) return null;
  const id = editor.getSelectedId();
  return slide.elements.find(e => e.id === id) || null;
}

function refreshInspectorFromSlide() {
  const slide = currentSlide();
  if (slide) {
    bgMode.value = slide.background.mode;
    bgColor.value = slide.background.color;
    bgGradFrom.value = slide.background.gradientFrom;
    bgGradTo.value = slide.background.gradientTo;
    bgGradAngle.value = slide.background.gradientAngle;
    bgImageUrl.value = slide.background.imageUrl || '';
    refreshBgRows();
    document.getElementById('transitionSelect').value = slide.transition || 'fade';
  }

  const el = getSelectedElement();
  elInspector.classList.toggle('hidden', !el);
  if (!el) return;

  // Show only the sections relevant to this component's kind (see
  // component-types.js for the registry this mirrors).
  const isMedia = el.kind === 'image' || el.kind === 'video';
  elFieldsText.classList.toggle('hidden', isMedia || el.kind === 'shape');
  elFieldsMedia.classList.toggle('hidden', !isMedia);
  elFieldsVideo.classList.toggle('hidden', el.kind !== 'video');
  elFieldsShape.classList.toggle('hidden', el.kind !== 'shape');

  elContent.value = el.content || '';
  elFont.value = el.font;
  elWeight.value = el.weight;
  elFontSize.value = el.fontSize;
  elLetterSpacing.value = el.letterSpacing;
  elOpacity.value = el.opacity;
  elColor.value = el.color;
  elX.value = Math.round(el.x); elY.value = Math.round(el.y); elW.value = Math.round(el.w); elH.value = Math.round(el.h);
  elGlow.value = el.glow; elGlowColor.value = el.glowColor;
  elOutline.value = el.outlineWidth; elOutlineColor.value = el.outlineColor;
  elShadow.value = el.shadowBlur; elShadowColor.value = el.shadowColor;
  elImageFit.value = el.imageFit || 'contain';
  elAutoplay.checked = el.autoplay !== false;
  elLoop.checked = el.loop !== false;
  elMuted.checked = el.muted !== false;
  elVolume.value = el.volume ?? 1;
  elShapeType.value = el.shapeType || 'rectangle';
  elFill.value = el.fill || '#ffffff';
  elStroke.value = el.stroke && el.stroke !== 'transparent' ? el.stroke : '#000000';
  elStrokeWidth.value = el.strokeWidth || 0;
  elCornerRadius.value = el.cornerRadius || 0;
  document.querySelectorAll('.align-btn').forEach(b => b.classList.toggle('bg-emerald-600', b.dataset.align === el.align));
  document.querySelectorAll('.valign-btn').forEach(b => b.classList.toggle('bg-emerald-600', b.dataset.valign === el.verticalAlign));
}

function applyElFromInspector() {
  const el = getSelectedElement();
  if (!el) return;
  el.content = elContent.value;
  el.font = elFont.value;
  el.weight = elWeight.value;
  el.fontSize = parseFloat(elFontSize.value);
  el.letterSpacing = parseFloat(elLetterSpacing.value);
  el.opacity = parseFloat(elOpacity.value);
  el.color = elColor.value;
  el.x = parseFloat(elX.value); el.y = parseFloat(elY.value); el.w = parseFloat(elW.value); el.h = parseFloat(elH.value);
  el.glow = parseFloat(elGlow.value); el.glowColor = elGlowColor.value;
  el.outlineWidth = parseFloat(elOutline.value); el.outlineColor = elOutlineColor.value;
  el.shadowBlur = parseFloat(elShadow.value); el.shadowColor = elShadowColor.value;
  el.imageFit = elImageFit.value;
  el.autoplay = elAutoplay.checked;
  el.loop = elLoop.checked;
  el.muted = elMuted.checked;
  el.volume = parseFloat(elVolume.value);
  el.shapeType = elShapeType.value;
  el.fill = elFill.value;
  el.stroke = elStroke.value;
  el.strokeWidth = parseFloat(elStrokeWidth.value);
  el.cornerRadius = parseFloat(elCornerRadius.value);
  rememberCurrentElementStyle();
  paintPreview();
  editor.refreshHandles();
  pushLiveStateDebounced();
}
[elContent, elFont, elWeight, elFontSize, elLetterSpacing, elOpacity, elColor, elX, elY, elW, elH, elGlow, elGlowColor, elOutline, elOutlineColor, elShadow, elShadowColor,
 elImageFit, elAutoplay, elLoop, elMuted, elVolume, elShapeType, elFill, elStroke, elStrokeWidth, elCornerRadius]
  .forEach(el => el.addEventListener('input', applyElFromInspector));

document.querySelectorAll('.align-btn').forEach(b => b.addEventListener('click', () => {
  const el = getSelectedElement(); if (!el) return;
  el.align = b.dataset.align; applyElFromInspector(); refreshInspectorFromSlide();
}));
document.querySelectorAll('.valign-btn').forEach(b => b.addEventListener('click', () => {
  const el = getSelectedElement(); if (!el) return;
  el.verticalAlign = b.dataset.valign; applyElFromInspector(); refreshInspectorFromSlide();
}));

document.getElementById('btnAddTextBox').addEventListener('click', () => {
  const slide = currentSlide(); if (!slide) { toast('Select a slide first', 'error'); return; }
  const el = newElement({ content: 'New text' });
  slide.elements.push(el);
  paintPreview();
  editor.select(el.id);
  refreshInspectorFromSlide();
  pushLiveStateDebounced();
});
document.getElementById('btnAddShape').addEventListener('click', () => {
  const slide = currentSlide(); if (!slide) { toast('Select a slide first', 'error'); return; }
  const el = newElement({ kind: 'shape', x: 30, y: 30, w: 40, h: 40 });
  slide.elements.push(el);
  paintPreview();
  editor.select(el.id);
  refreshInspectorFromSlide();
  pushLiveStateDebounced();
});
document.getElementById('btnDeleteElement').addEventListener('click', () => {
  const slide = currentSlide(); const el = getSelectedElement();
  if (!slide || !el) return;
  slide.elements = slide.elements.filter(e => e.id !== el.id);
  editor.select(null);
  paintPreview();
  pushLiveStateDebounced();
});

document.getElementById('transitionSelect').addEventListener('change', (e) => {
  const slide = currentSlide(); if (!slide) return;
  slide.transition = e.target.value;
  rememberTransition(slide.type, slide.transition);
  pushLiveStateDebounced();
});

// ---------------------------------------------------------------------------
// Reset Formatting — regenerates the CURRENT slide's elements/background/
// transition from that type's original factory defaults (keeping its actual
// content/label), and clears remembered style so future slides of this type
// go back to defaults too, until customized again.
// ---------------------------------------------------------------------------
function rebuildSlideDefaults(slide) {
  const meta = slide.meta || {};
  switch (slide.type) {
    case 'scripture':
      return scriptureSlide({ reference: meta.reference, translationAbbr: meta.translationAbbr, language: meta.language, text: slide.elements[0]?.content || '' });
    case 'lyrics':
      return lyricsSlide({ songTitle: meta.songTitle, artist: meta.artist, lineText: slide.elements[0]?.content || '', lang: slide.elements[0]?.lang || 'en' });
    case 'text':
      return textSlide({ label: slide.label, content: slide.elements[0]?.content || '' });
    case 'image':
      return imageSlide({ label: slide.label, src: slide.elements[0]?.src || '' });
    case 'video':
      return videoSlide({ label: slide.label, src: slide.elements[0]?.src || '' });
    case 'announcement':
      return announcementSlide({ label: slide.label, title: slide.elements[0]?.content || '', body: slide.elements[1]?.content || '' });
    case 'lowerThird':
      return lowerThirdSlide({ label: slide.label, title: slide.elements[0]?.content || '', subtitle: slide.elements[1]?.content || '' });
    default:
      return newSlide(slide.type);
  }
}

document.getElementById('btnResetFormatting').addEventListener('click', () => {
  const slide = currentSlide();
  if (!slide) { toast('Select a slide first', 'error'); return; }
  resetStyleMemory(slide.type);
  const fresh = rebuildSlideDefaults(slide);
  slide.elements = fresh.elements;
  slide.background = fresh.background;
  slide.transition = fresh.transition;
  editor.select(null);
  paintPreview();
  pushLiveStateDebounced();
  toast('Formatting reset to defaults', 'success');
});

// ---------------------------------------------------------------------------
// Tabs
// ---------------------------------------------------------------------------
document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    document.querySelectorAll('.tab-panel').forEach(p => p.classList.add('hidden'));
    document.querySelector(`.tab-panel[data-panel="${btn.dataset.tab}"]`).classList.remove('hidden');
  });
});

// ---------------------------------------------------------------------------
// Bible tab
// ---------------------------------------------------------------------------
const bibleTranslation = document.getElementById('bibleTranslation');
const bibleBookSelect = document.getElementById('bibleBookSelect');
const bibleChapterSelect = document.getElementById('bibleChapterSelect');
const bibleResults = document.getElementById('bibleResults');
const bibleSearchInput = document.getElementById('bibleSearchInput');

async function initBible() {
  Bible.listTranslations().forEach(t => {
    const opt = document.createElement('option');
    opt.value = t.code; opt.textContent = t.label;
    bibleTranslation.appendChild(opt);
  });
  await loadCurrentTranslation();
}

async function loadCurrentTranslation() {
  const code = bibleTranslation.value;
  await Bible.loadTranslation(code);
  bibleBookSelect.innerHTML = '';
  Bible.getBooks(code).forEach(b => {
    const opt = document.createElement('option');
    opt.value = b; opt.textContent = b;
    bibleBookSelect.appendChild(opt);
  });
  refreshChapters();
}
function refreshChapters() {
  const code = bibleTranslation.value, book = bibleBookSelect.value;
  bibleChapterSelect.innerHTML = '';
  const count = Bible.getChapterCount(code, book);
  for (let c = 1; c <= count; c++) {
    const opt = document.createElement('option');
    opt.value = c; opt.textContent = `Chapter ${c}`;
    bibleChapterSelect.appendChild(opt);
  }
}
bibleTranslation.addEventListener('change', loadCurrentTranslation);
bibleBookSelect.addEventListener('change', refreshChapters);

function renderVerseResults(code, verses, book, chapter) {
  bibleResults.innerHTML = '';
  const t = Bible.listTranslations().find(x => x.code === code);
  verses.forEach(v => {
    const card = document.createElement('div');
    card.className = 'border rounded-lg p-2 text-xs bg-slate-50 hover:bg-emerald-50 cursor-pointer';
    card.innerHTML = `<b>${book} ${chapter}:${v.verse}</b> — ${escapeHTML(v.text.slice(0, 90))}${v.text.length > 90 ? '…' : ''}`;
    card.addEventListener('click', () => {
      const reference = Bible.formatReference(book, chapter, v.verse, v.verse);
      const slide = scriptureSlide({ reference, translationAbbr: t.abbr, language: Bible.listTranslations().find(x=>x.code===code) ? (code === 'te' ? 'te' : 'en') : 'en', text: v.text.replace(/\{|\}/g, '') });
      addSlideToPlaylist(slide);
    });
    bibleResults.appendChild(card);
  });
}

document.getElementById('btnBibleGo').addEventListener('click', () => {
  const code = bibleTranslation.value, book = bibleBookSelect.value, chapter = parseInt(bibleChapterSelect.value, 10);
  const verses = Bible.getChapter(code, book, chapter);
  renderVerseResults(code, verses, book, chapter);
});

bibleSearchInput.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter') return;
  const code = bibleTranslation.value;
  const parsed = Bible.parseReference(code, bibleSearchInput.value);
  if (!parsed) { toast('Could not parse reference', 'error'); return; }
  bibleBookSelect.value = parsed.book;
  refreshChapters();
  bibleChapterSelect.value = parsed.chapter;
  if (parsed.whole) {
    renderVerseResults(code, Bible.getChapter(code, parsed.book, parsed.chapter), parsed.book, parsed.chapter);
  } else {
    const verses = Bible.getVerseRange(code, parsed.book, parsed.chapter, parsed.verseStart, parsed.verseEnd);
    renderVerseResults(code, verses, parsed.book, parsed.chapter);
  }
});

// ---------------------------------------------------------------------------
// Songs tab (persisted in Firestore SONGS_COLLECTION)
// ---------------------------------------------------------------------------
const songList = document.getElementById('songList');
const songModal = document.getElementById('songModal');

async function loadSongs() {
  const db = getDb();
  const snap = await getDocs(collection(db, ...SONGS_COLLECTION));
  songsLibrary = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  renderSongList();
}
function renderSongList() {
  songList.innerHTML = '';
  songsLibrary.forEach(song => {
    const row = document.createElement('div');
    row.className = 'border rounded-lg p-2 text-xs bg-slate-50 flex items-center gap-2';
    row.innerHTML = `<span class="flex-1 truncate font-semibold">${escapeHTML(song.title)}</span>
      <button class="btnLoadSong text-emerald-700 font-bold">Add</button>
      <button class="btnDeleteSong text-rose-600 font-bold">✕</button>`;
    row.querySelector('.btnLoadSong').addEventListener('click', () => {
      const lang = 'en';
      const lines = (song.lyrics || '').split('\n').filter(l => l.trim());
      lines.forEach(line => addSlideToPlaylist(lyricsSlide({ songTitle: song.title, artist: song.artist, lineText: line, lang }), {}));
      toast(`${lines.length} slides added from "${song.title}"`, 'success');
    });
    row.querySelector('.btnDeleteSong').addEventListener('click', async () => {
      if (!confirm(`Delete "${song.title}"?`)) return;
      await deleteDoc(doc(getDb(), ...SONGS_COLLECTION, song.id));
      await loadSongs();
      toast('Song deleted', 'success');
    });
    songList.appendChild(row);
  });
}
document.getElementById('btnNewSong').addEventListener('click', () => {
  document.getElementById('songTitleInput').value = '';
  document.getElementById('songArtistInput').value = '';
  document.getElementById('songLyricsInput').value = '';
  songModal.classList.remove('hidden'); songModal.classList.add('flex');
});
document.getElementById('btnCancelSong').addEventListener('click', () => {
  songModal.classList.add('hidden'); songModal.classList.remove('flex');
});
document.getElementById('btnSaveSong').addEventListener('click', async () => {
  const title = document.getElementById('songTitleInput').value.trim();
  if (!title) { toast('Title required', 'error'); return; }
  const song = {
    title,
    artist: document.getElementById('songArtistInput').value.trim(),
    lyrics: document.getElementById('songLyricsInput').value
  };
  await addDoc(collection(getDb(), ...SONGS_COLLECTION), song);
  await loadSongs();
  songModal.classList.add('hidden'); songModal.classList.remove('flex');
  toast('Song saved', 'success');
});

// ---------------------------------------------------------------------------
// Text slide library tab
// ---------------------------------------------------------------------------
document.getElementById('btnAddTextSlide').addEventListener('click', () => {
  const label = document.getElementById('textSlideLabel').value.trim() || 'Text Slide';
  const content = document.getElementById('textSlideContent').value.trim();
  if (!content) { toast('Content required', 'error'); return; }
  addSlideToPlaylist(textSlide({ label, content }));
  document.getElementById('textSlideLabel').value = '';
  document.getElementById('textSlideContent').value = '';
});

// ---------------------------------------------------------------------------
// Images tab (Firebase Storage upload optional; URL always works)
// ---------------------------------------------------------------------------
document.getElementById('btnAddImageSlide').addEventListener('click', async () => {
  const label = document.getElementById('imageLabel').value.trim() || 'Image';
  const file = document.getElementById('imageFile').files[0];
  let url = document.getElementById('imageUrl').value.trim();

  if (file) {
    try {
      const { getStorage, ref: storageRef, uploadBytes, getDownloadURL } = await import('https://www.gstatic.com/firebasejs/11.6.1/firebase-storage.js');
      const storage = getStorage();
      const path = `freeflow-images/${Date.now()}_${file.name}`;
      const sRef = storageRef(storage, path);
      await uploadBytes(sRef, file);
      url = await getDownloadURL(sRef);
    } catch (e) {
      toast(`Upload failed: ${e.message}. Falling back to URL field.`, 'error');
    }
  }
  if (!url) { toast('Provide an image URL or file', 'error'); return; }

  try {
    await addDoc(collection(getDb(), ...IMAGES_COLLECTION), { label, url });
    await loadImages();
  } catch (e) {
    console.warn('Saving to image library failed (Firestore rules?)', e);
  }

  addSlideToPlaylist(imageSlide({ label, src: url }));
  document.getElementById('imageLabel').value = '';
  document.getElementById('imageUrl').value = '';
  document.getElementById('imageFile').value = '';
});

// ---------------------------------------------------------------------------
// Image library (persisted in Firestore IMAGES_COLLECTION) — mirrors the
// Songs tab so an uploaded/linked image can be reused across services
// instead of only ever being usable once. (IMAGES_COLLECTION was already
// imported and `imageLibrary` already declared above, but nothing populated
// or rendered them — the list in the Images tab was always empty.)
// ---------------------------------------------------------------------------
const imageListEl = document.getElementById('imageList');
async function loadImages() {
  const db = getDb();
  const snap = await getDocs(collection(db, ...IMAGES_COLLECTION));
  imageLibrary = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  renderImageList();
}
function renderImageList() {
  imageListEl.innerHTML = '';
  imageLibrary.forEach(image => {
    const row = document.createElement('div');
    row.className = 'border rounded-lg p-2 text-xs bg-slate-50 flex items-center gap-2';
    row.innerHTML = `<span class="flex-1 truncate font-semibold">${escapeHTML(image.label || 'Image')}</span>
      <button class="btnLoadImage text-emerald-700 font-bold">Add</button>
      <button class="btnDeleteImage text-rose-600 font-bold">✕</button>`;
    row.querySelector('.btnLoadImage').addEventListener('click', () => {
      addSlideToPlaylist(imageSlide({ label: image.label, src: image.url }));
    });
    row.querySelector('.btnDeleteImage').addEventListener('click', async () => {
      if (!confirm(`Remove "${image.label}" from the library? (This does not delete the uploaded file itself.)`)) return;
      await deleteDoc(doc(getDb(), ...IMAGES_COLLECTION, image.id));
      await loadImages();
      toast('Removed from image library', 'success');
    });
    imageListEl.appendChild(row);
  });
}

// ---------------------------------------------------------------------------
// Video tab — same pattern as Images: Storage upload optional, URL always
// works, saved into a reusable library (VIDEOS_COLLECTION).
// ---------------------------------------------------------------------------
document.getElementById('btnAddVideoSlide').addEventListener('click', async () => {
  const label = document.getElementById('videoLabel').value.trim() || 'Video';
  const file = document.getElementById('videoFile').files[0];
  let url = document.getElementById('videoUrl').value.trim();

  if (file) {
    try {
      const { getStorage, ref: storageRef, uploadBytes, getDownloadURL } = await import('https://www.gstatic.com/firebasejs/11.6.1/firebase-storage.js');
      const storage = getStorage();
      const path = `freeflow-videos/${Date.now()}_${file.name}`;
      const sRef = storageRef(storage, path);
      await uploadBytes(sRef, file);
      url = await getDownloadURL(sRef);
    } catch (e) {
      toast(`Upload failed: ${e.message}. Falling back to URL field.`, 'error');
    }
  }
  if (!url) { toast('Provide a video URL or file', 'error'); return; }

  try {
    await addDoc(collection(getDb(), ...VIDEOS_COLLECTION), { label, url });
    await loadVideos();
  } catch (e) {
    console.warn('Saving to video library failed (Firestore rules?)', e);
  }

  addSlideToPlaylist(videoSlide({ label, src: url }));
  document.getElementById('videoLabel').value = '';
  document.getElementById('videoUrl').value = '';
  document.getElementById('videoFile').value = '';
});

let videoLibrary = [];
const videoListEl = document.getElementById('videoList');
async function loadVideos() {
  const db = getDb();
  const snap = await getDocs(collection(db, ...VIDEOS_COLLECTION));
  videoLibrary = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  renderVideoList();
}
function renderVideoList() {
  videoListEl.innerHTML = '';
  videoLibrary.forEach(video => {
    const row = document.createElement('div');
    row.className = 'border rounded-lg p-2 text-xs bg-slate-50 flex items-center gap-2';
    row.innerHTML = `<span class="flex-1 truncate font-semibold">${escapeHTML(video.label || 'Video')}</span>
      <button class="btnLoadVideo text-emerald-700 font-bold">Add</button>
      <button class="btnDeleteVideo text-rose-600 font-bold">✕</button>`;
    row.querySelector('.btnLoadVideo').addEventListener('click', () => {
      addSlideToPlaylist(videoSlide({ label: video.label, src: video.url }));
    });
    row.querySelector('.btnDeleteVideo').addEventListener('click', async () => {
      if (!confirm(`Remove "${video.label}" from the library? (This does not delete the uploaded file itself.)`)) return;
      await deleteDoc(doc(getDb(), ...VIDEOS_COLLECTION, video.id));
      await loadVideos();
      toast('Removed from video library', 'success');
    });
    videoListEl.appendChild(row);
  });
}

// ---------------------------------------------------------------------------
// Announcements / Lower thirds tab
// ---------------------------------------------------------------------------
document.getElementById('btnAddAnn').addEventListener('click', () => {
  const title = document.getElementById('annTitle').value.trim();
  const body = document.getElementById('annBody').value.trim();
  if (!title && !body) { toast('Enter a title or body', 'error'); return; }
  addSlideToPlaylist(announcementSlide({ label: title || 'Announcement', title, body }));
  document.getElementById('annTitle').value = ''; document.getElementById('annBody').value = '';
});
document.getElementById('btnAddLowerThird').addEventListener('click', () => {
  const title = document.getElementById('ltTitle').value.trim();
  const subtitle = document.getElementById('ltSubtitle').value.trim();
  if (!title) { toast('Title required', 'error'); return; }
  addSlideToPlaylist(lowerThirdSlide({ label: title, title, subtitle }));
  document.getElementById('ltTitle').value = ''; document.getElementById('ltSubtitle').value = '';
});

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------
function escapeHTML(str) {
  return String(str).replace(/[&<>'"]/g, tag => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[tag] || tag));
}

function timeAgo(ts) {
  if (!ts) return '—';
  const s = Math.max(1, Math.floor((Date.now() - ts) / 1000));
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

// ---------------------------------------------------------------------------
// Presentation Library — create/open/rename/duplicate/delete saved
// presentations, independent of whatever's currently live. See
// js/presentations.js for the Firestore layer (why metadata and slide
// content are two separate collections) and config.js for the collection
// paths. Opening a presentation replaces state.slides (what's live) —
// output.html itself needs no changes at all, it just keeps watching the
// same live-state doc as always.
// ---------------------------------------------------------------------------
const libraryModal = document.getElementById('libraryModal');
const libGrid = document.getElementById('libGrid');
const libEmpty = document.getElementById('libEmpty');
const libFoldersEl = document.getElementById('libFolders');
const libSearch = document.getElementById('libSearch');
const libSort = document.getElementById('libSort');
const libFavToggle = document.getElementById('libFavToggle');

let libraryMeta = [];
let libFavOnly = false;
let libFolderFilter = null;

function openLibrary() {
  if (!firestoreConfigured) {
    toast('The presentation library needs Firestore configured — fill in js/config.js to enable it', 'error');
    return;
  }
  libraryModal.classList.remove('hidden');
  libraryModal.classList.add('flex');
  refreshLibrary();
}
function closeLibrary() {
  libraryModal.classList.add('hidden');
  libraryModal.classList.remove('flex');
}
document.getElementById('btnOpenLibrary').addEventListener('click', openLibrary);
document.getElementById('btnCloseLibrary').addEventListener('click', closeLibrary);
libraryModal.addEventListener('click', (e) => { if (e.target === libraryModal) closeLibrary(); });

async function refreshLibrary() {
  try {
    libraryMeta = await listPresentationMeta();
  } catch (e) {
    console.warn('Loading presentation library failed (Firestore rules?)', e);
    libraryMeta = [];
  }
  renderLibraryFolders();
  renderLibraryGrid();
}

// Folder is a simple flat tag (not a nested tree) — churches rarely need
// more than one level, and a flat tag avoids a second collection to keep in
// sync. Chips are derived from whatever folder names are actually in use.
function renderLibraryFolders() {
  const folders = [...new Set(libraryMeta.map(p => p.folder).filter(Boolean))].sort();
  libFoldersEl.innerHTML = '';
  libFoldersEl.classList.toggle('hidden', folders.length === 0);
  if (folders.length === 0) return;
  const makeChip = (label, value) => {
    const b = document.createElement('button');
    b.textContent = label;
    b.className = `px-2 py-1 rounded-full border ${libFolderFilter === value ? 'bg-emerald-600 text-white border-emerald-600' : 'border-slate-200'}`;
    b.addEventListener('click', () => { libFolderFilter = value; renderLibraryFolders(); renderLibraryGrid(); });
    libFoldersEl.appendChild(b);
  };
  makeChip('All', null);
  folders.forEach(f => makeChip(f, f));
}

function renderLibraryGrid() {
  const q = libSearch.value.trim().toLowerCase();
  let list = libraryMeta.filter(p =>
    (!q || (p.name || '').toLowerCase().includes(q)) &&
    (!libFavOnly || p.favorite) &&
    (!libFolderFilter || p.folder === libFolderFilter)
  );
  const sortField = { recent: 'lastOpenedAt', updated: 'updatedAt', created: 'createdAt' }[libSort.value];
  list = sortField
    ? list.slice().sort((a, b) => (b[sortField] || 0) - (a[sortField] || 0))
    : list.slice().sort((a, b) => (a.name || '').localeCompare(b.name || ''));

  libGrid.innerHTML = '';
  libEmpty.classList.toggle('hidden', list.length > 0);
  libGrid.classList.toggle('hidden', list.length === 0);
  list.forEach(p => libGrid.appendChild(buildLibraryCard(p)));
}

function buildLibraryCard(p) {
  const card = document.createElement('div');
  card.className = `border rounded-xl overflow-hidden bg-slate-50 hover:shadow-md transition-shadow group ${p.id === state.currentPresentationId ? 'ring-2 ring-emerald-500' : ''}`;

  // Real thumbnail, not a screenshot: the metadata doc carries a tiny
  // snapshot of the first slide's background + first element (see
  // savePresentationContent), and we paint it with the SAME render-engine
  // used for preview/output — accurate, and cheap since it's just DOM/CSS.
  const thumbWrap = document.createElement('div');
  thumbWrap.className = 'ff-stage aspect-video cursor-pointer checkered';
  thumbWrap.addEventListener('click', () => openPresentation(p.id, p.name));
  if (p.thumb) paintSlide(thumbWrap, p.thumb);
  card.appendChild(thumbWrap);

  const body = document.createElement('div');
  body.className = 'p-2';
  body.innerHTML = `
    <div class="text-xs font-bold truncate flex items-center gap-1">
      <button class="btnFav shrink-0">${p.favorite ? '⭐' : '☆'}</button>
      <span class="truncate">${escapeHTML(p.name || 'Untitled')}</span>
    </div>
    <div class="text-[10px] text-slate-400">${p.slideCount || 0} slides · ${timeAgo(p.updatedAt)}</div>
    <div class="grid grid-cols-4 gap-1 pt-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
      <button class="btnRename text-[10px] border rounded py-1">Rename</button>
      <button class="btnDup text-[10px] border rounded py-1">Dup</button>
      <button class="btnDel text-[10px] border border-rose-200 text-rose-600 rounded py-1 col-span-2">Delete</button>
    </div>`;
  card.appendChild(body);

  body.querySelector('.btnFav').addEventListener('click', async (e) => {
    e.stopPropagation();
    await patchPresentationMeta(p.id, { favorite: !p.favorite });
    refreshLibrary();
  });
  body.querySelector('.btnRename').addEventListener('click', async (e) => {
    e.stopPropagation();
    const name = prompt('Rename presentation:', p.name);
    if (!name) return;
    await patchPresentationMeta(p.id, { name });
    if (p.id === state.currentPresentationId) { setCurrentPresentationName(name); pushLiveStateDebounced(); }
    refreshLibrary();
  });
  body.querySelector('.btnDup').addEventListener('click', async (e) => {
    e.stopPropagation();
    const slides = await loadPresentationContent(p.id);
    const newId = await createPresentationMeta(`${p.name} copy`);
    await savePresentationContent(newId, slides.map(cloneSlide)); // fresh ids, no cross-talk with the original
    toast('Presentation duplicated', 'success');
    refreshLibrary();
  });
  body.querySelector('.btnDel').addEventListener('click', async (e) => {
    e.stopPropagation();
    if (!confirm(`Delete "${p.name}"? This can't be undone.`)) return;
    await deletePresentation(p.id);
    if (p.id === state.currentPresentationId) {
      state.currentPresentationId = null;
      setCurrentPresentationName('Untitled Presentation');
      pushLiveStateDebounced();
    }
    toast('Presentation deleted', 'success');
    refreshLibrary();
  });

  return card;
}

async function openPresentation(id, name) {
  const slides = await loadPresentationContent(id);
  state.slides = slides;
  state.currentIndex = 0;
  state.currentPresentationId = id;
  setCurrentPresentationName(name);
  renderPlaylist();
  selectSlide(slides.length ? 0 : null);
  pushLiveState('Opened presentation');
  touchLastOpened(id).catch(() => {});
  closeLibrary();
}

document.getElementById('btnNewPresentation').addEventListener('click', async () => {
  const name = prompt('Name this presentation:', 'New Presentation');
  if (!name) return;
  const id = await createPresentationMeta(name);
  state.slides = [];
  state.currentIndex = 0;
  state.currentPresentationId = id;
  setCurrentPresentationName(name);
  renderPlaylist();
  selectSlide(null);
  pushLiveState('New presentation created');
  toast('Presentation created', 'success');
  closeLibrary();
});

libSearch.addEventListener('input', renderLibraryGrid);
libSort.addEventListener('change', renderLibraryGrid);
libFavToggle.addEventListener('click', () => {
  libFavOnly = !libFavOnly;
  libFavToggle.classList.toggle('bg-emerald-600', libFavOnly);
  libFavToggle.classList.toggle('text-white', libFavOnly);
  renderLibraryGrid();
});

// Ctrl/Cmd+K — quick-open the library. The one shortcut this system needs
// on its own; the full keyboard-shortcut system (arrows, copy/paste, etc.)
// is its own later pass, not bundled in here.
document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
    e.preventDefault();
    if (libraryModal.classList.contains('hidden')) openLibrary(); else closeLibrary();
  }
  if (e.key === 'Escape' && !libraryModal.classList.contains('hidden')) closeLibrary();
});

// ---------------------------------------------------------------------------
// Output URL — shared by the Start Output panel and the Connections panel,
// so there is exactly one place that knows how to get a copyable output
// URL. Local mode: the session URL from the local server (room + read-only
// viewer token — see sync-provider.js/sync-local.js). Firestore/remote
// mode: there's no per-session token, so it's the same shared output.html
// link every operator gets (same thing the old top-strip "Copy output.html
// URL" button builds).
// ---------------------------------------------------------------------------
async function loadOutputUrlInto(inputEl) {
  if (!isLocalMode()) {
    inputEl.value = location.href.replace('controller.html', 'output.html');
    return;
  }
  inputEl.value = 'Loading…';
  try {
    inputEl.value = await fetchOutputUrl();
  } catch (e) {
    inputEl.value = '';
    toast(`Couldn't reach the local server for the output URL: ${e.message}`, 'error');
  }
}

// ---------------------------------------------------------------------------
// Start Output — "Output Mode" panel. Display Output and Web Output are
// the SAME output.html and the SAME renderer; this only changes how the
// operator reaches it (a native fullscreen window on this machine, vs. a
// URL pasted somewhere else). Available in every mode — local or
// Firestore/remote.
// ---------------------------------------------------------------------------
const outputModeModal = document.getElementById('outputModeModal');
const outputModeChoice = document.getElementById('outputModeChoice');
const outputModeWebPanel = document.getElementById('outputModeWebPanel');
const outputModeUrlInput = document.getElementById('outputModeUrl');
const hasTauri = typeof window.__TAURI__ !== 'undefined';

function openOutputMode() {
  outputModeChoice.classList.remove('hidden');
  outputModeWebPanel.classList.add('hidden');
  outputModeModal.classList.remove('hidden');
  outputModeModal.classList.add('flex');
}
function closeOutputMode() {
  outputModeModal.classList.add('hidden');
  outputModeModal.classList.remove('flex');
}
document.getElementById('btnStartOutput').addEventListener('click', openOutputMode);
document.getElementById('btnCloseOutputMode').addEventListener('click', closeOutputMode);
outputModeModal.addEventListener('click', (e) => { if (e.target === outputModeModal) closeOutputMode(); });
document.getElementById('btnBackToOutputModeChoice').addEventListener('click', () => {
  outputModeWebPanel.classList.add('hidden');
  outputModeChoice.classList.remove('hidden');
});

document.getElementById('btnModeWeb').addEventListener('click', async () => {
  outputModeChoice.classList.add('hidden');
  outputModeWebPanel.classList.remove('hidden');
  await loadOutputUrlInto(outputModeUrlInput);
});
document.getElementById('btnCopyOutputModeUrl').addEventListener('click', async () => {
  if (!outputModeUrlInput.value) return;
  await navigator.clipboard.writeText(outputModeUrlInput.value);
  toast('Copied', 'success');
});

document.getElementById('btnModeDisplay').addEventListener('click', async () => {
  // Same URL Web Output shows — Display Output is that same session
  // opened in a fullscreen window instead of copied out.
  let url;
  if (isLocalMode()) {
    try { url = await fetchOutputUrl(); }
    catch (e) { toast(`Couldn't reach the local server: ${e.message}`, 'error'); return; }
  } else {
    url = location.href.replace('controller.html', 'output.html');
  }
  if (!url) { toast('Output URL not ready yet — try again in a moment', 'error'); return; }

  if (hasTauri) {
    // Desktop app: ask the Rust side to open output.html in a real
    // fullscreen OS window (see open_output_window in src-tauri/src/main.rs).
    // Re-clicking just focuses the existing window instead of stacking a
    // second one.
    try {
      await window.__TAURI__.core.invoke('open_output_window', { url });
      toast('Display Output launched', 'success');
      closeOutputMode();
    } catch (e) {
      toast(`Couldn't open the output window: ${e}`, 'error');
    }
  } else {
    // Running as a plain web page (no desktop app around it) — there's no
    // OS-level window API available, so open a normal window and let the
    // operator use their browser's own fullscreen (F11). Still exactly
    // the same output.html + renderer as every other delivery mode.
    const win = window.open(url, 'omnideck-output');
    if (!win) { toast('Pop-up blocked — allow pop-ups to open Display Output', 'error'); return; }
    toast('Opened in a new window — press F11 for fullscreen', 'info');
    closeOutputMode();
  }
});

// ---------------------------------------------------------------------------
// Connections panel — local mode only. Shows the shareable output URL (for
// OBS's Browser Source) and controller URL (for a second machine), so the
// operator never has to construct or guess these by hand.
// ---------------------------------------------------------------------------
if (isLocalMode()) {
  document.getElementById('btnOpenConnections').classList.remove('hidden');
}
const connectionsModal = document.getElementById('connectionsModal');
document.getElementById('btnOpenConnections').addEventListener('click', async () => {
  document.getElementById('connControllerUrl').value = shareableControllerUrl() || '';
  connectionsModal.classList.remove('hidden');
  connectionsModal.classList.add('flex');
  await loadOutputUrlInto(document.getElementById('connOutputUrl'));
});
document.getElementById('btnCloseConnections').addEventListener('click', () => {
  connectionsModal.classList.add('hidden');
  connectionsModal.classList.remove('flex');
});
connectionsModal.addEventListener('click', (e) => { if (e.target === connectionsModal) connectionsModal.classList.add('hidden'); });
[['btnCopyOutputUrl', 'connOutputUrl'], ['btnCopyControllerUrl', 'connControllerUrl']].forEach(([btnId, inputId]) => {
  document.getElementById(btnId).addEventListener('click', async () => {
    const input = document.getElementById(inputId);
    if (!input.value) return;
    await navigator.clipboard.writeText(input.value);
    toast('Copied', 'success');
  });
});

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------
(async function init() {
  await initBible();
  if (firestoreConfigured) {
    await initFirebase();
    await loadSongs().catch(e => console.warn('loadSongs failed (Firestore rules?)', e));
    await loadImages().catch(e => console.warn('loadImages failed (Firestore rules?)', e));
    await loadVideos().catch(e => console.warn('loadVideos failed (Firestore rules?)', e));
  } else if (isLocalMode()) {
    console.log('[FreeFlowController] Running local-only: songs/images/videos/presentations libraries need js/config.js filled in to sync — the live output itself does not.');
  }
  renderPlaylist();
})();
