// scripts/motif.js
//
// motif core algorithm — neural-node-graph procedurally drawn on a
// 2D canvas behind the hero.
//
// 3.5 (max background opacity 0.35), 11.9 (≤ 15 KB gzipped), 13.1 (deterministic
// per-seed identity).
//
// motif algorithm" and. The runtime install (IO pause, reduced-motion
// gate, OffscreenCanvas, SVG fallback) lives in `scripts/motif/runtime.js`
//; this module is the pure rendering core.

import { mulberry32, poissonDisk, kNearest, lerp, clamp } from './motif/rng.js';

const TAU = Math.PI * 2;

// Module-level state. Private; exposed only via the named exports below.
let nodes = [];
let edges = [];
let running = true;
let canvas = null;
let ctx = null;
let dpr = 1;
let maxDist = 1; // largest edge length, used for signal-strength lineWidth.

// Mouse interaction state.
const mouse = { x: -1, y: -1, active: false };
const MOUSE_RADIUS = 0.25; // normalised radius of influence
const MOUSE_STRENGTH = 0.08; // max displacement at cursor centre

/**
 * Build the motif graph for `seed` and `density` and attach it to `canvas`.
 *
 * Produces `|nodes| ∈ [30, 120]` and `|edges| ∈ [40, 240]`. The
 * algorithm is deterministic in `seed`: re-seeding yields the same graph, so
 * the build-time SVG fallback and the runtime canvas agree.
 *
 * @param {{ canvas: HTMLCanvasElement, seed: number, density: number }} opts
 */
export function init(opts) {
  canvas = opts.canvas;
  ctx = canvas.getContext('2d');
  dpr = Math.min(
    (typeof window !== 'undefined' && window.devicePixelRatio) || 1,
    2,
  );

  const seed = opts.seed >>> 0;
  const density = clamp(typeof opts.density === 'number' ? opts.density : 0.5, 0, 1);
  const n = clamp(Math.round(30 + density * 90), 30, 120);
  const k = density < 0.5 ? 2 : density < 0.85 ? 3 : 4;

  const rng = mulberry32(seed);
  const pts = poissonDisk(n, 0.85 / Math.sqrt(n), rng);
  // poissonDisk returns ≤ n; pad with uniform random points when the jittered
  // grid drops below the 30-node floor so  is never violated.
  while (pts.length < 30) pts.push({ x: rng(), y: rng() });

  nodes = pts.map((p) => ({
    x: p.x,
    y: p.y,
    target: { x: p.x, y: p.y },
    phase: rng() * TAU,
    amp: lerp(0.008, 0.022, rng()),
  }));

  edges = buildEdges(nodes, k, rng);
  maxDist = computeMaxDist(edges) || 1;

  // Install mouse tracking on the document (canvas has pointer-events: none).
  if (typeof window !== 'undefined' && !opts._mouseInstalled) {
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseleave', onMouseLeave);
    opts._mouseInstalled = true;
  }

  running = true;
}

/**
 * Toggle the rAF gate without tearing down the graph.
 *
 * Used by the IntersectionObserver — pause off-screen and by the
 * `prefers-reduced-motion` gate — single static frame.
 *
 * @param {boolean} value
 */
export function setRunning(value) {
  running = !!value;
}

/**
 * Render one frame at animation time `t` (milliseconds, monotonic).
 *
 * Reads `--color-line` and `--color-accent-2` from the canvas's computed style
 * so the motif inherits any token override — token-only paint.
 * Sets `globalAlpha = 0.35`
 *
 * @param {number} t - Animation time in milliseconds.
 */
