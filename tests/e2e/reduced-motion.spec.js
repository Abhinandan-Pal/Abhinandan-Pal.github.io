import { test, expect } from '@playwright/test';

test.describe('Reduced motion suppression and no-replay', () => {
  test('reduced-motion: rAF count stays low after full scroll', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.addInitScript(() => {
      window.__rafCount = 0;
      const orig = window.requestAnimationFrame.bind(window);
      window.requestAnimationFrame = function(cb) {
        window.__rafCount += 1;
        return orig(cb);
      };
    });
    await page.goto('/');
    // Scroll through entire page
    const docHeight = await page.evaluate(() => document.body.scrollHeight);
    for (let y = 0; y < Math.min(docHeight, 5000); y += 200) {
      await page.evaluate((scrollY) => window.scrollTo(0, scrollY), y);
      await page.waitForTimeout(50);
    }
    const rafCount = await page.evaluate(() => window.__rafCount);
    // Under reduced motion, rAF should be minimal — no rolling animation loop.
    // Allow some baseline (initial paint, hero choreography fallback, etc.)
    // but assert it's clearly bounded.
    expect(rafCount).toBeLessThan(200);
  });

  test('reveal does not replay on scroll re-entry', async ({ page }) => {
    await page.goto('/');
    // Scroll to publications section (forcing it to reveal)
    await page.evaluate(() => {
      const t = document.getElementById('publications');
      if (t) t.scrollIntoView({ behavior: 'auto', block: 'center' });
    });
    await page.waitForTimeout(500);

    // Confirm publications has .is-visible
    const visibleAfterFirst = await page.evaluate(() =>
      document.getElementById('publications')?.classList.contains('is-visible')
    );
    expect(visibleAfterFirst).toBe(true);

    // Snapshot animations on the section
    const animsBefore = await page.evaluate(() => {
      const section = document.getElementById('publications');
      return section ? section.getAnimations({ subtree: true }).length : 0;
    });

    // Scroll way down past the section, then back up
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(300);
    await page.evaluate(() => {
      const t = document.getElementById('publications');
      if (t) t.scrollIntoView({ behavior: 'auto', block: 'center' });
    });
    await page.waitForTimeout(500);

    // is-visible still set, no new animations triggered
    const stillVisible = await page.evaluate(() =>
      document.getElementById('publications')?.classList.contains('is-visible')
    );
    expect(stillVisible).toBe(true);

    const animsAfter = await page.evaluate(() => {
      const section = document.getElementById('publications');
      return section ? section.getAnimations({ subtree: true }).length : 0;
    });
    // No additional animations were triggered on re-entry.
    expect(animsAfter).toBeLessThanOrEqual(animsBefore);
  });

  test('motif respects reduced motion', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.addInitScript(() => {
      window.__motifRafCount = 0;
      // Hook into rAF to detect motif loop activity. The motif uses
      // requestAnimationFrame inside its tick function; we count total rAFs
      // and check it doesn't grow unboundedly while idle.
      const orig = window.requestAnimationFrame.bind(window);
      window.requestAnimationFrame = function(cb) {
        window.__motifRafCount += 1;
        return orig(cb);
      };
    });
    await page.goto('/');
    await page.waitForTimeout(1000); // let initial install settle
    const baseline = await page.evaluate(() => window.__motifRafCount);
    // Sit idle for 2 seconds — under reduced motion, motif should NOT
    // schedule new rAF callbacks.
    await page.waitForTimeout(2000);
    const after = await page.evaluate(() => window.__motifRafCount);
    // Allow for some baseline rAF activity but the motif should not be
    // continuously requesting frames.
    expect(after - baseline).toBeLessThan(60); // 30 rAF/s * 2s = 60 max if no motif loop
  });
});
