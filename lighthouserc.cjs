// lighthouserc.cjs
//
// Lighthouse CI assertions for the website.
// Run via `npm run test:lh` (executes `lhci autorun`).
//
//
// NOTES ON REQ 11.2 (Mobile preset, Performance score >= 80):
//   This config targets the Lighthouse Desktop preset (score >= 90).
//   The mobile threshold (score >= 80) requires a second LHCI run
//   with `settings.preset = 'desktop'` removed (mobile is the LH default) and
//   `categories:performance` minScore lowered to 0.8. In CI, this is achieved
//   by either:
//     a) a second `lighthouserc.mobile.cjs` invoked as a separate job, or
//     b) a CI matrix run that passes `--config=lighthouserc.mobile.cjs`.
//   The reference network throttling values below come from the spec and
//   match a simulated Slow 4G + 4x CPU slowdown profile.

module.exports = {
  ci: {
    collect: {
      // Run against the locally-served dist/ output produced by `vite build`.
      // LHCI will spin up a static server rooted at this directory.
      staticDistDir: './dist',
      url: ['http://localhost/index.html'],
      // Median of three consecutive runs (wording).
      numberOfRuns: 3,
      settings: {
        // Desktop preset for  (>= 90).
        preset: 'desktop',
        // Apply reference network conditions: simulated Slow 4G + 4x CPU
        // slowdown. Values picked to match the spec's reference network
        // definition.
        throttling: {
          rttMs: 150,
          throughputKbps: 1638.4,
          cpuSlowdownMultiplier: 4,
        },
      },
    },
    assert: {
      assertions: {
        // : Desktop Performance score >= 90.
        'categories:performance': ['error', { minScore: 0.9 }],
        // : Largest Contentful Paint <= 2500 ms.
        'largest-contentful-paint': ['error', { maxNumericValue: 2500 }],
        // : Cumulative Layout Shift <= 0.1.
        'cumulative-layout-shift': ['error', { maxNumericValue: 0.1 }],
        // : Total Blocking Time <= 200 ms.
        'total-blocking-time': ['error', { maxNumericValue: 200 }],
        // Soft guard: warn on FCP regressions but don't fail CI.
        'first-contentful-paint': ['warn', { maxNumericValue: 2000 }],
        // SEO / accessibility / best-practices categories are intentionally
        // not asserted here. They are covered by other tests:
        //   - axe-core (tests/e2e/a11y.spec.js)
        //   - html-validate (`npm run lint:html`)
        //   - SEO unit test
      },
    },
    upload: {
      // Upload temporary reports to LHCI's public storage so reviewers can
      // open them from the CI logs. Switch to `target: 'lhci'` with a
      // self-hosted server (or GitHub Pages-hosted JSON artefacts) for a
      // production-grade audit trail.
      target: 'temporary-public-storage',
    },
  },
};
