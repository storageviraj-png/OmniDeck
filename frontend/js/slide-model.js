// ============================================================================
// FREEFLOW — unified slide schema.
// Every piece of content (Bible verse, lyric line, text slide, image,
// announcement, lower-third) is normalized into ONE shape so output.html
// only ever needs one render path.
// ============================================================================
import { defaultsForKind } from './component-types.js';

let _idCounter = 0;
export function newId(prefix = 'el') {
  _idCounter += 1;
  return `${prefix}_${Date.now().toString(36)}_${_idCounter}`;
}

// A component positioned on the slide canvas. x/y/w/h are all PERCENTAGES
// of the 1920x1080 virtual canvas (0-100), so the exact same numbers render
// identically in the controller's preview and in output.html regardless of
// actual pixel size. `kind` selects which component this is (see
// component-types.js for the registry of kinds and their own defaults —
// merged in below, after the shared base fields, before caller overrides).
export function newElement(overrides = {}) {
  const kind = overrides.kind || 'text';
  return Object.assign({
    id: newId('el'),
    kind,                       // see component-types.js for the full list
    content: '',
    src: '',                    // image/video src
    x: 10, y: 35, w: 80, h: 30, // percent of canvas
    font: 'Inter',
    fontSize: 4.2,             // in vw-equivalent units, scaled in output
    weight: '700',
    color: '#ffffff',
    align: 'center',            // left | center | right
    verticalAlign: 'center',     // top | center | bottom
    letterSpacing: 0,
    opacity: 1,
    glow: 6,
    glowColor: '#e11d48',
    outlineWidth: 0,
    outlineColor: '#000000',
    shadowBlur: 0,
    shadowColor: '#000000',
    lang: 'en',                 // drives font fallback stack
    imageFit: 'contain',        // cover | contain | fill (image/video only)
    zIndex: 1
  }, defaultsForKind(kind), overrides);
}

export function newBackground(overrides = {}) {
  return Object.assign({
    mode: 'transparent',    // transparent | color | gradient | image
    color: '#0f172a',
    gradientFrom: '#0f172a',
    gradientTo: '#1e293b',
    gradientAngle: 135,
    imageUrl: '',
    imageFit: 'cover'        // cover | contain
  }, overrides);
}

export function newSlide(type, overrides = {}) {
  return Object.assign({
    id: newId('slide'),
    type,                     // scripture | lyrics | text | image | announcement | lowerThird
    label: '',                // shown in the playlist / library list
    background: newBackground(),
    elements: [],
    transition: 'fade',       // fade | slide | zoom | crossfade | cut
    duration: 0,               // ms; 0 = manual advance only
    meta: {}
  }, overrides);
}

// ---- Type-specific factories -------------------------------------------

export function scriptureSlide({ reference, translationAbbr, language = 'en', text }) {
  const s = newSlide('scripture', { label: reference });
  s.meta = { reference, translationAbbr, language };
  s.elements = [
    newElement({ id: newId('el'), kind: 'text', content: text, x: 8, y: 22, w: 84, h: 50, fontSize: 4.4, weight: '600', lang: language, align: 'center' }),
    newElement({ id: newId('el'), kind: 'text', content: `${reference}${translationAbbr ? ' (' + translationAbbr + ')' : ''}`, x: 8, y: 74, w: 84, h: 10, fontSize: 1.8, weight: '600', opacity: 0.85, align: 'center' })
  ];
  return s;
}

export function lyricsSlide({ songTitle, artist, lineText, lang = 'en' }) {
  const s = newSlide('lyrics', { label: songTitle });
  s.meta = { songTitle, artist };
  s.elements = [
    newElement({ id: newId('el'), kind: 'text', content: lineText, x: 8, y: 30, w: 84, h: 40, fontSize: 4.6, weight: '700', lang, align: 'center' })
  ];
  return s;
}

export function textSlide({ label = 'Text Slide', content = '' } = {}) {
  const s = newSlide('text', { label });
  s.elements = [
    newElement({ id: newId('el'), kind: 'text', content, x: 10, y: 35, w: 80, h: 30, fontSize: 3.6, weight: '700' })
  ];
  return s;
}

export function imageSlide({ label = 'Image', src = '' } = {}) {
  const s = newSlide('image', { label });
  s.elements = [
    newElement({ id: newId('el'), kind: 'image', src, x: 0, y: 0, w: 100, h: 100, imageFit: 'cover' })
  ];
  return s;
}

export function videoSlide({ label = 'Video', src = '' } = {}) {
  const s = newSlide('video', { label });
  s.elements = [
    newElement({ id: newId('el'), kind: 'video', src, x: 0, y: 0, w: 100, h: 100, imageFit: 'cover' })
  ];
  return s;
}

export function announcementSlide({ label = 'Announcement', title = '', body = '' } = {}) {
  const s = newSlide('announcement', { label });
  s.elements = [
    newElement({ id: newId('el'), kind: 'text', content: title, x: 8, y: 30, w: 84, h: 18, fontSize: 4, weight: '800', align: 'center' }),
    newElement({ id: newId('el'), kind: 'text', content: body, x: 8, y: 50, w: 84, h: 25, fontSize: 2.2, weight: '500', align: 'center' })
  ];
  return s;
}

export function lowerThirdSlide({ label = 'Lower Third', title = '', subtitle = '' } = {}) {
  const s = newSlide('lowerThird', { label, transition: 'slide' });
  s.background = newBackground({ mode: 'transparent' });
  s.elements = [
    newElement({ id: newId('el'), kind: 'text', content: title, x: 6, y: 78, w: 60, h: 10, fontSize: 2.4, weight: '800', align: 'left', verticalAlign: 'bottom' }),
    newElement({ id: newId('el'), kind: 'text', content: subtitle, x: 6, y: 88, w: 60, h: 8, fontSize: 1.4, weight: '500', opacity: 0.85, align: 'left', verticalAlign: 'top' })
  ];
  return s;
}

export function cloneSlide(slide) {
  const copy = JSON.parse(JSON.stringify(slide));
  copy.id = newId('slide');
  copy.elements = copy.elements.map(el => Object.assign({}, el, { id: newId('el') }));
  return copy;
}
