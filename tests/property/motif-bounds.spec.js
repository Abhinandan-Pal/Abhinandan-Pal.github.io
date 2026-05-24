// tests/property/motif-bounds.spec.js
//
//  — motif bounds, opacity, and token-only paint.
//
//
// This file is the property test referenced by BOTH .7
// (initial authorship) and .5 (cross-reference; spy fixture
// covers both background-mode and static-frame-mode draws). Where the
// substrate test in `motif-rng.spec.js` covers the pure helpers
// (`mulberry32`, `poissonDisk`, `kNearest`, …), this spec exercises the
// full motif core in `scripts/motif.js`: it builds a graph for a randomly
// generated `(seed, density)` pair, renders frames against a recording
// 2D context, and asserts four invariants jointly across 200 fast-check
// runs:
//
//   1. `|N| ∈ [30, 120]`lower / upper bound.
//   2. `|E| ∈ [40, 240]`edge bounds.
//   3. every `fillStyle` / `strokeStyle` assignment resolves to a value
//      coming from a design system custom property (— token-only
//      paint).
//   4. every `globalAlpha` written during a frame draw is ≤ 0.35,
//      whether the draw is the per-rAF background-mode tick or the single
//      static-frame draw used under `prefers-reduced-motion: reduce`
// and by the off-screen pause path.
//
// Both modes share the same `frame` entry point in `scripts/motif.js`,
// so the same invariants apply, but the runtime install in
// `scripts/motif/runtime.js` calls into `frame` two distinct ways:
//
//   - background mode: `setRunning(true)` and a recurring rAF loop that
//     calls `frame(t)` for monotonically increasing `t`.
//   - static-frame mode: a single `frame(0)` followed by `setRunning(false)`
//     so subsequent ticks (for example, a stray rAF that survives a
//     reduced-motion toggle) early-return without painting.
//
// The two `it` blocks below cover both paths against the same spy fixture.
//
// Determinism — the precondition for the build-time SVG fallback
// and the favicon agreeing with the runtime canvas — is covered
// at the substrate level in `motif-rng.spec.js`. This spec inherits that
// guarantee via `mulberry32`, which `motif.js` uses for every random
// choice.
//
// ---------------------------------------------------------------------------
// Why we stub `globalThis.window` instead of running under jsdom
// ---------------------------------------------------------------------------
// `scripts/motif.js` is tolerant of a missing `window` (every reference is
// gated behind `typeof window !== 'undefined'`), but in that fallback path
// `frame` skips the `getComputedStyle` lookup and falls back to a literal
// `'currentColor'`, which would defeat invariant (3) above. Installing a
// minimal `window` shim at module scope (before any test runs) lets the
// motif's real token-resolution path execute end-to-end against a known set
// of token values, so we can assert that every paint call landed on one of
// them.
//
// We deliberately avoid pulling in `jsdom` for this single test: the
// motif's `<canvas>` consumer surface is tiny (`getContext`, `width`,
// `height`) and a hand-built mock keeps the test fast and dependency-free.

// Install the `window` shim before importing the motif. ES module imports
// are hoisted, but `motif.js` only reads `window` from inside `init` and
// `frame`, both of which run later than this module's top-level code, so
// the shim is in place by the time those functions execute.
const TOKEN_STROKE = 'rgb(201, 191, 177)'; // stand-in for --color-line
const TOKEN_FILL = 'rgb(201, 140, 90)'; //   stand-in for --color-accent-2

if (typeof globalThis.window === 'undefined') {
  globalThis.window = {
    devicePixelRatio: 1,
    getComputedStyle() {
      return {
        getPropertyValue(name) {
          if (name === '--color-line') return TOKEN_STROKE;
          if (name === '--color-accent-2') return TOKEN_FILL;
          return '';
        },
      };
    },
  };
}

import { describe, it, vi } from 'vitest';
import * as fc from 'fast-check';
import {
  init,
  frame,
  setRunning,
  getNodeCount,
  getEdgeCount,
} from '../../scripts/motif.js';

// The full set of values that any paint setter is allowed to take. Empty
// strings are tolerated because some browsers (and some IDE-style mocks)
// produce empty `getPropertyValue` results before tokens resolve; the motif
// itself short-circuits to a fallback when the lookup is empty, but in
// practice our shim always returns a token string.
const ALLOWED_STROKES = new Set([TOKEN_STROKE, '']);
const ALLOWED_FILLS = new Set([TOKEN_FILL, '']);

