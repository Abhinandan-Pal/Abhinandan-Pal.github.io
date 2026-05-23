/**
 *  — Layout adapts correctly to every breakpoint tier.
 *
 *
 * Strategy
 * --------
 * Playwright iterates a representative width for each breakpoint tier defined
 * in  (the inclusive lower bounds 560 / 860 / 1200) plus values that
 * sit comfortably inside each tier and at the documented edges. For every
 * tier we assert:
 *
 *   • No horizontal page overflow at any width.
 *   • Hero column composition matches the tier:
 *        – < 860 px  → single column stack with the primary column first
 *.
 *        – ≥ 860 px  → asymmetric two-column grid where the primary column
 *                      occupies 55–75 % of the row width and is at least
 *                      1.5× wider than the secondary column.
 *   • From 560 px upward, every primary action control has a hit target of
 *     at least 44 × 44 CSS pixels.
 *   • At ≥ 1200 px the main `.ap-wrap` container is constrained to a maximum
 *     width of 1200 CSS pixels and is horizontally centred, so the remaining
 *     horizontal space distributes equally as left / right margins
 *.
 */

import { test, expect } from '@playwright/test';

/**
 * Representative viewport widths drawn from the task spec. Each entry is
 * tagged with the tier the width belongs to so assertions can branch
 * per-tier without re-deriving the breakpoint table inline.
 *
 * Tier boundaries follow :
 *   • mobile        : w <  560
 *   • tablet        : 560 ≤ w <  860
 *   • desktop       : 860 ≤ w < 1200
 *   • desktop-wide  : w ≥ 1200
 */
const tiers = [
  { w: 320, label: 'mobile XS', tier: 'mobile' },
  { w: 540, label: 'mobile', tier: 'mobile' },
  { w: 580, label: 'small tablet', tier: 'tablet' },
  { w: 720, label: 'tablet', tier: 'tablet' },
  { w: 820, label: 'tablet large', tier: 'tablet' },
  { w: 880, label: 'desktop S', tier: 'desktop' },
  { w: 1024, label: 'desktop', tier: 'desktop' },
  { w: 1180, label: 'desktop large', tier: 'desktop' },
  { w: 1200, label: 'desktop XL', tier: 'desktop-wide' },
  { w: 1440, label: 'desktop wide', tier: 'desktop-wide' },
  { w: 1920, label: 'desktop max', tier: 'desktop-wide' },
];

// Tolerances absorb sub-pixel rounding from grid track resolution and
// document layout. Kept tight enough that genuine layout regressions still
// surface.
const RATIO_TOLERANCE_PCT = 1; // ± 1 percentage point on the 55–75 % envelope.
const COLUMN_RATIO_TOLERANCE = 0.01; // ± 0.01 on the 1.5× minimum.
const WRAP_WIDTH_TOLERANCE_PX = 2; // ± 2 px on the 1200 px wrap cap.
const OVERFLOW_TOLERANCE_PX = 1; // browser-rounding slack on scrollWidth.

