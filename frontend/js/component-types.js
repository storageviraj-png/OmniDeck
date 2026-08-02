// ============================================================================
// FREEFLOW / OmniDeck — component registry.
//
// This is the single place that knows what kinds of components exist on a
// slide. Everything else (slide-model.js's element defaults, render-engine's
// paint dispatch, controller.js's inspector and "add component" UI) reads
// from here instead of hard-coding a kind list — so adding a new component
// kind means adding one entry here plus one render function in
// render-engine.js, not editing an if/else chain in five files.
//
// Every kind shares the base fields defined in slide-model.js's newElement()
// (position, size, opacity, z-index, etc. — anything that makes sense for
// ANY component). `defaults` below only needs to list what's different from
// those base fields or unique to this kind. `fields` lists which
// kind-specific inspector fields controller.js should show for it (shared
// fields like position/opacity are always shown and aren't listed here).
// ============================================================================

export const COMPONENT_KINDS = {
  text: {
    label: 'Text',
    defaults: {},
    fields: ['content', 'font', 'fontSize', 'weight', 'color', 'align', 'verticalAlign', 'letterSpacing', 'glow', 'outline', 'shadow'],
  },
  image: {
    label: 'Image',
    defaults: { src: '', imageFit: 'contain' },
    fields: ['src', 'imageFit'],
  },
  video: {
    label: 'Video',
    defaults: { src: '', imageFit: 'contain', autoplay: true, loop: true, muted: true, volume: 1 },
    fields: ['src', 'imageFit', 'autoplay', 'loop', 'muted', 'volume'],
  },
  shape: {
    label: 'Shape',
    defaults: { shapeType: 'rectangle', fill: '#ffffff', stroke: 'transparent', strokeWidth: 0, cornerRadius: 0 },
    fields: ['shapeType', 'fill', 'stroke', 'strokeWidth', 'cornerRadius'],
  },
};

export function defaultsForKind(kind) {
  return COMPONENT_KINDS[kind] ? COMPONENT_KINDS[kind].defaults : {};
}

export function fieldsForKind(kind) {
  return COMPONENT_KINDS[kind] ? COMPONENT_KINDS[kind].fields : [];
}

export function labelForKind(kind) {
  return COMPONENT_KINDS[kind] ? COMPONENT_KINDS[kind].label : kind;
}
