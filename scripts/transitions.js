// scripts/transitions.js
//
// Section-transition fallback for browsers without scroll-driven animations.
//
// Strategy
//   • If the user agent supports `animation-timeline: view` the CSS rule
//     in styles/motion.css drives every `[data-reveal]` reveal natively;
//     this module installs nothing (no-op).
//   • Otherwise we install a single shared IntersectionObserver that
//     tracks which `[data-reveal]` sections currently overlap the
//     viewport, plus a `requestAnimationFrame`-throttled scroll handler
//     that — only for those visible sections — computes a 0..1 progress
//     over a continuous reveal band of at least 80 px and
//     writes it to `--ap-progress`. The `data-progress` attribute acts
//     as the activation gate for the matching CSS rule:
//
//         @supports not (animation-timeline: view) {
//           [data-reveal][data-progress] {
//             clip-path: inset(0 0 calc((1 - var(--ap-progress, 1)) * 100%) 0);
//             opacity:   calc(0.4 + 0.6 * var(--ap-progress, 1));
//           }
//         }
//
//     so a section keeps its natural appearance until JS has at least
//     one progress sample for it.
//   • Under `prefers-reduced-motion: reduce` the fallback is fully
//     uninstalled — and the corresponding `prefers-reduced-motion`
//     branch in motion.css neutralises any stale `--ap-progress` writes
//     anyway (defensive duplicate). The listener is live: the fallback
//     re-installs if the user disables reduced motion mid-session.
//
// Validates
//   •  — motion suppression under reduced motion (no progress
//                  writes while the preference is on).
//   •     — at least one section transition spans a continuous
//                  ≥ 80 px scroll band (`ENTRY_BAND_PX`).
//   •    — every animation duration / easing / coefficient
//                  resolves through the design system (CSS owns the
//                  visual side; this module only writes a 0..1 scalar).
//
// Design references
//   •
//   •
//                         fallback)
//   • styles/motion.css §6 (the consumer rule)

const REVEAL_SELECTOR = '[data-reveal]';

/** Minimum reveal band in CSS pixels. */
const ENTRY_BAND_PX = 80;

/**
 * Fraction of section height used as the reveal band when the section is
 * tall enough that the 80 px floor would feel abrupt. Matches the native
 * `animation-range: entry 0% cover 30%` semantics in motion.css.
 */
const ENTRY_BAND_FRACTION = 0.3;

let observer = null;
let scrollHandler = null;
let rafId = 0;
let visibleSections = null; // Set<HTMLElement>
let reducedMotionMq = null;
let onMqChange = null;
let installed = false;

function nativelySupported() {
  return (
    typeof CSS !== 'undefined' &&
    typeof CSS.supports === 'function' &&
    CSS.supports('animation-timeline: view()')
  );
}

/**
 * Compute reveal progress for a single section.
 *
 * Progress is 0 while the section sits below the viewport, ramps linearly
 * to 1 as the section's top edge crosses upward through the reveal band
 * (`max(80 px, 30 % of section height)`), and stays at 1 once the section
 * has fully entered. The band is anchored to the section's top so very
 * tall sections still complete their reveal quickly relative to their
 * height, matching the native `cover 0% cover 30%` curve.
 */
function computeProgress(rect, winH) {
  if (rect.top >= winH) return 0;
  if (rect.bottom <= 0) return 1;
  const band = Math.max(ENTRY_BAND_PX, rect.height * ENTRY_BAND_FRACTION);
  const entered = winH - rect.top;
  if (entered <= 0) return 0;
  if (entered >= band) return 1;
  return entered / band;
}

function tick() {
  rafId = 0;
  if (!visibleSections || visibleSections.size === 0) return;
  const winH = window.innerHeight;
  for (const section of visibleSections) {
    const rect = section.getBoundingClientRect();
    const progress = computeProgress(rect, winH);
    section.style.setProperty('--ap-progress', progress.toFixed(3));
    if (!section.hasAttribute('data-progress')) {
      section.setAttribute('data-progress', '');
    }
  }
}

function onScroll() {
  if (rafId) return;
  rafId = window.requestAnimationFrame(tick);
}

function onIntersect(entries) {
  for (const entry of entries) {
    if (entry.isIntersecting) {
      visibleSections.add(entry.target);
    } else {
      visibleSections.delete(entry.target);
    }
  }
  // Recompute once on enter/exit so freshly-visible sections paint a
  // sensible initial progress without waiting for the next scroll event.
  if (!rafId) {
    rafId = window.requestAnimationFrame(tick);
  }
}

function install() {
  if (installed) return;
  if (typeof window.IntersectionObserver !== 'function') return; // defensive
  if (reducedMotionMq && reducedMotionMq.matches) return;

  const sections = document.querySelectorAll(REVEAL_SELECTOR);
  if (!sections.length) return;

  visibleSections = new Set();
  observer = new IntersectionObserver(onIntersect, { threshold: 0 });
  for (const section of sections) {
    observer.observe(section);
  }

  scrollHandler = onScroll;
  window.addEventListener('scroll', scrollHandler, { passive: true });
  window.addEventListener('resize', scrollHandler, { passive: true });

  // Initial paint so any section already on screen at install time gets a
  // progress sample without waiting for user scroll.
  rafId = window.requestAnimationFrame(tick);

  installed = true;
}

function uninstall() {
  if (!installed) return;
  if (observer) {
    observer.disconnect();
    observer = null;
  }
  if (scrollHandler) {
    window.removeEventListener('scroll', scrollHandler);
    window.removeEventListener('resize', scrollHandler);
    scrollHandler = null;
  }
  if (rafId) {
    window.cancelAnimationFrame(rafId);
    rafId = 0;
  }
  if (visibleSections) {
    for (const section of document.querySelectorAll(REVEAL_SELECTOR)) {
      section.style.removeProperty('--ap-progress');
      section.removeAttribute('data-progress');
    }
    visibleSections.clear();
    visibleSections = null;
  }
  installed = false;
}

/**
 * Install the section-transition fallback.
 *
 * Returns a teardown function for tests / hot reload. When the user agent
 * supports `animation-timeline: view` the returned function is a no-op
 * because nothing was installed.
 */
export function installTransitions() {
  if (nativelySupported()) {
    return () => {};
  }

  reducedMotionMq = window.matchMedia('(prefers-reduced-motion: reduce)');
  onMqChange = () => {
    if (reducedMotionMq.matches) {
      uninstall();
    } else {
      install();
    }
  };
  reducedMotionMq.addEventListener('change', onMqChange);

  install();

  return () => {
    uninstall();
    if (reducedMotionMq && onMqChange) {
      reducedMotionMq.removeEventListener('change', onMqChange);
      reducedMotionMq = null;
      onMqChange = null;
    }
  };
}
