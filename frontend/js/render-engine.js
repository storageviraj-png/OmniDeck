// ============================================================================
// FREEFLOW — render engine. Paints ONE slide object into a stage container.
// Used by BOTH output.html and the controller's preview panel so operators
// see exactly what OBS will show (WYSIWYG), and by the drag/resize editor
// (editor.js) which reuses these same elements as its interactive canvas.
//
// WYSIWYG NOTE: x/y/w/h were already percentages of the stage, so those
// always matched. Font size, letter-spacing, glow, outline and shadow used
// to be authored in raw `vw`/`px` — `vw` is relative to the browser
// VIEWPORT (not the stage box), and raw `px` doesn't scale at all. Since
// output.html's stage happens to fill the whole viewport but the
// controller's preview stage is a much smaller box, those properties
// rendered at very different relative sizes in the two places. `.ff-stage`
// is now a CSS size container (see stage.css) and everything below is
// expressed in `cqw` (percent of the STAGE's own width) instead, so preview
// and output are always proportionally identical regardless of the actual
// pixel size of the stage box. `refPx()` converts the old px values against
// a 1920px reference width so output.html's on-air appearance is unchanged.
//
// COMPONENT MODEL: painting is dispatched by `el.kind` through the
// KIND_RENDERERS registry below (text is the fallback for unknown kinds).
// See component-types.js for the registry of what kinds exist and their
// defaults/inspector fields — adding a new kind means adding a render
// function here and one line in KIND_RENDERERS, not editing an if/else.
// ============================================================================
import { SCRIPT_FONT_FALLBACK } from './config.js';

const TRANSITION_MS = 380;
const REFERENCE_WIDTH = 1920; // the virtual canvas width the old px values were tuned against
function refPx(px) { return `${(px * 100) / REFERENCE_WIDTH}cqw`; }

export function applyBackground(stageEl, bg) {
  bg = bg || { mode: 'transparent' };
  switch (bg.mode) {
    case 'color':
      stageEl.style.background = bg.color || '#000000';
      break;
    case 'gradient':
      stageEl.style.background = `linear-gradient(${bg.gradientAngle ?? 135}deg, ${bg.gradientFrom || '#000'}, ${bg.gradientTo || '#333'})`;
      break;
    case 'image':
      stageEl.style.background = bg.imageUrl
        ? `url("${bg.imageUrl}") center/${bg.imageFit || 'cover'} no-repeat`
        : 'transparent';
      if (bg.imageUrl) probeImage(bg.imageUrl, 'Background image');
      break;
    default:
      stageEl.style.background = 'transparent';
  }
}

// CSS background-image has no native onerror event, so a bad/blocked URL
// there would otherwise fail completely silently. Probe it with a
// throwaway Image() purely to get the failure logged to the console.
function probeImage(url, label) {
  const probe = new Image();
  probe.onerror = () => console.error(
    `[FreeFlow] ${label} failed to load. Check: the URL is correct and public, ` +
    `Firebase Storage rules, and that anonymous auth succeeded (see console for auth errors). URL:`, url
  );
  probe.src = url;
}

function styleTextEl(domEl, el) {
  const fallback = SCRIPT_FONT_FALLBACK[el.lang] || 'sans-serif';
  domEl.style.fontFamily = `"${el.font}", ${fallback}`;
  domEl.style.fontWeight = el.weight;
  domEl.style.fontSize = `${el.fontSize}cqw`; // el.fontSize was already authored as "percent of canvas width"
  domEl.style.letterSpacing = refPx(el.letterSpacing);
  domEl.style.color = el.color;
  domEl.style.textAlign = el.align;
  domEl.style.opacity = el.opacity;
  domEl.style.whiteSpace = 'pre-wrap';
  domEl.style.wordBreak = 'break-word';

  const glow = parseFloat(el.glow) > 0 ? `0 0 ${refPx(el.glow)} ${el.glowColor}, 0 0 ${refPx(el.glow / 2)} ${el.color}` : '';
  const drop = parseFloat(el.shadowBlur) > 0 ? `${refPx(2)} ${refPx(3)} ${refPx(el.shadowBlur)} ${el.shadowColor}` : '';
  domEl.style.textShadow = [drop, glow].filter(Boolean).join(', ') || 'none';
  domEl.style.webkitTextStroke = parseFloat(el.outlineWidth) > 0 ? `${refPx(el.outlineWidth)} ${el.outlineColor}` : '0px transparent';
}

function reportMediaLoadError(wrap, el, interactive, what) {
  console.error(
    `[FreeFlow] ${what} failed to load. Check: the URL is correct and public, ` +
    `Firebase Storage rules, and that anonymous auth succeeded (see console for auth errors). URL:`, el.src
  );
  // Only surface a visible warning in the editable preview — output.html
  // stays silent on-air, it just logs to the console for debugging.
  if (interactive) {
    wrap.classList.add('ff-img-error');
    const badge = document.createElement('div');
    badge.className = 'ff-img-error-badge';
    badge.textContent = `⚠ ${what.toLowerCase()} failed to load`;
    wrap.appendChild(badge);
  }
}

