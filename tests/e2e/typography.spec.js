// tests/e2e/typography.spec.js
//
//  — Typography sizes scale fluidly and remain bounded across the
// documented viewport range, and per-level type metrics (line-height,
// letter-spacing, body measure) stay inside the editorial envelope.
//
//
// Strategy
// --------
// The design system pins four fluid type steps in `styles/tokens.css`:
//
//   --text-display    : clamp(2.35rem, 1.6rem + 3.7vw,  4.95rem)
//   --text-heading    : clamp(1.72rem, 1.55rem + 0.85vw, 2.45rem)
//   --text-subheading : clamp(1.06rem, 1rem + 0.3vw,    1.28rem)
//   --text-body       : clamp(1rem,    0.95rem + 0.2vw, 1.1rem)
//
// At a 16-px root font-size the expected bounds are:
//
//   level        min (320 px)   max (1920 px)
//   display      37.60 px       79.20 px
//   heading      27.52 px       39.20 px
//   subheading   16.96 px       20.48 px
//   body         16.00 px       17.60 px
//
// Property
// --------
// The viewport sequence W = [320, 640, 960, 1280, 1600, 1920] is monotone
// non-decreasing. For each documented level L the resolved computed
// `font-size` of an exemplar element must satisfy:
//
//   (a) Monotonicity:  fontSize(L, W[i]) ≤ fontSize(L, W[i+1]) ∀ i
//   (b) Lower bound :  fontSize(L, 320 ) ≈ min(L)
//   (c) Upper bound :  fontSize(L, 1920) ≈ max(L)
//
// Plus three editorial envelope checks:
//
//   (d) body line-height ratio ∈ [1.50, 1.70]
//   (e) display line-height ratio ∈ [0.90, 1.10]
//   (f) display letter-spacing ∈ [-0.08em, -0.04em]
//   (g) at viewport width ≥ 1024 px, body paragraph measure
//       falls in [55, 80] ch
//
// Notes
// -----
// • Selectors are deliberately defensive: we prefer the most stable hooks
//   the design contract exposes (`.ap-section-title` for h2, `.ap-lede`
//   for the body paragraph used to gauge the measure) but fall through to
//   plain element selectors when those classes aren't yet rendered. If a
//   level has no rendered exemplar at a given viewport (e.g. before
//   sections 3.4–3.5 are authored, no `<h3>` exists), the corresponding
//   checks for that level are skipped rather than failing — which keeps
//   this test useful as the page is built out.
//
// • `.ap-mini-title` carries an explicit `font-size: 0.875rem` override in
//   `styles/components/hero.css` and would invalidate the subheading
//   bounds; we exclude it from the heading and subheading selectors.
//
// • A small per-side tolerance absorbs sub-pixel rounding by the renderer.
//   The clamp expressions above resolve to integer-tenths of rem, so a 2-px
//   tolerance is more than enough to cover any browser-side rounding while
//   still catching real regressions (e.g. someone accidentally swaps the
//   `2.35rem` minimum for `2rem`).
//
// • baseURL is supplied by `playwright.config.js`. The test
//   uses `page.goto('/')` so it works against either the Vite dev server
//   or the built `dist/` preview, depending on the Playwright config.

import { test, expect } from '@playwright/test';

// ─────────────────────────────────────────────────────────────────────────────
// Test data
// ─────────────────────────────────────────────────────────────────────────────

/** Viewport widths sampled by the property, in CSS pixels. Strictly increasing. */
const VIEWPORTS = /** @type {const} */ ([320, 640, 960, 1280, 1600, 1920]);

/**
 * Documented per-level font-size envelopes at a 16-px root.
 *   - min: clamp lower clip, reached at viewport ≤ 320 px
 *   - max: clamp upper clip, reached at viewport ≥ 1920 px
 */
const FONT_SIZE_BOUNDS = /** @type {const} */ ({
  display:    { min: 37.6,  max: 79.2  }, // 2.35rem .. 4.95rem
  heading:    { min: 27.52, max: 39.2  }, // 1.72rem .. 2.45rem
  subheading: { min: 16.96, max: 20.48 }, // 1.06rem .. 1.28rem
  body:       { min: 16,    max: 17.6  }, // 1.00rem .. 1.10rem
});

/**
 * CSS selectors for the exemplar element at each typography level. Listed in
 * preference order; the first match wins inside the page.
 *
 * `.ap-mini-title` is intentionally excluded from the heading and subheading
 * selectors — it carries an explicit literal font-size override
 * (0.875rem) and is therefore not a fluid-type exemplar.
 */
const LEVEL_SELECTORS = /** @type {const} */ ({
  display:    'h1, .ap-display',
  heading:    '.ap-section-title, h2:not(.ap-mini-title)',
  subheading: '.ap-subheading, h3, h4',
  body:       'body',
});

/**
 * Selectors used to find a body paragraph wide enough to gauge the editorial
 * measure. The first match wins.
 */
const MEASURE_PARAGRAPH_SELECTORS = '.ap-lede, main p, p';

