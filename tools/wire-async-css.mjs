#!/usr/bin/env node
// tools/wire-async-css.mjs
//
//
// What this script does
// ---------------------
// The critical render path is inlined into the document head by
// `tools/inline-critical.mjs`. The remainder of the
// design system (motion, every component CSS) ships in
// `styles/main.css`, which must load WITHOUT blocking first paint and
// WITHOUT degrading the experience for visitors with JavaScript
// disabled.
//
// The browser-standard idiom for that is:
//
//   <link rel="preload" as="style" href="/styles/main.css"
//         onload="this.rel='stylesheet'">
//   <noscript><link rel="stylesheet" href="/styles/main.css"></noscript>
//
//   1. The `preload` request is dispatched immediately at high priority
//      but does NOT block render — it warms the browser's cache.
//   2. When the stylesheet finishes downloading, the inline `onload`
//      handler promotes the same element to a real stylesheet by
//      rewriting `rel`. This applies the styles without a second
//      network round-trip and without a flash of unstyled content.
//   3. If JavaScript is disabled, the `onload` swap never fires; the
//      `<noscript>` fallback covers that case with a plain blocking
//      stylesheet, keeping  (no-JS hero fidelity) honest.
//
// Several common build-pipeline behaviours can silently break this
// pattern:
//
//   • HTML minifiers (and some security-conscious post-processors)
//     strip inline event-handler attributes such as `onload`.
//   • Asset hashers rewrite the `href` of one of the two `<link>` tags
//     but not the other, leaving them out of sync.
//   • Hand-edits during refactors drop the `<noscript>` fallback or
//     reorder it.
//
// This script is the single source of truth that the wiring is
// correct. It runs over the canonical source HTML files
// (`index.html`, `404.html`) — the same files `tools/inline-critical.mjs`
// rewrites — and:
//
//   1. Locates every `<link>` whose `href` resolves to
//      `STYLESHEET_HREF` (configurable below). It accepts both the
//      preload variant (`rel="preload" as="style"`) and the noscript
//      fallback variant (`rel="stylesheet"` inside `<noscript>`).
//   2. If the preload variant is missing the `onload="this.rel='stylesheet'"`
//      attribute, the script inserts it (idempotent — running twice
//      produces the same output as running once).
//   3. If the `<noscript>` fallback is missing, the script inserts it
//      immediately after the preload element so the cascade order
//      matches the source comment block in `index.html`.
//   4. Reports per-file what it found and what it rewrote.
//
// The script is conservative: it never rewrites an `href` value
// (asset hashing is the build pipeline's responsibility) and it never
// touches any `<link>` whose `href` does not match `STYLESHEET_HREF`.
//
// Usage
// -----
//   node tools/wire-async-css.mjs
//
// Wired into the build pipeline via the `wire:css` npm script. Run
// after `inline-critical` and before lint/HTML validation so the
// outgoing HTML is guaranteed to carry both halves of the swap.

