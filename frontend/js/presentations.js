// ============================================================================
// FREEFLOW / OmniDeck — presentations library data layer.
//
// Two collections per presentation, same document id in both:
//   PRESENTATIONS_COLLECTION       — small metadata only (name, folder,
//                                     favorite, timestamps, slide count, a
//                                     tiny thumbnail snapshot). This is what
//                                     the library grid lists — cheap even at
//                                     hundreds of presentations, since it
//                                     never touches slide content.
//   PRESENTATION_CONTENT_COLLECTION — the actual slides array. Only fetched
//                                     when a presentation is opened.
//
// This module is a thin Firestore layer (mirrors firestore-sync.js's own
// style) — it doesn't know about slide shape/cloning; that logic (e.g.
// regenerating ids on duplicate) belongs in controller.js, which already
// has slide-model.js's cloneSlide for it.
// ============================================================================
import { PRESENTATIONS_COLLECTION, PRESENTATION_CONTENT_COLLECTION } from './config.js';
import { getDb, collection, addDoc, doc, getDoc, getDocs, deleteDoc, patchDoc, writeDoc } from './firestore-sync.js';

export async function listPresentationMeta() {
  const snap = await getDocs(collection(getDb(), ...PRESENTATIONS_COLLECTION));
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

export async function createPresentationMeta(name) {
  const now = Date.now();
  const ref = await addDoc(collection(getDb(), ...PRESENTATIONS_COLLECTION), {
    name: name || 'Untitled Presentation',
    folder: '',
    favorite: false,
    slideCount: 0,
    thumb: null,
    createdAt: now,
    updatedAt: now,
    lastOpenedAt: now
  });
  await writeDoc([...PRESENTATION_CONTENT_COLLECTION, ref.id], { slides: [] });
  return ref.id;
}

export async function patchPresentationMeta(id, fields) {
  await patchDoc([...PRESENTATIONS_COLLECTION, id], fields);
}

export async function deletePresentation(id) {
  await deleteDoc(doc(getDb(), ...PRESENTATIONS_COLLECTION, id));
  await deleteDoc(doc(getDb(), ...PRESENTATION_CONTENT_COLLECTION, id)).catch(() => {});
}

export async function loadPresentationContent(id) {
  const snap = await getDoc(doc(getDb(), ...PRESENTATION_CONTENT_COLLECTION, id));
  return snap.exists() ? (snap.data().slides || []) : [];
}

// Saves content AND keeps the lightweight metadata doc (slideCount,
// updatedAt, thumb) in sync — so the library list never needs to read
// content to know what changed. `thumb` is just the first slide's
// background + first element, enough for render-engine's paintSlide to
// draw a real (if partial) preview at card size — see presentation-library
// wiring in controller.js.
export async function savePresentationContent(id, slides) {
  await writeDoc([...PRESENTATION_CONTENT_COLLECTION, id], { slides });
  const first = slides[0];
  await patchPresentationMeta(id, {
    slideCount: slides.length,
    updatedAt: Date.now(),
    thumb: first ? { background: first.background, elements: first.elements.slice(0, 2) } : null
  });
}

export async function touchLastOpened(id) {
  await patchPresentationMeta(id, { lastOpenedAt: Date.now() });
}