function renderText(wrap, el) {
  const p = document.createElement('div');
  p.textContent = el.content;
  styleTextEl(p, el);
  p.style.width = '100%';
  wrap.appendChild(p);
}

function renderImage(wrap, el, interactive) {
  const img = document.createElement('img');
  img.style.width = '100%';
  img.style.height = '100%';
  img.style.objectFit = el.imageFit || 'contain';
  img.style.opacity = el.opacity;
  img.draggable = false;
  img.onerror = () => reportMediaLoadError(wrap, el, interactive, 'Image');
  img.src = el.src;
  wrap.appendChild(img);
}

function renderVideo(wrap, el, interactive) {
  const video = document.createElement('video');
  video.style.width = '100%';
  video.style.height = '100%';
  video.style.objectFit = el.imageFit || 'contain';
  video.style.opacity = el.opacity;
  video.autoplay = el.autoplay !== false;
  video.loop = el.loop !== false;
  video.muted = el.muted !== false; // browsers block unmuted autoplay anyway
  video.playsInline = true;
  video.volume = typeof el.volume === 'number' ? el.volume : 1;
  video.onerror = () => reportMediaLoadError(wrap, el, interactive, 'Video');
  video.src = el.src;
  wrap.appendChild(video);
}

function renderShape(wrap, el) {
  const shape = document.createElement('div');
  shape.style.width = '100%';
  shape.style.height = '100%';
  shape.style.opacity = el.opacity;
  shape.style.background = el.fill || 'transparent';
  shape.style.borderStyle = 'solid';
  shape.style.borderWidth = refPx(el.strokeWidth || 0);
  shape.style.borderColor = el.stroke || 'transparent';
  shape.style.borderRadius = el.shapeType === 'ellipse' ? '50%' : refPx(el.cornerRadius || 0);
  wrap.appendChild(shape);
}

// Paint dispatch by component kind. Adding a new kind = add a render
// function above + one line here (plus a registry entry in
// component-types.js and, if it needs its own inspector fields, a section
// in controller.js). `text` is the fallback for any unrecognized kind.
const KIND_RENDERERS = { image: renderImage, video: renderVideo, shape: renderShape };

function positionEl(domEl, el) {
  domEl.style.position = 'absolute';
  domEl.style.left = `${el.x}%`;
  domEl.style.top = `${el.y}%`;
  domEl.style.width = `${el.w}%`;
  domEl.style.height = `${el.h}%`;
  domEl.style.zIndex = el.zIndex ?? 1;
  domEl.style.display = 'flex';
  domEl.style.flexDirection = 'column';
  domEl.style.overflow = 'hidden';
  domEl.style.justifyContent = el.verticalAlign === 'top' ? 'flex-start' : el.verticalAlign === 'bottom' ? 'flex-end' : 'center';
  domEl.style.alignItems = el.align === 'left' ? 'flex-start' : el.align === 'right' ? 'flex-end' : 'center';
}

// Renders `slide` into `stageEl` (a position:relative/fixed container that
// spans the full canvas). Returns nothing; mutates the DOM in place.
// `interactive(elWrapper, elData)` is an optional hook the editor uses to
// attach drag/resize handles — output.html simply omits it.
export function paintSlide(stageEl, slide, { interactive } = {}) {
  stageEl.innerHTML = '';
  if (!slide) { applyBackground(stageEl, null); return; }

  applyBackground(stageEl, slide.background);

  for (const el of slide.elements) {
    const wrap = document.createElement('div');
    wrap.dataset.elId = el.id;
    positionEl(wrap, el);

    const renderFn = KIND_RENDERERS[el.kind] || renderText;
    renderFn(wrap, el, interactive);

    stageEl.appendChild(wrap);
    if (interactive) interactive(wrap, el);
  }
}

// Transition wrapper: fades/slides/zooms the WHOLE stage out then in when
// swapping to a new slide. `renderFn` should synchronously paint the new
// content (via paintSlide) partway through.
export function transitionTo(stageEl, kind, renderFn) {
  const outClass = `ff-out-${kind || 'fade'}`;
  const inClass = `ff-in-${kind || 'fade'}`;
  stageEl.classList.remove(inClass);
  stageEl.classList.add(outClass);
  setTimeout(() => {
    renderFn();
    stageEl.classList.remove(outClass);
    stageEl.classList.add(inClass);
    requestAnimationFrame(() => stageEl.classList.add('ff-visible'));
  }, kind === 'cut' ? 0 : TRANSITION_MS);
}
