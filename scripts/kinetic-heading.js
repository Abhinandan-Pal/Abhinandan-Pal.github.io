// scripts/kinetic-heading.js
//
// KineticHeading — splits the `[data-kinetic]` heading into per-grapheme
// <span> elements and animates each span via WAAPI when the heading first
// reaches a 0.5 IntersectionObserver threshold.
//
// Implementation notes:
//   - Splitting uses `Intl.Segmenter` with `granularity: 'grapheme'` so that
//     extended grapheme clusters in the Bengali run (e.g. the conjunct
//     "ন্দ" or vowel-sign sequences) are kept whole. A `[...text]`
//     code-point iterator is used as a defensive fallback when
//     `Intl.Segmenter` is missing — that fallback splits at code-point
//     boundaries, never mid surrogate pair, but cannot guarantee
//     cluster-safety on combining marks.
//   - The `lang` attribute is propagated per-grapheme. A grapheme drawn
//     from a `lang="bn"` run ships with `lang="bn"` on its wrapper so font
//     selection (`:lang(bn)` → `--font-bengali`) and screen readers
//     continue to honour the script.
//   - Each span carries `style="--i: N"` so a CSS rule can read the index
//     for staggered effects, and `display: inline-block` + `white-space:
//     pre` so the WAAPI `translateY` keyframe paints and visible
//     whitespace between word spans is preserved.
//   - The animation interpolates variable-font weight + width axes plus
//     `translateY(0.4em → 0)` and `opacity(0 → 1)` over 1100 ms with a
//     35 ms inter-letter delay (envelope, design tokens
//     `--dur-slow` and the design pseudocode in ).
//   - Under `prefers-reduced-motion: reduce` the final state is rendered
//     immediately and no animation is scheduled. The
//     module subscribes to `change` events on the media query so a live
//     toggle to "reduce" cancels any in-flight animations and snaps to
//     the final state.
//

const PER_LETTER_DURATION_MS = 1100;
const PER_LETTER_DELAY_MS = 35;
const EASING = 'cubic-bezier(.2, .8, .2, 1)';

/**
 * WAAPI keyframes for one letter:
 *   - frame 0: shifted down 0.4em, faded out, light & narrow.
 *   - frame 1 (60% of duration): in-place, full opacity, heavy & wide.
 *   - frame 2: settled at the rest weight + width.
 *
 * `fontVariationSettings` interpolates between `wght` 300→750→600 and
 * `wdth` 95→110→100. Browsers without variable-font support degrade
 * gracefully (the property silently no-ops; opacity + translateY still
 * animate).
 */
const KEYFRAMES = Object.freeze([
  {
    opacity: 0,
    transform: 'translateY(0.4em)',
    fontVariationSettings: '"wght" 300, "wdth" 95',
  },
  {
    opacity: 1,
    transform: 'translateY(0)',
    fontVariationSettings: '"wght" 750, "wdth" 110',
    offset: 0.6,
  },
  {
    opacity: 1,
    transform: 'translateY(0)',
    fontVariationSettings: '"wght" 600, "wdth" 100',
  },
]);

/**
 * Split `text` into extended grapheme clusters using `Intl.Segmenter`
 * when available. Falls back to a code-point iterator (`[...text]`)
 * which is *not* cluster-safe but is at least surrogate-safe.
 *
 * @param {string} text
 * @returns {string[]}
 */
function segmentGraphemes(text) {
  if (typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function') {
    const seg = new Intl.Segmenter('en', { granularity: 'grapheme' });
    const out = [];
    for (const s of seg.segment(text)) out.push(s.segment);
    return out;
  }
  return Array.from(text);
}

/**
 * Recursively walk `node`, accumulating `{ text, lang }` records for every
 * grapheme in document order. The `lang` attribute is inherited from the
 * nearest ancestor element with a non-empty `lang`.
 *
 * @param {Node} node
 * @param {string | null} lang
 * @param {Array<{ text: string, lang: string | null }>} out
 */
// DOM nodeType constants (`Node.TEXT_NODE` / `Node.ELEMENT_NODE`). Inlined
// because the project's ESLint config does not expose the global `Node`.
const NODE_TYPE_ELEMENT = 1;
const NODE_TYPE_TEXT = 3;

function collectGraphemes(node, lang, out) {
  if (node.nodeType === NODE_TYPE_TEXT) {
    const text = node.textContent;
    if (!text) return;
    for (const g of segmentGraphemes(text)) {
      out.push({ text: g, lang });
    }
    return;
  }
  if (node.nodeType === NODE_TYPE_ELEMENT) {
    const el = /** @type {Element} */ (node);
    // Preserve <br> elements as-is.
    if (el.tagName === 'BR') {
      out.push({ element: el });
      return;
    }
    // Preserve .ap-nickname as a whole element — don't split its text.
    if (el.classList && el.classList.contains('ap-nickname')) {
      out.push({ element: el });
      return;
    }
    const ownLang = el.getAttribute('lang');
    const childLang = (ownLang && ownLang.length > 0) ? ownLang : lang;
    for (const child of el.childNodes) {
      collectGraphemes(child, childLang, out);
    }
  }
  // Comment, processing instruction, etc.: ignore.
}

