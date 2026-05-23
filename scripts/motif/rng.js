/**
 * Deterministic numeric helpers for the motif algorithm.
 *
 * Every function in this module is pure and side-effect free. Re-seeding the
 * PRNG with the same `seed` produces an identical sequence of outputs, which is
 * what allows the motif to be regenerated identically at build time (for the
 * SVG fallback and favicon) and at runtime (for the animated canvas).
 *
 */

/**
 * Mulberry32 pseudorandom number generator.
 *
 * Returns a zero-argument function that produces a new float in `[0, 1)` each
 * time it is called. Given the same `seed`, the returned function emits an
 * identical, reproducible sequence — the property the motif relies on for
 * determinism.
 *
 * @param {number} seed - 32-bit unsigned integer seed (any number is coerced
 *   via `seed >>> 0`).
 * @returns { => number} A PRNG function returning floats in `[0, 1)`.
 */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function rng() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Linear interpolation between two values.
 *
 * Returns `a + (b - a) * t`. Not clamped: callers may pass `t` outside `[0, 1]`
 * intentionally (extrapolation).
 *
 * @param {number} a - Start value (returned when `t === 0`).
 * @param {number} b - End value (returned when `t === 1`).
 * @param {number} t - Interpolation parameter.
 * @returns {number}
 */
export function lerp(a, b, t) {
  return a + (b - a) * t;
}

/**
 * Clamp `value` to the inclusive range `[lo, hi]`.
 *
 * @param {number} value - The value to clamp.
 * @param {number} lo - Lower bound (inclusive).
 * @param {number} hi - Upper bound (inclusive).
 * @returns {number}
 */
export function clamp(value, lo, hi) {
  if (value < lo) return lo;
  if (value > hi) return hi;
  return value;
}

/**
 * Jittered-grid Poisson-disk sampler.
 *
 * Returns approximately `n` points in `[0, 1]²` with pairwise Euclidean
 * distance ≥ `minDist`. The unit square is partitioned into a
 * `gridSize × gridSize` grid where `gridSize = ceil(sqrt(n))` (giving at least
 * `n` cells). One jittered candidate is generated per cell in row-major order
 * at `(i + rng) / gridSize, (j + rng) / gridSize`, so the `rng` is
 * consumed deterministically regardless of which candidates survive.
 *
 * Each candidate is accepted only if it is at least `minDist` away from every
 * previously-accepted point; candidates that violate this constraint are
 * dropped. Acceptance stops once `n` points have been collected. The result
 * therefore has length ≤ `n` and may be smaller when `minDist` is large
 * relative to the grid spacing — this is the intentional "~n points" semantics
 * documented in the design.
 *
 * The function is pure: it consumes `rng` but does not mutate any input.
 *
 * @param {number} n - Target number of points. Non-positive values return an
 *   empty array.
 * @param {number} minDist - Minimum Euclidean separation between any two
 *   returned points. Strictly enforced — points violating this are dropped.
 * @param { => number} rng - Zero-argument function returning floats in
 *   `[0, 1)`, e.g. the result of `mulberry32(seed)`.
 * @returns {Array<{x: number, y: number}>} Array of at most `n` points, each
 *   with `x, y ∈ [0, 1]`.
 */
export function poissonDisk(n, minDist, rng) {
  if (n <= 0) return [];

  const gridSize = Math.ceil(Math.sqrt(n));
  const cellWidth = 1 / gridSize;
  const minDistSq = minDist * minDist;
  const accepted = [];

  // Walk cells in row-major order so rng consumption is deterministic. Drop
  // candidates that violate minDist against any prior acceptance.
  outer: for (let j = 0; j < gridSize; j++) {
    for (let i = 0; i < gridSize; i++) {
      const x = i * cellWidth + cellWidth * rng();
      const y = j * cellWidth + cellWidth * rng();

      let ok = true;
      for (let a = 0; a < accepted.length; a++) {
        const dx = x - accepted[a].x;
        const dy = y - accepted[a].y;
        if (dx * dx + dy * dy < minDistSq) {
          ok = false;
          break;
        }
      }
      if (ok) {
        accepted.push({ x, y });
        if (accepted.length >= n) break outer;
      }
    }
  }

  return accepted;
}

/**
 * Return the `k` nodes nearest to `n` from the given `nodes` array, sorted by
 * ascending Euclidean distance.
 *
 * `n` itself is excluded from the result. The function does not mutate
 * `nodes`; it builds and sorts an internal array of distance pairs.
 *
 * @template {{x: number, y: number}} P
 * @param {ReadonlyArray<P>} nodes - The pool of candidate points.
 * @param {P} n - The reference point. Excluded from the result by reference
 *   equality.
 * @param {number} k - Maximum number of neighbours to return. Non-positive
 *   values yield an empty array; values larger than `nodes.length - 1` are
 *   clamped to whatever is available.
 * @returns {Array<P>} The (up to) `k` nearest other nodes, sorted nearest-first.
 */
export function kNearest(nodes, n, k) {
  if (k <= 0) return [];
  const pairs = [];
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i];
    if (node === n) continue;
    const dx = node.x - n.x;
    const dy = node.y - n.y;
    pairs.push({ node, distSq: dx * dx + dy * dy });
  }
  pairs.sort((a, b) => a.distSq - b.distSq);
  const limit = Math.min(k, pairs.length);
  const result = new Array(limit);
  for (let i = 0; i < limit; i++) result[i] = pairs[i].node;
  return result;
}
