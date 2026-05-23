// tests/property/motif-rng.spec.js
//
//  substrate — motif RNG and helper invariants.
//
//
// The motif is built on top of a small set of pure,
// deterministic numeric helpers in `scripts/motif/rng.js`. Before the full
// motif bounds property can run meaningfully, those helpers
// must satisfy a handful of substrate invariants:
//
//   * `mulberry32` is a deterministic PRNG: re-seeding with the same uint32
//     reproduces the exact same output sequence (— distinctive,
//     reproducible motif identity; build-time SVG fallback and runtime
//     canvas must agree).
//   * `mulberry32` outputs lie in `[0, 1)` (used as a uniform sampler by
//     `poissonDisk` and downstream callers).
//   * `poissonDisk` produces points in the unit square `[0, 1]²`, which
//     is what allows the motif to map to the hero bounding box
//     under any aspect ratio.
//   * `poissonDisk` actually respects its `minDist` constraint, so the
//     30..120 nodes of  do not collapse into visually-coincident
//     blobs.
//   * `kNearest`, `lerp`, `clamp` are correct on their own — they are the
//     small atoms that 7.7 will lean on to assert edge counts and bounded
//     drift.
//
// Each property uses `fc.assert(fc.property(...), { numRuns })` with at least
// 200 runs for the four motif-critical properties (mulberry32 determinism,
// mulberry32 range, poissonDisk bounds, poissonDisk minDist). The remaining
// helper properties use fewer iterations because their input space is
// trivial and exhausting it adds nothing.

import { describe, it } from 'vitest';
import * as fc from 'fast-check';
import {
  mulberry32,
  poissonDisk,
  kNearest,
  lerp,
  clamp,
} from '../../scripts/motif/rng.js';

// Generators reused across multiple properties.
const seedArb = fc.integer({ min: 0, max: 0xffffffff });
const densityArb = fc.double({ min: 0, max: 1, noNaN: true });
const finiteNumber = fc.double({
  min: -1e6,
  max: 1e6,
  noNaN: true,
  noDefaultInfinity: true,
});

/**
 * Translate the (seed, density) pair into the same (n, minDist) the runtime
 * uses, per the task description and :
 *
 *   n       = clamp(round(30 + density * 90), 30, 120)
 *   minDist = 0.85 / sqrt(n)
 *
 * The clamp is defensive: density is generated in `[0, 1]` so the round
 * already lands in `[30, 120]`, but pinning it explicitly means the test
 * documents the contract for future readers.
 */
function paramsFromDensity(density) {
  const raw = Math.round(30 + density * 90);
  const n = Math.max(30, Math.min(120, raw));
  const minDist = 0.85 / Math.sqrt(n);
  return { n, minDist };
}

