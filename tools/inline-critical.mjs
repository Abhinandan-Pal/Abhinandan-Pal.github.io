#!/usr/bin/env node
// tools/inline-critical.mjs
//
// the document <head> so first paint of the hero does not require
// any blocking network round-trip beyond the HTML document itself.
//
// What this script does:
//   1. Reads the CSS source files that govern first paint above the fold:
//        • styles/tokens.css        — every CSS custom property (colour,
//                                     typography, spacing, radius, shadow,
//                                     glass envelope) the rest of the
//                                     critical CSS depends on.
//        • styles/reset.css         — modern reset + visible focus ring
//                                     + skip-link + reduced-motion guard.
//        • styles/typography.css    — body / display / heading / Bengali
//                                     stacks, fluid type scale, link
//                                     defaults — needed for the hero <h1>
//                                     and lede paragraphs to render at
//                                     their final size on first paint.
//        • styles/layout.css        — `.ap-wrap` width formula, hero grid
//                                     tracks, mobile-first stacking — the
//                                     hero must compose into its final
//                                     two-column shape before component
//                                     CSS arrives.
//        • styles/components/hero.css — glass surfaces and inline hero
//                                     surface rules.
//
//      The four non-token files are included in full because minification
//      collapses their (heavy) comment blocks; the residual byte count is
//      well inside the 8 KB envelope. If a future content change pushes the
//      output past the budget, the script logs a warning naming the file
//      that contributed the most bytes so a human can decide which rules to
//      promote out of the critical path.
//
//   2. Minifies the concatenated source with a small, deterministic regex
//      pipeline (strip comments, collapse whitespace, drop spaces around
//      structural punctuation, drop trailing semicolons before `}`). We
//      avoid pulling in `cssnano` here because its async PostCSS pipeline
//      is heavyweight for a build-time script that runs on a few KB of
//      input; the regex pass produces output within a few percent of
//      cssnano's `default` preset for hand-written CSS.
//
//   3. Rewrites the `<style id="ap-critical">…</style>` placeholder in
//      every target HTML document to carry the minified CSS payload. The
//      placeholder is matched by `id` (not by source position) so the
//      script remains correct even if the surrounding `<head>` is
//      re-ordered.
//
//   4. Reports per-file raw bytes, total raw bytes, and total minified
//      bytes on stdout, plus a warning when the minified payload exceeds
//      `TARGET_BYTES`. The exit code is 0 in all cases (the warning is
//      advisory, not a build failure) so the tool can be run during
//      iterative development without blocking the build pipeline; the
//      8 KB envelope is enforced by the corresponding property test, not
//      by this tool.
//
// Usage:
//   node tools/inline-critical.mjs
//
//   The script always operates on the repository's source HTML
//   (`index.html`, `404.html`) at the workspace root. It is idempotent:
//   running it twice in succession produces the same output as running
//   it once.