/**
 * Build a recording 2D-context mock backed by `defineProperty` accessors so
 * the `vi.spyOn(ctx, prop, 'set')` API can attach to every paint setter the
 * task description calls out. The mock implements the surface `motif.js`
 * actually consumes (`clearRect`, `beginPath`, `moveTo`, `lineTo`, `arc`,
 * `stroke`, `fill`, plus `fillStyle` / `strokeStyle` / `globalAlpha` /
 * `lineWidth` setters). Every other property a real
 * `CanvasRenderingContext2D` exposes is simply absent.
 */
function makeRecordingContext() {
  const state = {
    fillStyle: '',
    strokeStyle: '',
    globalAlpha: 1,
    lineWidth: 1,
  };
  const ctx = {
    clearRect() {},
    beginPath() {},
    moveTo() {},
    lineTo() {},
    arc() {},
    stroke() {},
    fill() {},
  };
  Object.defineProperty(ctx, 'fillStyle', {
    configurable: true,
    enumerable: true,
    get() {
      return state.fillStyle;
    },
    set(v) {
      state.fillStyle = v;
    },
  });
  Object.defineProperty(ctx, 'strokeStyle', {
    configurable: true,
    enumerable: true,
    get() {
      return state.strokeStyle;
    },
    set(v) {
      state.strokeStyle = v;
    },
  });
  Object.defineProperty(ctx, 'globalAlpha', {
    configurable: true,
    enumerable: true,
    get() {
      return state.globalAlpha;
    },
    set(v) {
      state.globalAlpha = v;
    },
  });
  Object.defineProperty(ctx, 'lineWidth', {
    configurable: true,
    enumerable: true,
    get() {
      return state.lineWidth;
    },
    set(v) {
      state.lineWidth = v;
    },
  });
  return ctx;
}

/**
 * Wrap a recording context so that the three paint-relevant setters
 * (`fillStyle`, `strokeStyle`, `globalAlpha`) are observed via
 * `vi.spyOn(..., 'set')`. Returns the spies and a `restore` callback so
 * each fast-check iteration can clean up after itself.
 */
function spyPaintSetters(ctx) {
  const fillStyleSet = vi.spyOn(ctx, 'fillStyle', 'set');
  const strokeStyleSet = vi.spyOn(ctx, 'strokeStyle', 'set');
  const globalAlphaSet = vi.spyOn(ctx, 'globalAlpha', 'set');
  return {
    fillStyleSet,
    strokeStyleSet,
    globalAlphaSet,
    restore() {
      fillStyleSet.mockRestore();
      strokeStyleSet.mockRestore();
      globalAlphaSet.mockRestore();
    },
  };
}

/** Build a mock `<canvas>` for `motif.js` to attach to. */
function makeMockCanvas(ctx) {
  return {
    width: 800,
    height: 600,
    getContext() {
      return ctx;
    },
  };
}

const seedArb = fc.integer({ min: 0, max: 0xffffffff });
const densityArb = fc.double({ min: 0, max: 1, noNaN: true });

