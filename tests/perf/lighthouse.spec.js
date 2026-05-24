// tests/perf/lighthouse.spec.js
//
//  — Performance budgets.
//
// The authoritative perf gate is `npm run test:lh` (Lighthouse CI via
// `lighthouserc.cjs` at ). This Vitest spec is a lightweight
// gate that:
//   1. Documents the documented budgets so they appear in the test
//      output even when LH is not run.
//   2. Asserts the JS bundle-size budget by reading `dist/` (when
//      present) and computing gzipped totals — same logic as
//      `tools/check-bundle-size.mjs` but exposed as a
//      Vitest test for visibility.
//

import { describe, it, expect } from 'vitest';
import { existsSync, readdirSync, statSync, readFileSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..', '..');
const distDir = resolve(repoRoot, 'dist');

function walkJs(dir) {
  if (!existsSync(dir)) return [];
  const out = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const s = statSync(full);
    if (s.isDirectory()) out.push(...walkJs(full));
    else if (full.endsWith('.js')) out.push(full);
  }
  return out;
}

describe('Performance budgets', () => {
  it('documents the LH budgets', () => {
    const budgets = {
      lcp_ms: 2500,
      cls: 0.1,
      tbt_ms: 200,
      lh_perf_desktop: 90,
      lh_perf_mobile: 80,
      total_js_kb: 50,
      motif_js_kb: 15,
      critical_css_kb: 8,
    };
    // The actual gate is lighthouserc.cjs + tools/check-bundle-size.mjs.
    // Sanity assertion: budgets are reasonable.
    expect(budgets.lcp_ms).toBeGreaterThan(0);
    expect(budgets.cls).toBeLessThan(1);
  });

  it.skipIf(!existsSync(distDir))('total JS gzipped ≤ 50 KB', () => {
    const files = walkJs(distDir);
    let totalGz = 0;
    for (const f of files) {
      const bytes = readFileSync(f);
      totalGz += gzipSync(bytes).length;
    }
    expect(totalGz).toBeLessThanOrEqual(50 * 1024);
  });

  it.skipIf(!existsSync(distDir))('motif chunk gzipped ≤ 15 KB', () => {
    const files = walkJs(distDir).filter((f) => /motif/.test(f));
    let motifGz = 0;
    for (const f of files) {
      const bytes = readFileSync(f);
      motifGz += gzipSync(bytes).length;
    }
    expect(motifGz).toBeLessThanOrEqual(15 * 1024);
  });
});
