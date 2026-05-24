// scripts/spotlight.js
//
// Spotlight — adds a cursor-following radial gradient on [data-spotlight]
// elements on pointer-fine devices (mouse, trackpad). Disabled on touch.
//
// Sets `--mouse-x` and `--mouse-y` on pointermove so CSS can render a
// radial gradient that tracks the cursor. On pointerleave, fades out.

let elements = [];
let installed = false;
let pointerFineMq = null;
let reducedMotionMq = null;
let onMqChange = null;

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

function install() {
  if (installed) return;
  if (reducedMotionMq.matches) return;
  if (!pointerFineMq.matches) return;
  elements = Array.from(document.querySelectorAll('[data-spotlight]'));
  if (!elements.length) return;
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