describe('motif bounds, opacity, and token-only paint', () => {
  it('background mode: |N| ∈ [30,120], |E| ∈ [40,240], paint setters resolve to tokens, globalAlpha ≤ 0.35', () => {
    // One combined property, evaluated 200 times against a randomly
    // generated `(seed, density)` pair, asserts the four invariants of
    //  jointly. Using a single `fc.assert` call rather than
    // splitting the four invariants into separate properties means a
    // counter-example reports the exact `(seed, density)` that broke any
    // one of them — which is the whole point of property-based testing
    // here.
    fc.assert(
      fc.property(seedArb, densityArb, (seed, density) => {
        const ctx = makeRecordingContext();
        const canvas = makeMockCanvas(ctx);
        const spies = spyPaintSetters(ctx);
        try {
          // Build the graph and render exactly one background-mode frame.
          init({ canvas, seed, density });

          // (1) + (2) — : node and edge counts within the
          // documented inclusive bounds.
          const N = getNodeCount();
          const E = getEdgeCount();
          if (N < 30 || N > 120) return false;
          if (E < 40 || E > 240) return false;

          setRunning(true);
          frame(0);

          // (3) — : every paint setter call must have received a
          // value drawn from a design system custom property. The shim
          // installed at the top of this file maps `--color-line` to
          // `TOKEN_STROKE` and `--color-accent-2` to `TOKEN_FILL`; any
          // other observed value would mean `motif.js` painted with a
          // literal, which is the regression we're guarding against.
          for (const call of spies.strokeStyleSet.mock.calls) {
            if (!ALLOWED_STROKES.has(call[0])) return false;
          }
          for (const call of spies.fillStyleSet.mock.calls) {
            if (!ALLOWED_FILLS.has(call[0])) return false;
          }

          // (4) — : a background-mode frame caps `globalAlpha` at
          // 0.35. Every observed write to the setter must therefore land
          // inside that envelope.
          for (const call of spies.globalAlphaSet.mock.calls) {
            const v = call[0];
            if (!(typeof v === 'number') || v > 0.35) return false;
          }

          return true;
        } finally {
          spies.restore();
        }
      }),
      { numRuns: 200 },
    );
  });

  it('static-frame mode: a single reduced-motion frame obeys the same paint and alpha envelope, and `setRunning(false)` halts subsequent draws', () => {
    // Mirror image of the background-mode property, but exercises the
    // code path the runtime install takes when `prefers-reduced-motion:
    // reduce` is active (`scripts/motif/runtime.js`):
    //
    //   motif.init(...)
    //   motif.frame(0)          // exactly one static frame
    //   motif.setRunning(false) // any later rAF survivor must no-op
    //
    // Two extra invariants beyond the background-mode block:
    //
    //   - the static frame produces at least one paint observation
    //     (otherwise the spy fixture is testing nothing).
    //   - a follow-up `frame(t)` after `setRunning(false)` is a complete
    //     no-op: no `fillStyle`, `strokeStyle`, or `globalAlpha` write.
    //     This guards  ("SHALL render as a single static frame
    //     and SHALL not call requestAnimationFrame") at the rendering
    //     layer: even if a stray rAF callback survives the toggle, the
    //     motif must not paint.
    //
    // numRuns is held at 200 to match the background-mode block; the
    // two combined keep the file under fast-check's default time budget
    // while exercising both modes.
    fc.assert(
      fc.property(seedArb, densityArb, (seed, density) => {
        const ctx = makeRecordingContext();
        const canvas = makeMockCanvas(ctx);
        const spies = spyPaintSetters(ctx);
        try {
          init({ canvas, seed, density });

          // (1) + (2) — node/edge bounds hold regardless of mode.
          const N = getNodeCount();
          const E = getEdgeCount();
          if (N < 30 || N > 120) return false;
          if (E < 40 || E > 240) return false;

          // Static-frame draw: runtime.js issues one `frame(0)` before
          // pinning the gate closed. We replicate that exact sequence.
          setRunning(true);
          frame(0);

          // The static frame must have actually painted something; if
          // nothing was observed, the spy fixture is mis-wired and the
          // remaining assertions would vacuously pass.
          const staticPaintCalls =
            spies.strokeStyleSet.mock.calls.length +
            spies.fillStyleSet.mock.calls.length +
            spies.globalAlphaSet.mock.calls.length;
          if (staticPaintCalls === 0) return false;

          // (3) — : token-only paint, same as the background-mode
          // block. The reduced-motion path uses the identical `frame`
          // body, but we re-assert here so a regression that special-
          // cases reduced-motion to a literal colour is caught.
          for (const call of spies.strokeStyleSet.mock.calls) {
            if (!ALLOWED_STROKES.has(call[0])) return false;
          }
          for (const call of spies.fillStyleSet.mock.calls) {
            if (!ALLOWED_FILLS.has(call[0])) return false;
          }

          // (4) — : alpha envelope, same bound for static frames.
          for (const call of spies.globalAlphaSet.mock.calls) {
            const v = call[0];
            if (!(typeof v === 'number') || v > 0.35) return false;
          }

          // Snapshot pre-stop call counts so the post-stop assertion can
          // tell new draws from the static one we just took.
          const fillCallsBefore = spies.fillStyleSet.mock.calls.length;
          const strokeCallsBefore = spies.strokeStyleSet.mock.calls.length;
          const alphaCallsBefore = spies.globalAlphaSet.mock.calls.length;

          // Pin the rAF gate closed and verify a subsequent frame
          // tick is a complete no-op. The `t` is non-zero to make sure
          // the early-return condition is `running`, not `t`.
          setRunning(false);
          frame(16);

          if (spies.fillStyleSet.mock.calls.length !== fillCallsBefore) return false;
          if (spies.strokeStyleSet.mock.calls.length !== strokeCallsBefore) return false;
          if (spies.globalAlphaSet.mock.calls.length !== alphaCallsBefore) return false;

          return true;
        } finally {
          spies.restore();
        }
      }),
      { numRuns: 200 },
    );
  });
});