/** Tolerance (px) for sub-pixel rounding on font-size assertions. */
const FONT_SIZE_TOL_PX = 2;

/** Tolerance for unitless line-height ratios. */
const LINE_HEIGHT_TOL = 0.05;

/** Tolerance for letter-spacing in em (≈ 0.005 em). */
const LETTER_SPACING_TOL_EM = 0.005;

/**
 * Lower / upper bound for the body paragraph measure in ch.
 * The contract says 55–80 ch at viewport ≥ 1024 px; the small slack here
 * absorbs the inherent imprecision of the px-per-ch approximation
 * (1 ch ≈ font-size × 0.5 for proportional sans fonts).
 */
const MEASURE_CH_MIN = 50;
const MEASURE_CH_MAX = 85;

// ─────────────────────────────────────────────────────────────────────────────
// Test body
// ─────────────────────────────────────────────────────────────────────────────

test('typography scales fluidly and remains bounded', async ({ page }) => {
  // Visit once at the smallest viewport, then iterate. Doing the goto under
  // the smallest width also lets us catch any horizontal-overflow regression
  // at the narrow edge of the responsive envelope without blocking on it.
  await page.setViewportSize({ width: VIEWPORTS[0], height: 800 });
  await page.goto('/');

  /**
   * @typedef {object} LevelSample
   * @property {number} fontSize         resolved computed font-size in px
   * @property {number|null} lineHeight  resolved computed line-height in px,
   *                                     or null if `normal`
   * @property {number} letterSpacing    resolved computed letter-spacing in px,
   *                                     0 when `normal`
   */

  /**
   * @typedef {object} ViewportSample
   * @property {number} w
   * @property {LevelSample|null} display
   * @property {LevelSample|null} heading
   * @property {LevelSample|null} subheading
   * @property {LevelSample|null} body
   * @property {{ widthPx: number, fontSizePx: number }|null} measure
   *           paragraph width + font-size, sampled at viewport ≥ 1024 px
   */

  /** @type {ViewportSample[]} */
  const samples = [];

  for (const w of VIEWPORTS) {
    await page.setViewportSize({ width: w, height: 800 });

    // Wait for any in-flight font swap so font-size measurements aren't
    // sampled mid-fallback. Guarded for browsers without the FontFaceSet
    // promise (vanishingly rare in Playwright's bundled engines).
    await page.evaluate(async () => {
      if (document.fonts && typeof document.fonts.ready?.then === 'function') {
        await document.fonts.ready;
      }
    });

    const sample = await page.evaluate(
      ({ levelSelectors, measureSelectors, w }) => {
        /**
         * Resolve a computed-style sample for the first element matching
         * `selector`. Numeric string values are parsed via `parseFloat`,
         * which is sufficient because every relevant computed value comes
         * back as a plain `<n>px` token from `getComputedStyle`.
         */
        const sampleFor = (selector) => {
          const el = document.querySelector(selector);
          if (!el) return null;
          const cs = getComputedStyle(el);
          const fontSize = parseFloat(cs.fontSize);
          const lineHeight =
            cs.lineHeight === 'normal' ? null : parseFloat(cs.lineHeight);
          const letterSpacing =
            cs.letterSpacing === 'normal' ? 0 : parseFloat(cs.letterSpacing);
          return { fontSize, lineHeight, letterSpacing };
        };

        const display = sampleFor(levelSelectors.display);
        const heading = sampleFor(levelSelectors.heading);
        const subheading = sampleFor(levelSelectors.subheading);
        const body = sampleFor(levelSelectors.body);

        // Measure: only sampled at viewports ≥ 1024 px (scope).
        let measure = null;
        if (w >= 1024) {
          const p = document.querySelector(measureSelectors);
          if (p) {
            const cs = getComputedStyle(p);
            measure = {
              widthPx: p.getBoundingClientRect().width,
              fontSizePx: parseFloat(cs.fontSize),
            };
          }
        }

        return { display, heading, subheading, body, measure };
      },
      {
        levelSelectors: LEVEL_SELECTORS,
        measureSelectors: MEASURE_PARAGRAPH_SELECTORS,
        w,
      },
    );

    samples.push({ w, ...sample });
  }

  // ─── (a) Monotonicity per level ──────────────────────────────────────────
  // For each documented level, font-size must be non-decreasing across the
  // strictly-increasing viewport sequence. Skip pairs where either side is
  // null so a temporarily-absent exemplar (e.g. h3 before sections are
  // authored) does not produce a spurious failure.
  for (const level of /** @type {const} */ (['display', 'heading', 'subheading', 'body'])) {
    for (let i = 1; i < samples.length; i++) {
      const prev = samples[i - 1][level];
      const curr = samples[i][level];
      if (!prev || !curr) continue;
      expect(
        curr.fontSize,
        `${level} non-decreasing across viewports: ` +
          `${samples[i - 1].w}→${samples[i].w}px ` +
          `gave ${prev.fontSize}px → ${curr.fontSize}px`,
      ).toBeGreaterThanOrEqual(prev.fontSize - FONT_SIZE_TOL_PX);
    }
  }

  // ─── (b) Lower-bound at 320 px ───────────────────────────────────────────
  // ─── (c) Upper-bound at 1920 px ──────────────────────────────────────────
  const sampleMin = samples[0];                       // viewport 320 px
  const sampleMax = samples[samples.length - 1];      // viewport 1920 px
  for (const level of /** @type {const} */ (['display', 'heading', 'subheading', 'body'])) {
    const { min, max } = FONT_SIZE_BOUNDS[level];

    if (sampleMin[level]) {
      expect(
        Math.abs(sampleMin[level].fontSize - min),
        `${level} font-size at 320 px must equal documented minimum ${min}px ` +
          `(got ${sampleMin[level].fontSize}px)`,
      ).toBeLessThanOrEqual(FONT_SIZE_TOL_PX);
    }

    if (sampleMax[level]) {
      expect(
        Math.abs(sampleMax[level].fontSize - max),
        `${level} font-size at 1920 px must equal documented maximum ${max}px ` +
          `(got ${sampleMax[level].fontSize}px)`,
      ).toBeLessThanOrEqual(FONT_SIZE_TOL_PX);
    }
  }

  // ─── (d) Body line-height ratio ∈ [1.50, 1.70] ───────────────────────────
  // ─── (e) Display line-height ratio ∈ [0.90, 1.10] ────────────────────────
  // ─── (f) Display letter-spacing ∈ [-0.08em, -0.04em] ─────────────────────
  for (const s of samples) {
    if (s.body && s.body.lineHeight && s.body.fontSize > 0) {
      const ratio = s.body.lineHeight / s.body.fontSize;
      expect(
        ratio,
        `body line-height ratio at ${s.w}px viewport must be ≥ 1.50 ` +
          `(got ${ratio.toFixed(3)})`,
      ).toBeGreaterThanOrEqual(1.5 - LINE_HEIGHT_TOL);
      expect(
        ratio,
        `body line-height ratio at ${s.w}px viewport must be ≤ 1.70 ` +
          `(got ${ratio.toFixed(3)})`,
      ).toBeLessThanOrEqual(1.7 + LINE_HEIGHT_TOL);
    }

    if (s.display && s.display.lineHeight && s.display.fontSize > 0) {
      const ratio = s.display.lineHeight / s.display.fontSize;
      expect(
        ratio,
        `display line-height ratio at ${s.w}px viewport must be ≥ 0.90 ` +
          `(got ${ratio.toFixed(3)})`,
      ).toBeGreaterThanOrEqual(0.9 - LINE_HEIGHT_TOL);
      expect(
        ratio,
        `display line-height ratio at ${s.w}px viewport must be ≤ 1.10 ` +
          `(got ${ratio.toFixed(3)})`,
      ).toBeLessThanOrEqual(1.1 + LINE_HEIGHT_TOL);
    }

    if (s.display && s.display.fontSize > 0) {
      const lsEm = s.display.letterSpacing / s.display.fontSize;
      expect(
        lsEm,
        `display letter-spacing at ${s.w}px viewport must be ≥ -0.08em ` +
          `(got ${lsEm.toFixed(4)}em)`,
      ).toBeGreaterThanOrEqual(-0.08 - LETTER_SPACING_TOL_EM);
      expect(
        lsEm,
        `display letter-spacing at ${s.w}px viewport must be ≤ -0.04em ` +
          `(got ${lsEm.toFixed(4)}em)`,
      ).toBeLessThanOrEqual(-0.04 + LETTER_SPACING_TOL_EM);
    }
  }

  // ─── (g) Body measure ∈ [55, 80] ch at viewport ≥ 1024 px ────────────────
  // 1 ch ≈ font-size × 0.5 for the proportional sans stack used by the body
  // (Inter / system-ui). The slack on this approximation is absorbed by
  // MEASURE_CH_MIN / MEASURE_CH_MAX above; the bound still catches gross
  // regressions (e.g. someone removing `max-inline-size` from `p`).
  for (const s of samples) {
    if (!s.measure) continue;
    if (s.measure.fontSizePx <= 0) continue;
    const chPx = s.measure.fontSizePx * 0.5;
    const ch = s.measure.widthPx / chPx;
    expect(
      ch,
      `body paragraph measure at ${s.w}px viewport must be ≥ ${MEASURE_CH_MIN}ch ` +
        `(got ${ch.toFixed(1)}ch from ${s.measure.widthPx.toFixed(1)}px ` +
        `at ${s.measure.fontSizePx}px font-size)`,
    ).toBeGreaterThanOrEqual(MEASURE_CH_MIN);
    expect(
      ch,
      `body paragraph measure at ${s.w}px viewport must be ≤ ${MEASURE_CH_MAX}ch ` +
        `(got ${ch.toFixed(1)}ch from ${s.measure.widthPx.toFixed(1)}px ` +
        `at ${s.measure.fontSizePx}px font-size)`,
    ).toBeLessThanOrEqual(MEASURE_CH_MAX);
  }
});
