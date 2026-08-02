// ============================================================================
// FREEFLOW / OmniDeck — canvas editor: selection, move, and resize.
//
// Does NOT own painting. render-engine.js's paintSlide() already rebuilds
// the whole stage from the slide object on every call (interactive or not)
// — this module's only job is to plug into the `interactive(wrap, el)` hook
// paintSlide() invokes once per element (see render-engine.js) and turn
// each element's wrapper div into something the operator can click, drag,
// and resize. Every drag mutates the slide's element object directly
// (x/y/w/h are percentages of the canvas — see slide-model.js's
// newElement()), then calls the `onChange` callback so the caller
// (controller.js) repaints, remembers the new style, and pushes the live
// state. Because paintSlide() tears down and rebuilds the DOM on every
// repaint anyway, this module never holds onto DOM element references
// across a repaint — only the selected element's id, re-resolved against
// the live slide object on every use via `getSlide()`.
//
// CSS contract (see css/stage.css, already written for this module):
//   .ff-editable[data-el-id]        — hover outline, cursor: move
//   .ff-editable[data-el-id].ff-selected  — selection outline
//   .ff-handle                      — one resize handle (sizing/color only;
//                                      this file sets each handle's corner
//                                      position and resize cursor inline)
// ============================================================================

const MIN_SIZE_PCT = 2; // an element can't be resized smaller than 2% of the canvas in either axis

// Each corner handle: which edges it moves, and which of x/y/w/h that maps
// to. +1 means "add the pointer delta"; -1 means "subtract it" (used for
// the edges that move opposite to the drag direction, e.g. dragging the
// nw handle right shrinks width instead of growing it).
const HANDLES = {
  nw: { style: { top: '-6px', left: '-6px' }, cursor: 'nwse-resize', dx: { x: 1, w: -1 }, dy: { y: 1, h: -1 } },
  ne: { style: { top: '-6px', right: '-6px' }, cursor: 'nesw-resize', dx: { w: 1 }, dy: { y: 1, h: -1 } },
  sw: { style: { bottom: '-6px', left: '-6px' }, cursor: 'nesw-resize', dx: { x: 1, w: -1 }, dy: { h: 1 } },
  se: { style: { bottom: '-6px', right: '-6px' }, cursor: 'nwse-resize', dx: { w: 1 }, dy: { h: 1 } }
};

const CLICK_THRESHOLD_PX = 4; // pointer movement below this = a click, not a drag

export function attachEditor(stageEl, getSlide, onChange, onSelect) {
  let selectedId = null;
  let drag = null; // { kind: 'move'|'resize', handle, elId, startPx: {x,y}, startEl: {x,y,w,h}, stageRect, moved }

  function findEl(id) {
    const slide = getSlide();
    return (slide && slide.elements.find((e) => e.id === id)) || null;
  }

  function select(id) {
    if (selectedId === id) return;
    selectedId = id;
    onSelect(id);
  }

  function clamp(v, lo, hi) {
    return Math.min(hi, Math.max(lo, v));
  }

  function beginDrag(kind, handle, elId, evt) {
    const el = findEl(elId);
    if (!el) return;
    drag = {
      kind,
      handle,
      elId,
      startPx: { x: evt.clientX, y: evt.clientY },
      startEl: { x: el.x, y: el.y, w: el.w, h: el.h },
      stageRect: stageEl.getBoundingClientRect(),
      moved: false
    };
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp, { once: true });
    evt.preventDefault();
  }

  function onPointerMove(evt) {
    if (!drag) return;
    const dxPx = evt.clientX - drag.startPx.x;
    const dyPx = evt.clientY - drag.startPx.y;
    if (Math.abs(dxPx) > CLICK_THRESHOLD_PX || Math.abs(dyPx) > CLICK_THRESHOLD_PX) drag.moved = true;

    const el = findEl(drag.elId);
    if (!el || !drag.stageRect.width || !drag.stageRect.height) return;
    const dxPct = (dxPx / drag.stageRect.width) * 100;
    const dyPct = (dyPx / drag.stageRect.height) * 100;

    if (drag.kind === 'move') {
      el.x = clamp(drag.startEl.x + dxPct, 0, 100 - el.w);
      el.y = clamp(drag.startEl.y + dyPct, 0, 100 - el.h);
    } else {
      const effect = HANDLES[drag.handle];
      let { x, y, w, h } = drag.startEl;
      if (effect.dx.x) x = drag.startEl.x + dxPct * effect.dx.x;
      if (effect.dx.w) w = drag.startEl.w + dxPct * effect.dx.w;
      if (effect.dy.y) y = drag.startEl.y + dyPct * effect.dy.y;
      if (effect.dy.h) h = drag.startEl.h + dyPct * effect.dy.h;

      w = clamp(w, MIN_SIZE_PCT, 100);
      h = clamp(h, MIN_SIZE_PCT, 100);
      x = clamp(x, 0, 100 - w);
      y = clamp(y, 0, 100 - h);

      el.x = x; el.y = y; el.w = w; el.h = h;
    }

    onChange();
  }

  function onPointerUp() {
    window.removeEventListener('pointermove', onPointerMove);
    if (drag && !drag.moved) select(drag.elId);
    drag = null;
  }

  function addHandles(wrap) {
    Object.entries(HANDLES).forEach(([name, def]) => {
      const handle = document.createElement('div');
      handle.className = 'ff-handle';
      handle.dataset.handle = name;
      Object.assign(handle.style, def.style, { cursor: def.cursor });
      handle.addEventListener('pointerdown', (evt) => {
        evt.stopPropagation();
        beginDrag('resize', name, wrap.dataset.elId, evt);
      });
      wrap.appendChild(handle);
    });
  }

  function removeHandles(wrap) {
    wrap.querySelectorAll('.ff-handle').forEach((h) => h.remove());
  }

  // The interactive() hook — paintSlide() calls this once per element,
  // right after appending its wrapper div to the stage (see
  // render-engine.js). `wrap` already has `dataset.elId` and absolute
  // position/size set by positionEl(); this only adds editing affordances.
  function interactiveHook(wrap, el) {
    wrap.classList.add('ff-editable');
    wrap.style.pointerEvents = 'auto';

    if (el.id === selectedId) {
      wrap.classList.add('ff-selected');
      addHandles(wrap);
    }

    wrap.addEventListener('pointerdown', (evt) => {
      // A resize handle's own listener already stopped propagation before
      // this would fire, so reaching here always means "drag the element".
      beginDrag('move', null, el.id, evt);
    });
  }

  // Clicking empty stage background (not any element) deselects.
  stageEl.addEventListener('pointerdown', (evt) => {
    if (evt.target === stageEl) select(null);
  });

  return {
    interactive: interactiveHook,
    getSelectedId: () => selectedId,
    select,
    // Repositions the selected element's handles without a full repaint —
    // safe to call any time (including redundantly right after a repaint
    // that already rebuilt them fresh, e.g. from the inspector fields).
    refreshHandles: () => {
      if (!selectedId) return;
      const wrap = stageEl.querySelector(`[data-el-id="${selectedId}"]`);
      if (!wrap) return;
      removeHandles(wrap);
      addHandles(wrap);
    }
  };
}