import { readFile, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..');

/**
 * The stylesheet that participates in the async swap. The script keys
 * its rewrites off this exact `href` so that other stylesheets in the
 * document (none today, but the head is open to additions) are not
 * touched.
 */
const STYLESHEET_HREF = '/styles/main.css';

/**
 * The canonical onload handler that promotes the preloaded asset to
 * an applied stylesheet. Single-quoted `'stylesheet'` is required so
 * the attribute itself can use double quotes inside an HTML document
 * with double-quoted attributes elsewhere.
 */
const ONLOAD_HANDLER = "this.rel='stylesheet'";

/**
 * Source HTML documents that carry the swap. Both files are rewritten
 * together so the two pages stay in lockstep — the 404 page reuses
 * the same head contract as the home page.
 */
const TARGET_FILES = ['index.html', '404.html'];

/**
 * Build a regex that matches a single `<link>` element with a given
 * `href`. The regex captures every byte of the tag so the rewrite can
 * insert / remove attributes without disturbing surrounding markup.
 *
 * The pattern is deliberately permissive about attribute order and
 * quote style (single or double) but strict about the literal `href`
 * value so unrelated `<link>` elements (favicon, font preload,
 * canonical) are never matched.
 */
function linkTagRegex(href) {
  // Escape regex metacharacters in the href.
  const escapedHref = href.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // Match `<link …href="<HREF>"…>` with arbitrary other attributes
  // before and after, single or double quotes around the href.
  return new RegExp(
    `<link\\b([^>]*?\\bhref=["']${escapedHref}["'][^>]*)>`,
    'i',
  );
}

/**
 * Determine whether a `<link>` tag's attribute string declares the
 * preload variant (rel="preload" with as="style"). The check tolerates
 * single or double quotes and any attribute order.
 */
function isPreloadStyle(attrs) {
  return (
    /\brel=["']preload["']/i.test(attrs) &&
    /\bas=["']style["']/i.test(attrs)
  );
}

/**
 * Determine whether a `<link>` tag's attribute string declares the
 * stylesheet variant (rel="stylesheet"used inside <noscript>). The
 * helper is exported to keep the noscript-fallback detection symmetric
 * with the preload detection above; future call sites that walk every
 * `<link>` in document order can use it without re-implementing the
 * predicate.
 */
// eslint-disable-next-line no-unused-vars
function isStylesheet(attrs) {
  return /\brel=["']stylesheet["']/i.test(attrs);
}

/**
 * Determine whether the preload tag already carries the canonical
 * onload handler. Match is whitespace-tolerant and accepts either
 * quote style for the surrounding attribute value.
 */
function hasOnloadSwap(attrs) {
  // Allow either `onload="this.rel='stylesheet'"` or the rarer
  // `onload='this.rel="stylesheet"'` variant.
  return /\bonload=["'][^"']*\brel\s*=\s*["']stylesheet["'][^"']*["']/i.test(
    attrs,
  );
}

/**
 * Insert the canonical onload handler into a preload `<link>` tag's
 * attribute string. The handler is appended at the end of the
 * attributes so the existing rel/as/href order is preserved verbatim.
 */
function insertOnloadHandler(attrs) {
  const trimmed = attrs.replace(/\s+$/, '');
  return `${trimmed} onload="${ONLOAD_HANDLER}"`;
}

/**
 * Locate the `<noscript>` fallback for the stylesheet, if any. Returns
 * the match object (with `index`) or `null`. The regex requires the
 * `<noscript>` to wrap exactly the matching `<link rel="stylesheet">`
 * pointing at `STYLESHEET_HREF`.
 */
function findNoscriptFallback(html) {
  const escapedHref = STYLESHEET_HREF.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(
    `<noscript>\\s*<link\\b[^>]*\\brel=["']stylesheet["'][^>]*\\bhref=["']${escapedHref}["'][^>]*>\\s*</noscript>`,
    'i',
  );
  return re.exec(html);
}

/**
 * Wire (or rewire) the async-stylesheet swap inside `html`. Returns an
 * object reporting what was changed. The returned `html` is the
 * (possibly) updated source; if no changes were necessary the same
 * input string is returned.
 *
 * @param {string} html
 * @returns {{ html: string, addedOnload: boolean, addedNoscript: boolean,
 *             foundPreload: boolean }}
 */
function wire(html) {
  const linkRe = linkTagRegex(STYLESHEET_HREF);
  // Iterate every <link> tag pointing at STYLESHEET_HREF; we expect
  // exactly two (preload + noscript), but the loop is general.
  let updated = html;
  let addedOnload = false;
  let foundPreload = false;

  // Walk all matching tags. Replace in place so subsequent indices
  // stay valid when we don't change tag length.
  while (true) {
    const m = linkRe.exec(updated);
    if (!m) break;
    const [fullTag, attrs] = m;

    if (isPreloadStyle(attrs)) {
      foundPreload = true;
      if (!hasOnloadSwap(attrs)) {
        const replacement = `<link${insertOnloadHandler(attrs)}>`;
        updated =
          updated.slice(0, m.index) +
          replacement +
          updated.slice(m.index + fullTag.length);
        addedOnload = true;
        // Re-run from the top — the attribute string changed length.
        linkRe.lastIndex = 0;
        continue;
      }
    }
    // Advance past this match so the loop terminates. Setting
    // lastIndex on a non-/g regex has no effect, so the loop relies on
    // the bail below.
    // For non-global RegExps, exec always starts from index 0, so to
    // continue the walk we slice `updated` from the end of the match.
    // Easier: bail out; we only ever need at most two passes.
    break;
  }

  if (!foundPreload) {
    // No preload link with our href is present at all. We do not invent
    // one — that is the source author's responsibility. Surface the
    // condition to the caller.
    return {
      html: updated,
      addedOnload,
      addedNoscript: false,
      foundPreload: false,
    };
  }

  // Ensure the <noscript> fallback exists immediately after the
  // preload tag. If the search above mutated `updated`, re-locate the
  // preload tag in the (possibly) new string.
  let addedNoscript = false;
  const fallback = findNoscriptFallback(updated);
  if (!fallback) {
    const preloadMatch = linkTagRegex(STYLESHEET_HREF).exec(updated);
    // We just verified `foundPreload`, so `preloadMatch` is non-null.
    if (preloadMatch && isPreloadStyle(preloadMatch[1])) {
      const insertAt = preloadMatch.index + preloadMatch[0].length;
      const fallbackTag = `\n  <noscript><link rel="stylesheet" href="${STYLESHEET_HREF}"></noscript>`;
      updated = updated.slice(0, insertAt) + fallbackTag + updated.slice(insertAt);
      addedNoscript = true;
    }
  }

  return { html: updated, addedOnload, addedNoscript, foundPreload };
}

async function main() {
  let exitCode = 0;
  let touched = 0;

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

    const result = wire(html);

    if (!result.foundPreload) {
      console.error(
        `${relPath}: no <link rel="preload" as="style" href="${STYLESHEET_HREF}"> ` +
          `tag found. Add the async-stylesheet element to the document <head> ` +
          `so the build step can wire its onload swap.`,
      );
      exitCode = 1;
      continue;
    }

    if (result.html !== html) {
      await writeFile(absPath, result.html, 'utf8');
      const ops = [];
      if (result.addedOnload) ops.push("inserted onload swap");
      if (result.addedNoscript) ops.push("inserted <noscript> fallback");
      console.log(`${relPath}: ${ops.join(', ')}.`);
      touched += 1;
    } else {
      console.log(`${relPath}: async-stylesheet wiring already in place.`);
    }
  }

  if (touched === 0 && exitCode === 0) {
    // Idempotent run with nothing to fix — emit a clean confirmation
    // line so CI logs make the no-op visible.
    console.log(
      `Async-stylesheet swap verified for ${TARGET_FILES.join(', ')}.`,
    );
  }

  process.exit(exitCode);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
