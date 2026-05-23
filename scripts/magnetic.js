// scripts/magnetic.js
//
// MagneticHover — translates [data-magnetic] elements up to ±8 px toward the
// pointer on pointer-fine devices when reduced motion is not active.
//

const MAX_OFFSET_PX = 8;
const RELEASE_MS = 220;
const STRENGTH = 0.3; // pointer offset → element translate ratio

let elements = [];
let installed = false;
let pointerFineMq = null;
let reducedMotionMq = null;
let onMqChange = null;

function onMove(e) {
  const el = e.currentTarget;
  const rect = el.getBoundingClientRect();
  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;
  const dx = (e.clientX - cx) * STRENGTH;
  const dy = (e.clientY - cy) * STRENGTH;
  const tx = Math.max(-MAX_OFFSET_PX, Math.min(MAX_OFFSET_PX, dx));
  const ty = Math.max(-MAX_OFFSET_PX, Math.min(MAX_OFFSET_PX, dy));
  el.style.transition = 'transform 0ms';
  el.style.transform = `translate(${tx}px, ${ty}px)`;
}

function onLeave(e) {
  const el = e.currentTarget;
  el.style.transition = `transform ${RELEASE_MS}ms cubic-bezier(.2, .8, .2, 1)`;
  el.style.transform = 'translate(0, 0)';
}

function attach(el) {
  el.addEventListener('pointermove', onMove);
  el.addEventListener('pointerleave', onLeave);
}

function detach(el) {
  el.removeEventListener('pointermove', onMove);
  el.removeEventListener('pointerleave', onLeave);
  el.style.transition = '';
  el.style.transform = '';
}

function shouldInstall() {
  return pointerFineMq.matches && !reducedMotionMq.matches;
}

function install() {
  if (installed) return;
  if (!shouldInstall()) return;
  elements = Array.from(document.querySelectorAll('[data-magnetic]'));
  for (const el of elements) attach(el);
  installed = true;
}

function uninstall() {
  if (!installed) return;
  for (const el of elements) detach(el);
  elements = [];
  installed = false;
}

export function installMagnetic() {
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