export function frame(t) {
  if (!running || !ctx || !canvas) return;

  const W = canvas.width;
  const H = canvas.height;

  // Resolve token-bound stroke and fill from the canvas's computed style.
  let stroke = '';
  let fill = '';
  if (typeof window !== 'undefined' && window.getComputedStyle) {
    const cs = window.getComputedStyle(canvas);
    stroke = cs.getPropertyValue('--color-line').trim();
    fill = cs.getPropertyValue('--color-accent-2').trim();
  }

  ctx.clearRect(0, 0, W, H);
  ctx.globalAlpha = 0.55; // more visible across the full page

  // Advance per-node drift around its static target (thematic motion).
  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i];
    let nx = n.target.x + Math.sin(t * 0.0006 + n.phase) * n.amp;
    let ny = n.target.y + Math.cos(t * 0.0005 + n.phase) * n.amp;

    // Mouse repulsion: gently push nodes away from cursor.
    if (mouse.active) {
      const dx = nx - mouse.x;
      const dy = ny - mouse.y;
      const dist = Math.hypot(dx, dy);
      if (dist < MOUSE_RADIUS && dist > 0.001) {
        const force = (1 - dist / MOUSE_RADIUS) * MOUSE_STRENGTH;
        nx += (dx / dist) * force;
        ny += (dy / dist) * force;
      }
    }

    n.x = nx;
    n.y = ny;
  }

  // Draw edges with signal-strength width: shorter edges read as stronger.
  ctx.strokeStyle = stroke || 'currentColor';
  for (let i = 0; i < edges.length; i++) {
    const e = edges[i];
    const dx = e.a.x - e.b.x;
    const dy = e.a.y - e.b.y;
    const d = Math.hypot(dx, dy);
    ctx.lineWidth = lerp(2.2, 0.7, d / maxDist) * dpr;
    ctx.beginPath();
    ctx.moveTo(e.a.x * W, e.a.y * H);
    ctx.lineTo(e.b.x * W, e.b.y * H);
    ctx.stroke();
  }

  // Draw nodes as 2.5 CSS-px filled discs (scaled to backing-store pixels).
  ctx.fillStyle = fill || 'currentColor';
  const r = 2.5 * dpr;
  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i];
    ctx.beginPath();
    ctx.arc(n.x * W, n.y * H, r, 0, TAU);
    ctx.fill();
  }
}

/** Test hook: number of generated nodes. */
export function getNodeCount() {
  return nodes.length;
}

/** Test hook: number of generated edges. */
export function getEdgeCount() {
  return edges.length;
}

// ---------------------------------------------------------------------------
// Mouse interaction handlers
// ---------------------------------------------------------------------------

function onMouseMove(e) {
  if (!canvas) return;
  const rect = canvas.getBoundingClientRect();
  mouse.x = (e.clientX - rect.left) / rect.width;
  mouse.y = (e.clientY - rect.top) / rect.height;
  mouse.active = true;
}

function onMouseLeave() {
  mouse.active = false;
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

/**
 * Stitch an undirected edge set across `nodes` using each node's `k` nearest
 * neighbours, deduped by sorted index pair. Pads up to 40 by widening `k` and
 * drops random surplus down to 240 — both inclusive bounds from .
 *
 * @param {Array<{x:number,y:number}>} ns
 * @param {number} k
 * @param { => number} rng
 * @returns {Array<{a:object,b:object}>}
 */
function buildEdges(ns, k, rng) {
  const N = ns.length;
  const seen = new Set();
  const out = [];
  // Cache identity → index lookup once; kNearest returns the same references.
  const indexOf = new Map();
  for (let i = 0; i < N; i++) indexOf.set(ns[i], i);

  const addNeighbours = (kk) => {
    for (let i = 0; i < N; i++) {
      const ni = ns[i];
      const neighbours = kNearest(ns, ni, kk);
      for (let p = 0; p < neighbours.length; p++) {
        const m = neighbours[p];
        const j = indexOf.get(m);
        const a = i < j ? i : j;
        const b = i < j ? j : i;
        const key = a * N + b;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({ a: ns[a], b: ns[b] });
      }
    }
  };

  addNeighbours(k);

  // or exhaust available neighbours.
  let kk = k + 1;
  while (out.length < 40 && kk <= N - 1) {
    addNeighbours(kk);
    kk++;
  }

  while (out.length > 240) {
    const idx = Math.floor(rng() * out.length);
    out.splice(idx, 1);
  }

  return out;
}

function computeMaxDist(es) {
  let m = 0;
  for (let i = 0; i < es.length; i++) {
    const e = es[i];
    const dx = e.a.x - e.b.x;
    const dy = e.a.y - e.b.y;
    const d = Math.hypot(dx, dy);
    if (d > m) m = d;
  }
  return m;
}