describe(' substrate — motif RNG and helpers', () => {
  // ---------------------------------------------------------------------------
  // mulberry32
  // ---------------------------------------------------------------------------

  it('mulberry32 is deterministic for re-seeded instances', () => {
    // Property: For any uint32 seed, two PRNG instances seeded identically
    // produce the same sequence of N=100 outputs. This is what lets the
    // build-time SVG fallback and the runtime canvas agree on geometry
    //.
    fc.assert(
      fc.property(seedArb, (seed) => {
        const a = mulberry32(seed);
        const b = mulberry32(seed);
        for (let i = 0; i < 100; i++) {
          if (a() !== b()) return false;
        }
        return true;
      }),
      { numRuns: 200 },
    );
  });

  it('mulberry32 outputs are in [0, 1)', () => {
    // Property: Every output of a mulberry32 instance is a finite float
    // in `[0, 1)`. Downstream samplers (poissonDisk, drift in motif.js)
    // depend on this half-open range.
    fc.assert(
      fc.property(seedArb, (seed) => {
        const rng = mulberry32(seed);
        for (let i = 0; i < 100; i++) {
          const v = rng();
          if (!Number.isFinite(v)) return false;
          if (v < 0 || v >= 1) return false;
        }
        return true;
      }),
      { numRuns: 200 },
    );
  });

  // ---------------------------------------------------------------------------
  // poissonDisk
  // ---------------------------------------------------------------------------

  it('poissonDisk returns points in [0, 1]²', () => {
    // Property: For any (seed, density), every point produced by the
    // jittered-grid Poisson-disk sampler lies inside the unit square.
    // This is what guarantees the motif can be mapped to the hero
    // bounding box without manual normalisation.
    fc.assert(
      fc.property(seedArb, densityArb, (seed, density) => {
        const { n, minDist } = paramsFromDensity(density);
        const rng = mulberry32(seed);
        const points = poissonDisk(n, minDist, rng);
        for (const p of points) {
          if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) return false;
          if (p.x < 0 || p.x > 1) return false;
          if (p.y < 0 || p.y > 1) return false;
        }
        return true;
      }),
      { numRuns: 200 },
    );
  });

  it('poissonDisk respects minDist between every pair', () => {
    // Property: Every accepted pair of points is at least `minDist` apart
    // (Euclidean). The acceptance loop in `poissonDisk` guarantees this by
    // construction, but the property test pins the contract so future
    // refactors cannot quietly regress it.
    //
    // We use a small epsilon (1e-12) to absorb floating-point drift in the
    // square-root used to compute the actual distance. The implementation
    // compares squared distances internally and is therefore exact, but the
    // test computes `Math.hypot` for clarity.
    fc.assert(
      fc.property(seedArb, densityArb, (seed, density) => {
        const { n, minDist } = paramsFromDensity(density);
        const rng = mulberry32(seed);
        const points = poissonDisk(n, minDist, rng);
        const eps = 1e-12;
        for (let i = 0; i < points.length; i++) {
          for (let j = i + 1; j < points.length; j++) {
            const dx = points[i].x - points[j].x;
            const dy = points[i].y - points[j].y;
            const d = Math.hypot(dx, dy);
            if (d + eps < minDist) return false;
          }
        }
        return true;
      }),
      { numRuns: 200 },
    );
  });

  // ---------------------------------------------------------------------------
  // kNearest
  // ---------------------------------------------------------------------------

  it('kNearest returns ≤ k items and excludes the reference point', () => {
    // Property: For any list of N=10 points and any reference point chosen
    // from that list and any k ∈ [0, 10], the result has length ≤ k and
    // does not contain the reference point itself (kNearest excludes by
    // reference equality).
    const pointArb = fc.record({
      x: fc.double({ min: -10, max: 10, noNaN: true }),
      y: fc.double({ min: -10, max: 10, noNaN: true }),
    });
    fc.assert(
      fc.property(
        fc.array(pointArb, { minLength: 10, maxLength: 10 }),
        fc.integer({ min: 0, max: 9 }),
        fc.integer({ min: 0, max: 10 }),
        (nodes, refIndex, k) => {
          const ref = nodes[refIndex];
          const result = kNearest(nodes, ref, k);
          if (result.length > k) return false;
          for (const p of result) {
            if (p === ref) return false;
          }
          return true;
        },
      ),
      { numRuns: 100 },
    );
  });

  it('kNearest is sorted by ascending distance from the reference', () => {
    // Property: The returned points are in non-decreasing Euclidean
    // distance order from the reference point. This is what allows the
    // motif's edge-stitching pass to pick the "closest few" neighbours
    // without an extra sort.
    const pointArb = fc.record({
      x: fc.double({ min: -10, max: 10, noNaN: true }),
      y: fc.double({ min: -10, max: 10, noNaN: true }),
    });
    fc.assert(
      fc.property(
        fc.array(pointArb, { minLength: 10, maxLength: 10 }),
        fc.integer({ min: 0, max: 9 }),
        fc.integer({ min: 0, max: 10 }),
        (nodes, refIndex, k) => {
          const ref = nodes[refIndex];
          const result = kNearest(nodes, ref, k);
          for (let i = 1; i < result.length; i++) {
            const dxA = result[i - 1].x - ref.x;
            const dyA = result[i - 1].y - ref.y;
            const dxB = result[i].x - ref.x;
            const dyB = result[i].y - ref.y;
            const dA = dxA * dxA + dyA * dyA;
            const dB = dxB * dxB + dyB * dyB;
            if (dA > dB) return false;
          }
          return true;
        },
      ),
      { numRuns: 100 },
    );
  });

  // ---------------------------------------------------------------------------
  // lerp
  // ---------------------------------------------------------------------------

  it('lerp returns the endpoints at t=0 and t=1', () => {
    // Property: lerp(a, b, 0) === a and lerp(a, b, 1) === b for any finite
    // a, b. The implementation uses `a + (b - a) * t`; both endpoints are
    // exact in IEEE-754 because the multiply-by-zero or add-of-(b-a) cases
    // both reduce to one of the originals.
    fc.assert(
      fc.property(finiteNumber, finiteNumber, (a, b) => {
        return lerp(a, b, 0) === a && lerp(a, b, 1) === b;
      }),
      { numRuns: 100 },
    );
  });

  // ---------------------------------------------------------------------------
  // clamp
  // ---------------------------------------------------------------------------

  it('clamp(v, lo, hi) is in [lo, hi] when lo ≤ hi', () => {
    // Property: For any v and any range [lo, hi] with lo ≤ hi, the result
    // of clamp lies inside the inclusive range. This is the contract the
    // motif's parallax bookkeeping relies on (/ 4.11 use clamp on
    // the scroll-derived translate offset).
    fc.assert(
      fc.property(
        finiteNumber,
        finiteNumber,
        finiteNumber,
        (v, a, b) => {
          const lo = Math.min(a, b);
          const hi = Math.max(a, b);
          const out = clamp(v, lo, hi);
          return out >= lo && out <= hi;
        },
      ),
      { numRuns: 100 },
    );
  });
});