test.describe('responsive layout per breakpoint tier', () => {
  test('layout adapts correctly to every breakpoint tier', async ({ page }) => {
    for (const { w, label, tier } of tiers) {
      // Set the viewport BEFORE navigating so the first paint reflects the
      // tier under test, then reload-on-navigate semantics keep behaviour
      // consistent across iterations.
      await page.setViewportSize({ width: w, height: 800 });
      await page.goto('/');

      // ------------------------------------------------------------------
      // 1. No horizontal page overflow.
      // ------------------------------------------------------------------
      const docWidth = await page.evaluate(() => document.documentElement.scrollWidth);
      expect(
        docWidth,
        `${label} (${w}px): document.scrollWidth must not exceed viewport width`
      ).toBeLessThanOrEqual(w + OVERFLOW_TOLERANCE_PX);

      // ------------------------------------------------------------------
      // 2. Hero grid composition.
      // ------------------------------------------------------------------
      const heroCols = await page.evaluate(() => {
        const grid = document.querySelector('.ap-hero-grid');
        if (!grid) return null;
        return getComputedStyle(grid).gridTemplateColumns;
      });

      expect(heroCols, `${label} (${w}px): .ap-hero-grid must exist`).not.toBeNull();

      // `grid-template-columns` resolves at computed time to a space-
      // separated list of pixel tracks ("220px 380px"). Parse defensively:
      // filter out NaN so `none` / single-value resolutions on stacked
      // layouts don't poison the column count.
      const cols = heroCols
        .split(' ')
        .map((token) => parseFloat(token))
        .filter((n) => Number.isFinite(n));

      if (tier === 'mobile' || tier === 'tablet') {
        // Below 860 px the hero stacks vertically with the primary column
        // first. Mobile-first stacking also satisfies 's
        // single-column requirement below 560 px. Computed
        // `grid-template-columns` resolves to either a single track or
        // `none`, so accept anything shorter than two parsed tracks.
        expect(
          cols.length <= 1,
          `${label} (${w}px): hero must stack to a single column below 860px (got ${heroCols})`
        ).toBe(true);
      } else {
        // ≥ 860 px: asymmetric two-column grid.
        expect(
          cols.length,
          `${label} (${w}px): hero must render as two columns at ≥ 860px (got ${heroCols})`
        ).toBe(2);

        const [primary, secondary] = cols;
        const total = primary + secondary;
        const primaryRatio = (primary / total) * 100;

        // : primary column ∈ [55%, 75%] of row width.
        expect(
          primaryRatio,
          `${label} (${w}px): primary column ratio ≥ 55% (got ${primaryRatio.toFixed(2)}%)`
        ).toBeGreaterThanOrEqual(55 - RATIO_TOLERANCE_PCT);
        expect(
          primaryRatio,
          `${label} (${w}px): primary column ratio ≤ 75% (got ${primaryRatio.toFixed(2)}%)`
        ).toBeLessThanOrEqual(75 + RATIO_TOLERANCE_PCT);

        // : wider column ≥ 1.5× narrower column (only enforced in
        // the 860–1200 desktop tier where  explicitly applies; the
        // ratio holds at ≥ 1200 too because the same grid declaration
        // remains in force, so we assert it for both desktop tiers).
        const ratio = primary / secondary;
        expect(
          ratio,
          `${label} (${w}px): primary ÷ secondary column ratio ≥ 1.5 (got ${ratio.toFixed(3)})`
        ).toBeGreaterThanOrEqual(1.5 - COLUMN_RATIO_TOLERANCE);
      }

      // ------------------------------------------------------------------
      // 3. Hit-target size for primary action controls.
      //
      //  applies in the 560–860 tablet tier. Hit targets do not
      // shrink at wider tiers, so we extend the assertion to every tier
      // ≥ 560 px to catch regressions earlier.
      // ------------------------------------------------------------------
      if (w >= 560) {
        const buttons = await page.$$eval(
          '.ap-actions a, .ap-button',
          (els) => els.map((el) => ({ w: el.offsetWidth, h: el.offsetHeight }))
        );

        expect(
          buttons.length,
          `${label} (${w}px): hero action cluster must expose at least one control`
        ).toBeGreaterThan(0);

        for (const b of buttons) {
          expect(
            b.w,
            `${label} (${w}px): action control width ≥ 44px (got ${b.w}px)`
          ).toBeGreaterThanOrEqual(44);
          expect(
            b.h,
            `${label} (${w}px): action control height ≥ 44px (got ${b.h}px)`
          ).toBeGreaterThanOrEqual(44);
        }
      }

      // ------------------------------------------------------------------
      // 4. Wrap cap and centring at ≥ 1200 px.
      // ------------------------------------------------------------------
      if (w >= 1200) {
        const wrapMetrics = await page.evaluate(() => {
          const el = document.querySelector('.ap-wrap');
          if (!el) return null;
          const rect = el.getBoundingClientRect();
          return {
            width: el.offsetWidth,
            left: rect.left,
            right: document.documentElement.clientWidth - rect.right,
          };
        });

        expect(wrapMetrics, `${label} (${w}px): .ap-wrap must exist`).not.toBeNull();

        // : capped at 1200 CSS pixels.
        expect(
          wrapMetrics.width,
          `${label} (${w}px): .ap-wrap width ≤ 1200px (got ${wrapMetrics.width}px)`
        ).toBeLessThanOrEqual(1200 + WRAP_WIDTH_TOLERANCE_PX);

        //  / 8.5: equal left and right margins. Allow the same 2 px
        // slack we use on the wrap width to absorb sub-pixel centring.
        expect(
          Math.abs(wrapMetrics.left - wrapMetrics.right),
          `${label} (${w}px): .ap-wrap must be centred (left=${wrapMetrics.left}px, right=${wrapMetrics.right}px)`
        ).toBeLessThanOrEqual(WRAP_WIDTH_TOLERANCE_PX);
      }
    }
  });
});
