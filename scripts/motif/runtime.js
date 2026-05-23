// scripts/motif/runtime.js
//
// Runtime install layer for the motif. Wraps the pure rendering
// core in scripts/motif.js with feature-detection, IntersectionObserver
// pause-when-offscreen, prefers-reduced-motion gating, and a reduced-motion
// single-frame draw.
//
// TODO: An OffscreenCanvas + Worker variant (`scripts/motif.worker.js`,
// ≤ 4 KB, see
// notes and) is a future optimisation. The current implementation
// runs the rAF loop on the main thread for every user agent that has a
// 2D canvas context.
//

import * as motif from '../motif.js';

const DENSITY_MAP = { low: 0.2, medium: 0.5, high: 0.85 };

// Hash today's date string to a uint32 for deterministic per-day seeds.
// The same algorithm is used by `tools/render-svg-motif.mjs` so that the
// build-time SVG fallback can agree with the runtime canvas when both run
// on the same calendar day.
function todayHash() {
  const s = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

function readSeed(canvas) {
  const raw = canvas.getAttribute('data-motif-seed');
  if (raw == null) return todayHash();
  const n = Number(raw);
  if (Number.isFinite(n)) return n >>> 0;
  // Hash a string seed via the same FNV-1a-style mixer used above.
  let h = 2166136261 >>> 0;
  for (let i = 0; i < raw.length; i++) {
    h ^= raw.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

function readDensity(canvas) {
  const raw = canvas.getAttribute('data-motif-density');
  if (raw == null) return 0.5;
  if (Object.prototype.hasOwnProperty.call(DENSITY_MAP, raw)) return DENSITY_MAP[raw];
  const n = Number(raw);
  if (Number.isFinite(n)) return Math.max(0, Math.min(1, n));
  return 0.5;
}

function resizeCanvasToDisplaySize(canvas) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = Math.round(window.innerWidth * dpr);
  const h = Math.round(window.innerHeight * dpr);
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
}

function revealSvgFallback(canvas) {
  const svg =
    canvas.parentElement && canvas.parentElement.querySelector('svg.ap-motif-fallback');
  if (svg) svg.removeAttribute('hidden');
  // Hide the canvas so the fallback is the only visible motif.
  canvas.setAttribute('hidden', '');
}

/**
 * Install the motif on `canvas`.
 *
 * Returns a teardown function that cancels the rAF loop, disconnects every
 * observer, and removes the `prefers-reduced-motion` change listener.
 *
 * @param {HTMLCanvasElement} canvas
 * @returns { => void}
 */
export function installMotif(canvas) {
  if (!canvas || typeof canvas.getContext !== 'function') {
    return () => {};
  }

  // Canvas 2D feature detect. If unavailable, reveal the
  // pre-rendered SVG fallback and exit.
  let ctx;
  try {
    ctx = canvas.getContext('2d');
  } catch (_e) {
    ctx = null;
  }
  if (!ctx) {
    revealSvgFallback(canvas);
    return () => {};
  }

  const seed = readSeed(canvas);
  const density = readDensity(canvas);

  resizeCanvasToDisplaySize(canvas);
  motif.init({ canvas, seed, density });

  let rafId = 0;
  let running = true;
  const reducedMotionMq = window.matchMedia('(prefers-reduced-motion: reduce)');

  const tick = (t) => {
    if (!running) return;
    motif.frame(t);
    rafId = window.requestAnimationFrame(tick);
  };

  // The canvas is now fixed full-page, so it's always visible.
  // No IntersectionObserver needed for pause-when-offscreen.

  // ResizeObserver to keep the canvas's backing store sized to the element.
  // Re-running init on resize regenerates the graph for the same seed, so the
  // motif identity is preserved across viewport changes.
  let ro = null;
  if (typeof window.ResizeObserver === 'function') {
    ro = new ResizeObserver(() => {
      resizeCanvasToDisplaySize(canvas);
      motif.init({ canvas, seed, density });
    });
    ro.observe(canvas);
  }

  // Reduced-motion gate. On toggle, install or tear down the rAF
  // loop live.
  const onReducedMotionChange = () => {
    if (reducedMotionMq.matches) {
      running = false;
      motif.setRunning(false);
      if (rafId) {
        window.cancelAnimationFrame(rafId);
        rafId = 0;
      }
      // Draw a single static frame.
      motif.setRunning(true);
      motif.frame(0);
      motif.setRunning(false);
    } else {
      running = true;
      motif.setRunning(true);
      rafId = window.requestAnimationFrame(tick);
    }
  };
  reducedMotionMq.addEventListener('change', onReducedMotionChange);

  if (reducedMotionMq.matches) {
    // Single static frame, no rAF loop.
    motif.frame(0);
    motif.setRunning(false);
    running = false;
  } else {
    rafId = window.requestAnimationFrame(tick);
  }

  return () => {
    if (rafId) window.cancelAnimationFrame(rafId);
    if (ro) ro.disconnect();
    reducedMotionMq.removeEventListener('change', onReducedMotionChange);
  };
}
