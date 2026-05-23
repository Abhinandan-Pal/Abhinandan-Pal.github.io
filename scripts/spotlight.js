// scripts/spotlight.js
//
// Spotlight — adds a cursor-following radial gradient on every
// [data-spotlight] element. Sets `--mouse-x` and `--mouse-y` (in pixels,
// relative to the element's top-left) on pointermove so CSS can render a
// radial gradient that tracks the cursor. On pointerleave, transitions
// the gradient out.

const STRENGTH = 1; // 1:1 mapping of pointer offset to CSS variable

function onMove(e) {
  const el = e.currentTarget;
  const rect = el.getBoundingClientRect();
  const x = (e.clientX - rect.left) * STRENGTH;
  const y = (e.clientY - rect.top) * STRENGTH;
  el.style.setProperty('--mouse-x', `${x}px`);
  el.style.setProperty('--mouse-y', `${y}px`);
  el.style.setProperty('--spotlight-opacity', '1');
}

function onEnter(e) {
  const el = e.currentTarget;
  el.style.setProperty('--spotlight-opacity', '1');
}

function onLeave(e) {
  const el = e.currentTarget;
  el.style.setProperty('--spotlight-opacity', '0');
}

function attach(el) {
  el.addEventListener('pointermove', onMove);
  el.addEventListener('pointerenter', onEnter);
  el.addEventListener('pointerleave', onLeave);
}

function detach(el) {
  el.removeEventListener('pointermove', onMove);
  el.removeEventListener('pointerenter', onEnter);
  el.removeEventListener('pointerleave', onLeave);
  el.style.removeProperty('--mouse-x');
  el.style.removeProperty('--mouse-y');
  el.style.removeProperty('--spotlight-opacity');
}

let elements = [];
let installed = false;
let pointerFineMq = null;
let reducedMotionMq = null;
let onMqChange = null;

function shouldInstall() {
  return pointerFineMq.matches && !reducedMotionMq.matches;
}

function install() {
  if (installed) return;
  if (!shouldInstall()) return;
  elements = Array.from(document.querySelectorAll('[data-spotlight]'));
  for (const el of elements) attach(el);
  installed = true;
}

function uninstall() {
  if (!installed) return;
  for (const el of elements) detach(el);
  elements = [];
  installed = false;
}

export function installSpotlight() {
  pointerFineMq = window.matchMedia('(pointer: fine)');
  reducedMotionMq = window.matchMedia('(prefers-reduced-motion: reduce)');
  onMqChange = () => {
    if (shouldInstall()) install();
    else uninstall();
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