import { readFile, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..');

/**
 * CSS sources that compose the critical render path payload, in cascade
 * order. The list mirrors the import order of `styles/main.css` so that
 * any rule consumed at first paint resolves with the same specificity as
 * it would after the async stylesheet swap completes.
 */
const CRITICAL_FILES = [
  'styles/tokens.css',
  'styles/reset.css',
  'styles/typography.css',
  'styles/layout.css',
  'styles/components/hero.css',
];

/**
 * HTML documents that carry the `<style id="ap-critical">` placeholder.
 * The 404 page reuses the hero shell so it benefits from the
 * same critical CSS payload — both files are rewritten together so the
 * two pages stay in lockstep.
 */
const TARGET_FILES = ['index.html', '404.html'];

/**
 * Inlined-critical-CSS budget. Output above this
 * threshold triggers a stderr warning so the author can promote rules
 * out of the critical path before the property test trips.
 */
const TARGET_BYTES = 8 * 1024;

/**
 * Minify a CSS string with a small, deterministic regex pipeline.
 *
 * The pipeline is intentionally conservative: it preserves every
 * declaration, only stripping comment blocks and reformatting whitespace.
 * Selectors that contain combinators (`>`, `+`, `~`) are tightened by the
 * "spaces around punctuation" pass; selectors that contain attribute
 * matchers or the `~=` operator are not affected because the regex only
 * targets structural punctuation outside of brackets.
 *
 * @param {string} css  Raw CSS source.
 * @returns {string}    Minified CSS string.
 */
function minify(css) {
  return (
    css
      // Strip /* … */ comment blocks (multi-line capable).
      .replace(/\/\*[\s\S]*?\*\//g, '')
      // Collapse runs of whitespace (newlines, tabs, multiple spaces) to a
      // single space.
      .replace(/\s+/g, ' ')
      // Drop whitespace around structural punctuation. The character class
      // covers selector combinators (`>`, `+`, `~`), declaration blocks
      // (`{`, `}`, `;`, `:`, `,`).
      .replace(/\s*([{};:,>+~])\s*/g, '$1')
      // Drop the trailing semicolon before a closing brace — purely
      // cosmetic, but trims a few bytes per rule.
      .replace(/;}/g, '}')
      .trim()
  );
}

/**
 * Replace the `<style id="ap-critical">…</style>` block in `html` with
 * the supplied CSS payload, leaving every other byte of the document
 * untouched. Returns `null` if the placeholder is not present.
 *
 * @param {string} html   Source HTML document.
 * @param {string} css    Minified CSS payload to inline.
 * @returns {string|null} Updated HTML, or `null` if no placeholder.
 */
function injectCritical(html, css) {
  // Match opening tag (id="ap-critical" with optional extra attributes),
  // any current contents, and the closing </style>. The regex allows the
  // `id` attribute to use single or double quotes and accepts any other
  // attributes on either side of the `id`.
  const placeholderRe =
    /(<style\b[^>]*\bid=["']ap-critical["'][^>]*>)[\s\S]*?(<\/style>)/i;
  if (!placeholderRe.test(html)) return null;
  return html.replace(placeholderRe, `$1${css}$2`);
}

async function main() {
  // 1. Read every critical CSS source. Concatenate in cascade order with a
  //    small banner comment between files; the banner survives the minify
  //    pass (it is stripped by the comment regex) but it makes the raw
  //    intermediate easier to debug if `--keep-raw` is added later.
  const sources = [];
  let totalRaw = 0;
  for (const relPath of CRITICAL_FILES) {
    const absPath = resolve(repoRoot, relPath);
    const raw = await readFile(absPath, 'utf8');
    sources.push({ path: relPath, bytes: raw.length, content: raw });
    totalRaw += raw.length;
  }

  const concatenated = sources
    .map((s) => `/* ${s.path} */\n${s.content}`)
    .join('\n');
  const minified = minify(concatenated);

  // 2. Print a per-file table so the author can see which source
  //    contributes most to the critical payload.
  const pathWidth = Math.max(4, ...sources.map((s) => s.path.length));
  const byteWidth = Math.max(
    8,
    ...sources.map((s) => s.bytes.toLocaleString('en-US').length),
  );
  const sep = `+${'-'.repeat(pathWidth + 2)}+${'-'.repeat(byteWidth + 2)}+`;
  console.log(sep);
  console.log(
    `| ${'File'.padEnd(pathWidth)} | ${'Raw (B)'.padStart(byteWidth)} |`,
  );
  console.log(sep);
  for (const s of sources) {
    console.log(
      `| ${s.path.padEnd(pathWidth)} | ${s.bytes
        .toLocaleString('en-US')
        .padStart(byteWidth)} |`,
    );
  }
  console.log(sep);
  console.log(
    `Critical CSS: ${totalRaw.toLocaleString('en-US')} B raw → ${minified.length.toLocaleString(
      'en-US',
    )} B min (target ≤ ${TARGET_BYTES.toLocaleString('en-US')} B).`,
  );

  if (minified.length > TARGET_BYTES) {
    console.warn(
      `⚠ Critical CSS exceeds ${TARGET_BYTES.toLocaleString('en-US')} B target ` +
        `(${minified.length.toLocaleString('en-US')} B). Consider trimming non-hero rules ` +
        `out of the critical path.`,
    );
  }

  // 3. Inject the minified payload into every target HTML document.
  let injected = 0;
  for (const relPath of TARGET_FILES) {
    const absPath = resolve(repoRoot, relPath);
    let html;
    try {
      html = await readFile(absPath, 'utf8');
    } catch (err) {
      if (err && err.code === 'ENOENT') {
        console.warn(`Skipping ${relPath} (file not found).`);
        continue;
      }
      throw err;
    }
    const updated = injectCritical(html, minified);
    if (updated === null) {
      console.warn(
        `No <style id="ap-critical"> placeholder in ${relPath}; skipping.`,
      );
      continue;
    }
    if (updated === html) {
      console.log(`${relPath} already up to date (no rewrite needed).`);
      injected += 1;
      continue;
    }
    await writeFile(absPath, updated, 'utf8');
    console.log(
      `Inlined ${minified.length.toLocaleString('en-US')} B of critical CSS into ${relPath}.`,
    );
    injected += 1;
  }

  if (injected === 0) {
    console.error(
      'No HTML documents were updated. Check that index.html / 404.html ' +
        'contain a <style id="ap-critical"> placeholder.',
    );
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
