# Abhinandan-Pal.github.io

Personal academic website for Abhinandan Pal (Obi), PhD candidate at the
University of Birmingham working on Neural Model Checking. Deployed at
[`https://abhinandan-pal.github.io/`](https://abhinandan-pal.github.io/).

The site is HTML-first: every required content string and action link
is reachable with JavaScript disabled. Vanilla ES modules progressively
enhance scrolling, typography, motion, and the generative neural-graph
motif behind the hero. Static GitHub Pages deploy, no server logic, no
framework runtime.

## Quick start

```bash
npm install
npm run dev          # Vite dev server at http://localhost:5173
npm run build        # build to dist/
node tools/inline-critical.mjs   # inline critical CSS into index.html
node tools/wire-async-css.mjs    # wire async stylesheet swap
node tools/render-svg-motif.mjs  # pre-render the static SVG motif fallback
node tools/render-favicon.mjs    # render favicon.svg, favicon.png, footer-mark.svg
npm run preview      # preview the built dist/ at http://localhost:4173
```

## Architecture

- Static site built with Vite. No framework runtime.
- Vanilla ES modules in `scripts/``main.js`, `data.js`, `render.js`,
  `reveal.js`, `magnetic.js`, `spotlight.js`, `kinetic-heading.js`,
  `nav.js`, `transitions.js`, and the motif (`motif.js` plus
  `motif/runtime.js` and `motif/rng.js`).
- CSS tokens in `styles/tokens.css` are the single source of truth for
  colour, typography, spacing, radius, elevation, motion, layout, and
  glass-surface values. Components consume them via
  `var(--token-name, fallback)` so the fallback path keeps the page
  legible if a token is renamed or missing.
- HTML-first content authoring. Build-time tools rewrite `<head>`
  (critical CSS inline + async stylesheet swap) and the
  `<svg.ap-motif-fallback>` block (static SVG) before deploy.
- JS budget: total ≤ 50 KB gzipped, motif chunk ≤ 15 KB gzipped, enforced
  by `tools/check-bundle-size.mjs`.

## Build pipeline

The `dist/` artefact GitHub Pages serves is produced by:

1. `tools/render-svg-motif.mjs`generates the deterministic static SVG
   fallback for `<svg.ap-motif-fallback>` so the no-JS / reduced-motion
   path renders the same motif geometry as the canvas runtime.
2. `tools/render-favicon.mjs`emits `assets/favicon.svg`,
   `assets/favicon.png`, and `assets/footer-mark.svg` from a single
   source so the brand mark stays in sync.
3. `vite build`bundles ES modules and CSS into `dist/` with
   content-hashed filenames per `vite.config.js`.
4. `tools/inline-critical.mjs`extracts the above-the-fold critical
   CSS and inlines it into `<head>` of `index.html` and `404.html`.
5. `tools/wire-async-css.mjs`rewrites the main stylesheet `<link>`
   to load asynchronously with a `<noscript>` fallback.
6. `tools/check-bundle-size.mjs`fails the build if total gzipped JS
   exceeds 50 KB or the motif chunk exceeds 15 KB.

## Testing

- Unit tests (`npm run test:unit`): `tests/unit/`.
- Property tests (`npm run test:property`): `tests/property/`contrast, token shape, motif bounds, motif RNG, data ↔ DOM.
- E2E tests (`npm run test:e2e`): `tests/e2e/`Playwright covers
  fluid typography, reduced motion, reveal timing, breakpoints, glass
  envelope, nav invariants, a11y, and the no-JS hero.
- Perf tests (`npm run test:perf`): Vitest gate documenting Lighthouse
  budgets and verifying gzipped JS size.
- Lighthouse CI (`npm run test:lh`): runs against `dist/` with the
  desktop preset (LCP ≤ 2500 ms, CLS ≤ 0.1, TBT ≤ 200 ms,
  Performance ≥ 0.9).

## Deployment

GitHub Pages deploys via `.github/workflows/deploy.yml` on every push
to `main`. The workflow renders SVG motif and favicon assets, runs
`vite build`, inlines critical CSS, wires the async stylesheet swap,
copies `robots.txt`, `sitemap.xml`, and `404.html` into `dist/`, and
uploads via `actions/deploy-pages@v4`.

## Caching

GitHub Pages does not let us set custom `Cache-Control` headers, so the
build relies on content-hashed filenames. Vite output:

```js
output: {
  assetFileNames: 'assets/[name]-[hash][extname]',
  chunkFileNames: 'assets/[name]-[hash].js',
  entryFileNames: 'assets/[name]-[hash].js',
}
```

Any change to CSS, JS, fonts, or images yields a new URL, and the new
HTML references the new URL. The only un-hashed URL is the root HTML
document, which GitHub Pages serves with a short `max-age` (typically
600 s) so updated asset references propagate.

## Image conventions

Every non-critical `<img>` ships with `loading="lazy"`,
`decoding="async"`, and explicit `width`/`height` to prevent layout
shift. Above-the-fold images use `fetchpriority="high"` and skip
lazy-load. Decorative imagery uses inline SVG, CSS background, or a
canvas surface where possible.

## Fonts

Self-hosted variable WOFF2 binaries belong in `assets/fonts/`. See
[`assets/fonts/README.md`](./assets/fonts/README.md) for download and
conversion instructions for Lora and DM Sans.

## Project structure

```
/
├── index.html, 404.html         ← canonical author-edited HTML
├── robots.txt, sitemap.xml      ← SEO companions
├── styles/
│   ├── tokens.css               ← design system source of truth
│   ├── reset.css, typography.css, layout.css, motion.css
│   ├── main.css                 ← async-loaded aggregator
│   └── components/              ← nav, hero, section, card, button, chip, footer
├── scripts/
│   ├── main.js                  ← entry orchestrator
│   ├── data.js                  ← page content
│   ├── render.js                ← DOM hydration helpers
│   ├── reveal.js, magnetic.js, spotlight.js, kinetic-heading.js, nav.js, transitions.js
│   ├── motif.js                 ← motif core algorithm
│   └── motif/                   ← runtime.js + rng.js (deterministic helpers)
├── tools/                       ← build scripts
├── tests/                       ← unit / property / e2e / perf
├── assets/                      ← fonts, og-image, favicon, footer-mark
└── .github/workflows/           ← CI + deploy
```

## License

MIT — see [`LICENSE`](./LICENSE).