/**
 * Replace `h1`'s children with one `<span>` per grapheme, preserving the
 * source `lang` attribute on each span. Returns the array of spans in
 * document order so the caller can drive WAAPI animations against them.
 *
 * @param {Element} h1
 * @returns {HTMLSpanElement[]}
 */
function rebuildHeading(h1) {
  /** @type {Array<{ text: string, lang: string | null }>} */
  const items = [];
  for (const child of h1.childNodes) {
    collectGraphemes(child, null, items);
  }
  const frag = document.createDocumentFragment();
  /** @type {HTMLSpanElement[]} */
  const spans = [];
  items.forEach((item, i) => {
    // Preserved whole elements (like .ap-nickname) are appended directly.
    if (item.element) {
      item.element.style.setProperty('--i', String(i));
      frag.appendChild(item.element);
      spans.push(item.element);
      return;
    }
    // Whitespace graphemes stay as plain text nodes so the browser can
    // wrap at word boundaries. Only non-whitespace graphemes become
    // inline-block spans (needed for translateY to paint).
    if (/^\s+$/.test(item.text)) {
      frag.appendChild(document.createTextNode(item.text));
      return;
    }
    const span = document.createElement('span');
    span.textContent = item.text;
    if (item.lang) span.lang = item.lang;
    span.style.setProperty('--i', String(i));
    span.style.display = 'inline-block';
    span.style.willChange = 'transform, font-variation-settings, opacity';
    frag.appendChild(span);
    spans.push(span);
  });
  h1.replaceChildren(frag);
  return spans;
}

/**
 * Snap every span to its rest state without scheduling any animation.
 * Used under reduced motion and as a no-op fallback when
 * the platform lacks `Element.animate`.
 *
 * @param {HTMLSpanElement[]} spans
 */
function applyFinalState(spans) {
  for (const span of spans) {
    span.style.opacity = '1';
    span.style.transform = 'translateY(0)';
  }
}

/**
 * Schedule the per-letter WAAPI animation. Returns the `Animation` array
 * so callers can cancel them on a reduced-motion toggle.
 *
 * @param {HTMLSpanElement[]} spans
 * @returns {Animation[]}
 */
function play(spans) {
  /** @type {Animation[]} */
  const anims = [];
  spans.forEach((span, i) => {
    if (typeof span.animate !== 'function') {
      // No WAAPI: paint final state.
      span.style.opacity = '1';
      span.style.transform = 'translateY(0)';
      return;
    }
    const anim = span.animate(KEYFRAMES, {
      duration: PER_LETTER_DURATION_MS,
      delay: i * PER_LETTER_DELAY_MS,
      easing: EASING,
      fill: 'forwards',
    });
    anims.push(anim);
  });
  return anims;
}

/**
 * Cancel every animation in `anims` (idempotent; tolerates already-finished
 * animations) and snap the spans to the final state.
 *
 * @param {Animation[]} anims
 * @param {HTMLSpanElement[]} spans
 */
function cancelAndFinalise(anims, spans) {
  for (const a of anims) {
    try { a.cancel(); } catch { /* finished or detached */ }
  }
  applyFinalState(spans);
}

/**
 * Install the kinetic-heading enhancement. Idempotent only at the level
 * of one heading per call: the function locates the first `[data-kinetic]`
 * element, splits it into per-grapheme spans, and arms a one-shot
 * IntersectionObserver against it.
 *
 * Returns a teardown function for tests and live media-query bookkeeping.
 *
 * @returns { => void}
 */
export function installKineticHeading() {
  const h1 = document.querySelector('[data-kinetic]');
  if (!h1) return () => {};

  const reducedMotionMq = window.matchMedia('(prefers-reduced-motion: reduce)');
  const spans = rebuildHeading(h1);

  /** @type {Animation[]} */
  let activeAnims = [];
  /** @type {IntersectionObserver | null} */
  let io = null;
  let played = false;

  function tryPlay() {
    if (played) return;
    played = true;
    activeAnims = play(spans);
  }

  function disconnectIo() {
    if (io) {
      io.disconnect();
      io = null;
    }
  }

  // Reduced motion → render final state immediately, never schedule
  // animations or observers.
  if (reducedMotionMq.matches) {
    applyFinalState(spans);
  } else if (typeof window.IntersectionObserver !== 'function') {
    // No IntersectionObserver — defensive; play immediately so the
    // hero choreography still completes on legacy engines.
    tryPlay();
  } else {
    io = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!played && entry.isIntersecting && entry.intersectionRatio >= 0.5) {
          tryPlay();
          disconnectIo();
          break;
        }
      }
    }, { threshold: 0.5 });
    io.observe(h1);
  }

  // Live preference toggle: if the user enables reduced motion mid-flight,
  // cancel any running animation and snap to the final state. Disabling
  // reduced motion after the initial render does not replay (
  // semantics: never replay a one-shot reveal).
  const onChange = () => {
    if (reducedMotionMq.matches) {
      disconnectIo();
      cancelAndFinalise(activeAnims, spans);
      activeAnims = [];
      played = true;
    }
  };
  reducedMotionMq.addEventListener('change', onChange);

  return () => {
    disconnectIo();
    reducedMotionMq.removeEventListener('change', onChange);
  };
}
