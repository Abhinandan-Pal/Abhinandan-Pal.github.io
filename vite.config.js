// vite.config.js
//
// Static-site build for GitHub Pages (project deployed at the user-site root
// `https://abhinandan-pal.github.io/`, so `base: '/'`).
//
// Constraints — see .2 and
//   * Vanilla ES modules only — no framework runtime, no plugins.
//   * Total JS budget ≤ 50 KB gzipped, motif chunk ≤ 15 KB.
//     `manualChunks` splits `scripts/motif.js` (and its `motif/` helpers and
//     `motif.worker.js`) into its own bundle so `tools/check-bundle-size.mjs`
//     can measure it independently.
//   * `assetsInlineLimit: 0`never inline assets as data URLs; every asset
//     ships as a hashed file so caching headers apply uniformly.
//   * `target: 'es2022'`the browsers we support all parse ES2022 natively
//     (top-level await, class fields, .at, Error.cause, etc.).
//   * `output.assetFileNames` / `chunkFileNames` / `entryFileNames`every
//     emitted file (CSS, JS, fonts, images) carries a content hash in its
//     URL. GitHub Pages does not allow custom `Cache-Control` headers, so
//     hashed filenames are the alternative path through : any
//     change to a file produces a new URL, and old URLs remain validly
//     cacheable indefinitely. The values below are Vite's defaults stated
//     explicitly so the build contract is part of the source.
//
// No `plugins` array is declared on purpose; Vite ships with the vanilla ES
// module pipeline enabled by default and we want nothing else loaded.

import { defineConfig } from 'vite';

export default defineConfig({
  base: '/',
  build: {
    outDir: 'dist',
    assetsInlineLimit: 0,
    target: 'es2022',
    rollupOptions: {
      output: {
        // Every emitted asset (CSS, JS, fonts, images, etc.) gets a content
        // hash in its filename. These three patterns mirror Vite's defaults
        // but are stated explicitly so the cache contract for GitHub Pages
        // lives in source, not in framework documentation.
        assetFileNames: 'assets/[name]-[hash][extname]',
        chunkFileNames: 'assets/[name]-[hash].js',
        entryFileNames: 'assets/[name]-[hash].js',
        // Isolate the generative-motif module (and its helpers / worker) so
        // its gzipped size can be asserted independently of the rest of the
        // app code. Anything else stays in the default chunk.
        manualChunks(id) {
          if (
            /[\\/]scripts[\\/]motif\.js$/.test(id) ||
            /[\\/]scripts[\\/]motif[\\/]/.test(id) ||
            /[\\/]scripts[\\/]motif\.worker\.js$/.test(id)
          ) {
            return 'motif';
          }
          return undefined;
        },
      },
    },
  },
});
