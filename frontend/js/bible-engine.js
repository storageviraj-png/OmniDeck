// ============================================================================
// FREEFLOW / OmniDeck — Bible reference engine.
//
// PLACEHOLDER DATA NOTICE: the full ScriptureFlow Bible datasets
// (english-normalized.json / telugu-complete.json — 31k+ verses, per that
// project's own notes) aren't part of this repository. Rather than block
// on that, this module is built so dropping those files in later requires
// ZERO changes here or in controller.js:
//
//   1. Save the real data as a flat JSON array of
//      { book, chapter, verse, text } records (the exact shape
//      ScriptureFlow already normalizes to) at:
//        frontend/data/bible-en.json   (English)
//        frontend/data/bible-te.json   (Telugu)
//   2. That's it. loadTranslation() below fetches that path first and only
//      falls back to the tiny embedded sample below if the file is missing
//      — so real data is picked up automatically the moment it exists.
//
// Everything exported here mirrors ScriptureFlow's proven design: a
// bookIndexes-style in-memory index built once per translation for O(1)
// chapter/verse lookup (see js/controller.js's Bible.* call sites for the
// exact contract this implements).
// ============================================================================

const TRANSLATIONS = [
  { code: 'en', label: 'English (sample data)', abbr: 'SAMPLE', file: 'data/bible-en.json' },
  { code: 'te', label: 'Telugu (sample data)', abbr: 'SAMPLE', file: 'data/bible-te.json' }
];

// code -> { bookOrder: string[], byBook: { [book]: { [chapter]: {verse,text}[] } } }
const _index = {};

export function listTranslations() {
  return TRANSLATIONS.map(({ code, label, abbr }) => ({ code, label, abbr }));
}

export async function loadTranslation(code) {
  if (_index[code]) return; // already loaded and indexed — no-op

  const meta = TRANSLATIONS.find((t) => t.code === code);
  if (!meta) throw new Error(`bible-engine: unknown translation code "${code}"`);

  let records = null;
  try {
    const res = await fetch(meta.file);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (Array.isArray(data) && data.length > 0) records = data;
  } catch (e) {
    // Expected until real data is dropped in — see the file header. Not an
    // error worth surfacing to the operator, just the console.
  }

  if (!records) {
    console.warn(
      `[bible-engine] No data file at "${meta.file}" for "${code}" — using a small placeholder ` +
      `sample instead of a real Bible. Drop a flat [{book,chapter,verse,text}, ...] JSON array ` +
      'at that path (see this file\'s header comment) to replace it automatically.'
    );
    records = SAMPLE_DATA[code] || [];
  }

  _index[code] = buildIndex(records);
}

function buildIndex(records) {
  const byBook = {};
  const bookOrder = [];
  for (const r of records) {
    if (!byBook[r.book]) {
      byBook[r.book] = {};
      bookOrder.push(r.book);
    }
    if (!byBook[r.book][r.chapter]) byBook[r.book][r.chapter] = [];
    byBook[r.book][r.chapter].push({ verse: r.verse, text: r.text });
  }
  for (const book of bookOrder) {
    for (const chapter of Object.keys(byBook[book])) {
      byBook[book][chapter].sort((a, b) => a.verse - b.verse);
    }
  }
  return { byBook, bookOrder };
}

export function getBooks(code) {
  return _index[code] ? _index[code].bookOrder : [];
}

export function getChapterCount(code, book) {
  const idx = _index[code];
  if (!idx || !idx.byBook[book]) return 0;
  return Object.keys(idx.byBook[book]).length;
}

export function getChapter(code, book, chapter) {
  const idx = _index[code];
  return (idx && idx.byBook[book] && idx.byBook[book][chapter]) || [];
}

export function getVerseRange(code, book, chapter, verseStart, verseEnd) {
  return getChapter(code, book, chapter).filter((v) => v.verse >= verseStart && v.verse <= verseEnd);
}

export function formatReference(book, chapter, verseStart, verseEnd) {
  if (verseStart == null) return `${book} ${chapter}`;
  return verseStart === verseEnd ? `${book} ${chapter}:${verseStart}` : `${book} ${chapter}:${verseStart}-${verseEnd}`;
}

// Parses "John 3:16", "John 3:16-18", "Genesis 1", "1 John 2:3", etc.
// Book names are matched case-insensitively against whatever books are
// actually loaded, so multi-word and numbered books work without a
// hardcoded book list. Returns null (not a throw) on anything unparseable
// — controller.js already handles that as "could not parse reference".
export function parseReference(code, input) {
  const idx = _index[code];
  if (!idx || !input) return null;

  const m = input.trim().match(/^(.+?)\s+(\d+)(?::(\d+)(?:-(\d+))?)?$/);
  if (!m) return null;
  const [, rawBook, chapterStr, vStartStr, vEndStr] = m;

  const book = idx.bookOrder.find((b) => b.toLowerCase() === rawBook.trim().toLowerCase());
  if (!book) return null;

  const chapter = parseInt(chapterStr, 10);
  if (!idx.byBook[book][chapter]) return null;

  if (!vStartStr) return { book, chapter, whole: true };
  const verseStart = parseInt(vStartStr, 10);
  const verseEnd = vEndStr ? parseInt(vEndStr, 10) : verseStart;
  return { book, chapter, whole: false, verseStart, verseEnd };
}

// ---- Placeholder sample data ---------------------------------------------
// Deliberately tiny — just enough to exercise every code path (translation
// list, books, chapters, verse search, reference parsing) end to end. Not
// a real Bible. Public-domain text (KJV) so there's no licensing question
// while it's here. See the file header for how to replace it.
const SAMPLE_DATA = {
  en: [
    { book: 'Genesis', chapter: 1, verse: 1, text: 'In the beginning God created the heaven and the earth.' },
    { book: 'Genesis', chapter: 1, verse: 2, text: 'And the earth was without form, and void; and darkness was upon the face of the deep. And the Spirit of God moved upon the face of the waters.' },
    { book: 'Genesis', chapter: 1, verse: 3, text: 'And God said, Let there be light: and there was light.' },
    { book: 'Psalms', chapter: 23, verse: 1, text: 'The LORD is my shepherd; I shall not want.' },
    { book: 'Psalms', chapter: 23, verse: 2, text: 'He maketh me to lie down in green pastures: he leadeth me beside the still waters.' },
    { book: 'Psalms', chapter: 23, verse: 3, text: 'He restoreth my soul: he leadeth me in the paths of righteousness for his name\'s sake.' },
    { book: 'John', chapter: 3, verse: 16, text: 'For God so loved the world, that he gave his only begotten Son, that whosoever believeth in him should not perish, but have everlasting life.' },
    { book: 'John', chapter: 3, verse: 17, text: 'For God sent not his Son into the world to condemn the world; but that the world through him might be saved.' }
  ]
  // 'te' intentionally has no sample data — matches ScriptureFlow's own
  // notes that Telugu required a separately-sourced, forensically-repaired
  // data file; there's no equivalent placeholder worth faking here. It
  // will simply show an empty book list until frontend/data/bible-te.json
  // exists, which loadTranslation() will then pick up automatically.
};
