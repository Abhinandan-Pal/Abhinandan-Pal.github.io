// scripts/spotlight.js
//
// Spotlight — adds a warm radial gradient highlight on [data-spotlight]
// elements. Two modes:
//
//  • Pointer-fine devices (mouse, trackpad): the gradient follows the
//    cursor via `--mouse-x` / `--mouse-y` updated on pointermove.
//  • Touch / pointer-coarse devices: an IntersectionObserver activates
//    the entry currently centred in the viewport, fixing the gradient
//    at the card's centre point. This produces a natural "the card you
//    are reading lights up" effect as the visitor scrolls on a phone.
//
// The CSS rule reads `--spotlight-opacity` (0..1) to fade the layer in
// and out, and the cursor-position custom properties to position it.

const FOCUSED_CLASS = 'is-focused';

let elements = [];
let installed = false;
let pointerFineMq = null;
let reducedMotionMq = null;
let onMqChange = null;
let scrollCleanup = null;

function onMove(e) {
  const el = e.currentTarget;
  const rect = el.getBoundingClientRect();
  const x = e.clientX - rect.left;
  const y = e.clientY - rect.top;
  el.style.setProperty('--mouse-x', `${x}px`);
  el.style.setProperty('--mouse-y', `${y}px`);
  el.style.setProperty('--spotlight-opacity', '1');
}

function onEnter(e) {
  e.currentTarget.style.setProperty('--spotlight-opacity', '1');
}

function onLeave(e) {
  e.currentTarget.style.setProperty('--spotlight-opacity', '0');
}

function attachPointer(el) {
  el.addEventListener('pointermove', onMove);
  el.addEventListener('pointerenter', onEnter);
  el.addEventListener('pointerleave', onLeave);
}

function detachPointer(el) {
  el.removeEventListener('pointermove', onMove);
  el.removeEventListener('pointerenter', onEnter);
  el.removeEventListener('pointerleave', onLeave);
  el.style.removeProperty('--mouse-x');
  el.style.removeProperty('--mouse-y');
  el.style.removeProperty('--spotlight-opacity');
}

// Touch path: the entry whose centre is closest to the viewport centre
// gets `.is-focused`. We re-evaluate on scroll via a single rAF-throttled
// listener (cheaper than per-element IO callbacks for a small list).
function pickFocused() {
  if (!elements.length) return;
  const vh = window.innerHeight;
  const centerY = vh / 2;
  let best = null;
  let bestDist = Infinity;
  for (const el of elements) {
    const rect = el.getBoundingClientRect();
    if (rect.bottom < 0 || rect.top > vh) continue;
    const elCenter = rect.top + rect.height / 2;
    const d = Math.abs(elCenter - centerY);
    if (d < bestDist) {
      bestDist = d;
      best = el;
    }
  }
  for (const el of elements) {
    if (el === best) {
      el.classList.add(FOCUSED_CLASS);
      // Centre the gradient on the card so CSS doesn't fall back to 50%/50%
      // (which would still be valid, but explicit values keep the motion
      // smooth if the visitor switches modes mid-session).
      el.style.setProperty('--mouse-x', '50%');
      el.style.setProperty('--mouse-y', '50%');
    } else {
      el.classList.remove(FOCUSED_CLASS);
    }
  }
}

function installScrollMode() {
  let ticking = false;
  const onScroll = () => {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(() => {
      pickFocused();
      ticking = false;
    });
  };
  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', onScroll, { passive: true });
  pickFocused();
  scrollCleanup = () => {
    window.removeEventListener('scroll', onScroll);
    window.removeEventListener('resize', onScroll);
    for (const el of elements) {
      el.classList.remove(FOCUSED_CLASS);
      el.style.removeProperty('--mouse-x');
      el.style.removeProperty('--mouse-y');
    }
  };
}

function install() {
  if (installed) return;
  if (reducedMotionMq.matches) return;
  elements = Array.from(document.querySelectorAll('[data-spotlight]'));
  if (!elements.length) return;
  if (pointerFineMq.matches) {
    for (const el of elements) attachPointer(el);
  } else {
    installScrollMode();
  }
  installed = true;
}

function uninstall() {
  if (!installed) return;
  if (pointerFineMq.matches) {
    for (const el of elements) detachPointer(el);
  } else if (scrollCleanup) {
    scrollCleanup();
    scrollCleanup = null;
  }
  elements = [];
  installed = false;
}

export function installSpotlight() {
  pointerFineMq = window.matchMedia('(pointer: fine)');
  reducedMotionMq = window.matchMedia('(prefers-reduced-motion: reduce)');
  onMqChange = () => {
    uninstall();
    install();
  };
  pointerFineMq.addEventListener('change', onMqChange);
  reducedMotionMq.addEventListener('change', onMqChange);
  install();
  return () => {
    uninstall();
    pointerFineMq.removeEventListener('change', onMqChange);
    reducedMotionMq.removeEventListener('change', onMqChange);
  };
}
