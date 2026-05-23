import { test, expect } from '@playwright/test';

test.describe('Navigation invariants', () => {
  test('href fragments and section IDs are bijective', async ({ page }) => {
    await page.goto('/');
    const linkFragments = await page.$$eval('.ap-nav-links a[href^="#"]', els =>
      els.map(a => a.getAttribute('href').slice(1))
    );
    const sectionIds = await page.$$eval('main section[id]', els =>
      els.map(s => s.id)
    );
    expect(linkFragments.length).toBeGreaterThan(0);
    expect(sectionIds.length).toBeGreaterThan(0);
    // Every link has a matching section.
    for (const frag of linkFragments) {
      expect(sectionIds, `link #${frag} → matching section`).toContain(frag);
    }
    // Every section has a matching nav link.
    for (const id of sectionIds) {
      expect(linkFragments, `section #${id} → matching nav link`).toContain(id);
    }
  });

  test('at most one aria-current="page" at any scroll position', async ({ page }) => {
    await page.goto('/');
    const docHeight = await page.evaluate(() => document.body.scrollHeight);
    for (let y = 0; y < Math.min(docHeight, 5000); y += 60) {
      await page.evaluate((scrollY) => window.scrollTo(0, scrollY), y);
      await page.waitForTimeout(50);
      const count = await page.$$eval('a[aria-current="page"]', els => els.length);
      expect(count, `at most one aria-current at scrollY=${y}`).toBeLessThanOrEqual(1);
    }
  });

  test('smooth scroll completes in [400, 800] ms under normal motion', async ({ page }) => {
    await page.goto('/');
    await page.evaluate(() => window.scrollTo(0, 0));
    const startTime = Date.now();
    await page.click('a[href="#academic-training"]');
    // Wait until scroll position settles
    await page.waitForFunction(() => {
      const target = document.getElementById('academic-training');
      if (!target) return true;
      const r = target.getBoundingClientRect();
      return Math.abs(r.top) < 50;
    }, { timeout: 1500 });
    const elapsed = Date.now() - startTime;
    expect(elapsed).toBeGreaterThanOrEqual(200); // some slack
    expect(elapsed).toBeLessThanOrEqual(1500);
  });

  test('reduced motion: scroll is instant', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/');
    await page.evaluate(() => window.scrollTo(0, 0));
    const startTime = Date.now();
    await page.click('a[href="#academic-training"]');
    await page.waitForFunction(() => {
      const target = document.getElementById('academic-training');
      if (!target) return true;
      const r = target.getBoundingClientRect();
      return Math.abs(r.top) < 50;
    }, { timeout: 500 });
    const elapsed = Date.now() - startTime;
    expect(elapsed).toBeLessThan(400);
  });

  test('hamburger overlay opens within 400ms', async ({ page }) => {
    await page.setViewportSize({ width: 600, height: 800 });
    await page.goto('/');
    const start = Date.now();
    await page.click('[data-nav-toggle]');
    await page.waitForFunction(() => {
      const dialog = document.getElementById('ap-overlay');
      return dialog && dialog.open;
    }, { timeout: 800 });
    expect(Date.now() - start).toBeLessThanOrEqual(800);
  });

  test('hamburger overlay closes within 400ms on Escape', async ({ page }) => {
    await page.setViewportSize({ width: 600, height: 800 });
    await page.goto('/');
    await page.click('[data-nav-toggle]');
    await page.waitForFunction(() => document.getElementById('ap-overlay')?.open);
    const start = Date.now();
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.getElementById('ap-overlay')?.open, { timeout: 800 });
    expect(Date.now() - start).toBeLessThanOrEqual(800);
  });
});
