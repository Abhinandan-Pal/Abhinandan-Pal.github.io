// scripts/reveal.js
//
// RevealObserver — single shared IntersectionObserver that adds `.is-visible`
// to every `[data-reveal]` section the first time it crosses the 0.15 ratio
// threshold, then unobserves it so the reveal cannot replay.
// `prefers-reduced-motion` is checked at install time; under reduced motion
// the observer is replaced with an immediate `.is-visible` add to every
// section so the document settles to its final state without animation
//. Live media-query change events install or tear down the
// observer accordingly.
//

const REVEAL_SELECTOR = '[data-reveal]';

let observer = null;
let reducedMotionMq = null;
let onChangeListener = null;

function applyVisibleEverywhere() {
  for (const el of document.querySelectorAll(REVEAL_SELECTOR)) {
    el.classList.add('is-visible');
  }
}

function installObserver() {
  if (observer) return;
  if (typeof window.IntersectionObserver !== 'function') {
    // No IntersectionObserver — fall back to immediate visibility.
    applyVisibleEverywhere();
    return;
  }
  observer = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (entry.isIntersecting && entry.intersectionRatio >= 0.15) {
        entry.target.classList.add('is-visible');
        observer.unobserve(entry.target); // no replay
      }
    }
  }, { threshold: 0.15 });
  for (const el of document.querySelectorAll(REVEAL_SELECTOR)) {
    observer.observe(el);
  }
}

function teardownObserver() {
  if (!observer) return;
  observer.disconnect();
  observer = null;
}

function onReducedMotionChange() {
  if (reducedMotionMq.matches) {
    teardownObserver();
    applyVisibleEverywhere();
  } else {
    // Re-add observers for any sections still missing .is-visible. (Sections
    // already revealed under reduced motion stay revealed; the observer just
    // skips them when they're already at their final state.)
    installObserver();
  }
}

export function installReveal() {
  reducedMotionMq = window.matchMedia('(prefers-reduced-motion: reduce)');
  onChangeListener = onReducedMotionChange;
  reducedMotionMq.addEventListener('change', onChangeListener);

  if (reducedMotionMq.matches) {
    applyVisibleEverywhere();
  } else {
    installObserver();
  }

  // Return teardown function (used by tests).
  return () => {
    teardownObserver();
    if (reducedMotionMq && onChangeListener) {
      reducedMotionMq.removeEventListener('change', onChangeListener);
    }
  };
}
