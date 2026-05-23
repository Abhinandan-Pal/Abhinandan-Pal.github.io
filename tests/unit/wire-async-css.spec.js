// tests/unit/wire-async-css.spec.js
//
//
// The build step (`tools/wire-async-css.mjs`) is responsible for
// keeping `<link rel="preload" as="style" href="/styles/main.css">`
// wired to `onload="this.rel='stylesheet'"` and for keeping the
// `<noscript>` fallback in place.
//
// This spec exercises the tool's exported behaviour directly (so the
// test does not depend on any particular build invocation order) and
// also asserts the same invariants on the canonical source HTML
// (`index.html`, `404.html`) that ship to GitHub Pages.

import { readFile } from 'node:fs/promises';
import {
  mkdtempSync,
  writeFileSync,
  readFileSync,
  rmSync,
  mkdirSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { describe, it, expect } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..', '..');

/**
 * Re-import the wiring helpers via dynamic import so the tool's
 * `main` (which invokes `process.exit`) is never executed by the
 * test runner. We import the module for its side-effect-free helpers
 * by reading the file and evaluating only the `wire` export below.
 *
 * We expose `wire` for the test by re-implementing the contract via a
 * subprocess invocation in the round-trip test (so the published
 * behaviour is what we assert), and by static regex assertions for
 * the canonical source files.
 */
async function readSource(relPath) {
  return readFile(resolve(repoRoot, relPath), 'utf8');
}

const STYLESHEET_HREF = '/styles/main.css';

/**
 * Returns the substring of `html` that contains the `<link rel="preload"
 * as="style" href="/styles/main.css" …>` tag, or `null` if the tag is
 * absent.
 */
function findPreloadTag(html) {
  const re = new RegExp(
    `<link\\b[^>]*\\brel=["']preload["'][^>]*\\bas=["']style["'][^>]*\\bhref=["']${STYLESHEET_HREF}["'][^>]*>`,
    'i',
  );
  const m = re.exec(html);
  return m ? m[0] : null;
}

/**
 * Returns true if `tag` carries an `onload` handler that promotes
 * `rel` to `'stylesheet'`. Tolerates whitespace and either quote style.
 */
function hasOnloadSwap(tag) {
  return /\bonload=["'][^"']*\brel\s*=\s*["']stylesheet["'][^"']*["']/i.test(
    tag,
  );
}

/**
 * Returns true if `html` contains a `<noscript>` element wrapping a
 * `<link rel="stylesheet" href="/styles/main.css">` fallback.
 */
function hasNoscriptFallback(html) {
  const re = new RegExp(
    `<noscript>\\s*<link\\b[^>]*\\brel=["']stylesheet["'][^>]*\\bhref=["']${STYLESHEET_HREF}["'][^>]*>\\s*</noscript>`,
    'i',
  );
  return re.test(html);
}

describe('async stylesheet swap', () => {
  for (const relPath of ['index.html', '404.html']) {
    describe(relPath, () => {
      it('declares <link rel="preload" as="style"> for the async stylesheet', async () => {
        const html = await readSource(relPath);
        const tag = findPreloadTag(html);
        expect(tag).not.toBeNull();
      });

      it('preserves onload="this.rel=\'stylesheet\'" on the preload tag', async () => {
        const html = await readSource(relPath);
        const tag = findPreloadTag(html);
        expect(tag).not.toBeNull();
        // The build step is required to keep this attribute attached
        // even after HTML minifiers / asset hashers run.
        expect(hasOnloadSwap(tag)).toBe(true);
      });

      it('keeps the <noscript> fallback for JS-disabled visitors', async () => {
        const html = await readSource(relPath);
        //  — full hero fidelity without JavaScript depends on
        // the synchronous <noscript> fallback applying main.css.
        expect(hasNoscriptFallback(html)).toBe(true);
      });

      it('orders the noscript fallback after the preload tag', async () => {
        const html = await readSource(relPath);
        const preloadTag = findPreloadTag(html);
        const preloadIndex = html.indexOf(preloadTag);
        // Match the actual fallback element (not any literal `<noscript>`
        // string inside a comment block) so the ordering check keys off
        // the markup that ships, not the prose that documents it.
        const fallbackRe = new RegExp(
          `<noscript>\\s*<link\\b[^>]*\\brel=["']stylesheet["'][^>]*\\bhref=["']${STYLESHEET_HREF}["'][^>]*>\\s*</noscript>`,
          'i',
        );
        const fallbackMatch = fallbackRe.exec(html);
        // The ordering matters: the preload starts the request
        // immediately, and the noscript fallback only matters if JS is
        // disabled (in which case the preload's onload never fires).
        expect(preloadIndex).toBeGreaterThanOrEqual(0);
        expect(fallbackMatch).not.toBeNull();
        expect(fallbackMatch.index).toBeGreaterThan(preloadIndex);
      });
    });
  }
});


describe('wire-async-css.mjs — rewriter behaviour', () => {
  // Round-trip the tool against in-memory fixtures by spawning Node
  // with a small driver script. This avoids importing the tool's
  // top-level `main` (which calls `process.exit`).
  //
  // We test two failure modes the tool is designed to repair:
  //   1. A preload tag missing its `onload` swap.
  //   2. A preload tag present but with no `<noscript>` fallback.
  //
  // The expected behaviour is idempotent: the second run is a no-op.

  /**
   * Build a minimal HTML document around an async-stylesheet block.
   * The surrounding `<head>` is stripped down to the bare essentials so
   * the test's assertions key off the swap wiring alone.
   */
  function makeDoc(swapBlock) {
    return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>fixture</title>
  ${swapBlock}
</head>
<body></body>
</html>
`;
  }

  /**
   * Run the tool against a temporary repo root containing the fixture
   * HTML files. Returns the rewritten contents of every target.
   */
  function runTool(fixtureFiles) {
    const repoRootForTool = mkdtempSync(join(tmpdir(), 'wire-async-css-'));
    mkdirSync(join(repoRootForTool, 'tools'), { recursive: true });
    // Copy the tool itself so the script's `repoRoot` (computed from
    // its own `import.meta.url`) points at the temp directory.
    const toolSrc = readFileSync(
      resolve(repoRoot, 'tools', 'wire-async-css.mjs'),
      'utf8',
    );
    writeFileSync(
      join(repoRootForTool, 'tools', 'wire-async-css.mjs'),
      toolSrc,
      'utf8',
    );
    for (const [name, content] of Object.entries(fixtureFiles)) {
      writeFileSync(join(repoRootForTool, name), content, 'utf8');
    }

    const result = spawnSync(
      process.execPath,
      [join(repoRootForTool, 'tools', 'wire-async-css.mjs')],
      { encoding: 'utf8' },
    );

    const out = {};
    for (const name of Object.keys(fixtureFiles)) {
      out[name] = readFileSync(join(repoRootForTool, name), 'utf8');
    }
    rmSync(repoRootForTool, { recursive: true, force: true });
    return { exitCode: result.status, stdout: result.stdout, files: out };
  }

  it('inserts onload swap when the preload tag is missing it', () => {
    const broken = makeDoc(
      `<link rel="preload" as="style" href="/styles/main.css">
  <noscript><link rel="stylesheet" href="/styles/main.css"></noscript>`,
    );
    const { exitCode, files } = runTool({ 'index.html': broken });
    expect(exitCode).toBe(0);
    const fixed = files['index.html'];
    expect(fixed).toMatch(/onload="this\.rel='stylesheet'"/);
    // Idempotency: running a second time changes nothing.
    const { files: filesAgain } = runTool({ 'index.html': fixed });
    expect(filesAgain['index.html']).toBe(fixed);
  });

  it('inserts the <noscript> fallback when missing', () => {
    const broken = makeDoc(
      `<link rel="preload" as="style" href="/styles/main.css" onload="this.rel='stylesheet'">`,
    );
    const { exitCode, files } = runTool({ 'index.html': broken });
    expect(exitCode).toBe(0);
    const fixed = files['index.html'];
    expect(fixed).toMatch(
      /<noscript>\s*<link rel="stylesheet" href="\/styles\/main\.css">\s*<\/noscript>/,
    );
  });

  it('exits non-zero when the preload tag is absent', () => {
    const broken = makeDoc(
      `<link rel="stylesheet" href="/styles/some-other.css">`,
    );
    const { exitCode } = runTool({ 'index.html': broken });
    expect(exitCode).toBe(1);
  });

  it('is idempotent on a correctly-wired document', () => {
    const wired = makeDoc(
      `<link rel="preload" as="style" href="/styles/main.css" onload="this.rel='stylesheet'">
  <noscript><link rel="stylesheet" href="/styles/main.css"></noscript>`,
    );
    const { exitCode, files } = runTool({ 'index.html': wired });
    expect(exitCode).toBe(0);
    expect(files['index.html']).toBe(wired);
  });
});
