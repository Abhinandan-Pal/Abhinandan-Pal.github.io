#!/usr/bin/env node
// tools/check-links.mjs
//
// Build-time external link checker. Walks every `<a href="http(s)://…">`
// reference in the built HTML under `dist/` plus the `og:image` URL declared
// in each document's `<head>`, performs a HEAD request against each unique
// URL, and emits a `console.warn` line for anything that does not resolve
// to a 2xx status. Per , this is purely advisory — the script must
// never fail the build, so the process always terminates with exit code 0.
//
// Behaviour:
//   * dist/ missing → emit a single warning, exit 0.
//   * Each URL is checked with HEAD first; if HEAD returns non-2xx (or
//     throws), we retry once with GET, since some hosts (e.g. GitHub raw,
//     several academic mirrors) reject HEAD with 403/405. Only if both
//     fail do we warn.
//   * Requests have an 8 s timeout via AbortController so a single hung
//     server cannot stall CI indefinitely.
//   * Requests run with bounded concurrency (8 in flight) so a long
//     citation list checks quickly without a fetch storm.
//

import { readdir, readFile, stat } from 'node:fs/promises';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..');
const distDir = resolve(repoRoot, 'dist');

const REQUEST_TIMEOUT_MS = 8000;
const CONCURRENCY = 8;

/** Recursively yield absolute paths to every `*.html` file under `root`. */
async function* walkHtml(root) {
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = join(root, entry.name);
    if (entry.isDirectory()) {
      yield* walkHtml(full);
    } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.html')) {
      yield full;
    }
  }
}

/**
 * Extract every distinct http(s) URL that appears as an `<a href>` target,
 * along with the document's `og:image` if present.
 */
function extractHttpUrls(html) {
  const urls = new Set();

  // <a href="…"> with single or double quotes. Permissive enough for the
  // hand-authored HTML we ship (no template engine quirks to worry about).
  const anchorRe = /<a\b[^>]*?\bhref\s*=\s*["']([^"']+)["'][^>]*>/gi;
  for (const match of html.matchAll(anchorRe)) {
    const href = match[1].trim();
    if (/^https?:\/\//i.test(href)) urls.add(href);
  }

  // <meta property="og:image" content="…"> — handle either attribute order.
  const ogContentFirst =
    /<meta\b[^>]*\bcontent\s*=\s*["']([^"']+)["'][^>]*\bproperty\s*=\s*["']og:image["'][^>]*>/i;
  const ogPropertyFirst =
    /<meta\b[^>]*\bproperty\s*=\s*["']og:image["'][^>]*\bcontent\s*=\s*["']([^"']+)["'][^>]*>/i;
  for (const re of [ogPropertyFirst, ogContentFirst]) {
    const m = html.match(re);
    if (m) {
      const url = m[1].trim();
      if (/^https?:\/\//i.test(url)) urls.add(url);
    }
  }

  return urls;
}

/**
 * Issue a single fetch with a request-level timeout. Returns a normalised
 * `{ ok, status, error }` triple instead of letting the caller wrestle
 * with AbortError vs. TypeError vs. resolved-but-non-ok responses.
 */
async function tryFetch(url, method) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method,
      redirect: 'follow',
      signal: controller.signal,
      // Some servers gate on a recognisable UA. Be polite and identifiable.
      headers: { 'user-agent': 'apal-links-check/1.0 (+build-time)' },
    });
    return { ok: res.ok, status: res.status };
  } catch (err) {
    const reason =
      err && err.name === 'AbortError' ? 'timeout' : (err && err.message) || String(err);
    return { ok: false, status: 0, error: reason };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Check a URL: HEAD first, then fall back to GET on any non-2xx or error,
 * since 403/405-on-HEAD is common in the wild.
 */
async function checkUrl(url) {
  const head = await tryFetch(url, 'HEAD');
  if (head.ok) return head;
  const get = await tryFetch(url, 'GET');
  if (get.ok) return get;
  // Prefer the GET diagnostic — it's the more authoritative attempt.
  return get.status ? get : head;
}

/** Run `worker(item)` over `items` with at most `limit` in flight. */
async function mapWithConcurrency(items, limit, worker) {
  const results = new Array(items.length);
  let cursor = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const i = cursor++;
      if (i >= items.length) return;
      results[i] = await worker(items[i], i);
    }
  });
  await Promise.all(runners);
  return results;
}

async function main() {
  // Bail gracefully if the build hasn't run yet.
  try {
    await stat(distDir);
  } catch {
    console.warn(
      `[links:check] ${distDir} not found — run \`npm run build\` first. Skipping (build not failed).`,
    );
    return;
  }

  const urls = new Set();
  for await (const file of walkHtml(distDir)) {
    const html = await readFile(file, 'utf8');
    for (const u of extractHttpUrls(html)) urls.add(u);
  }

  if (urls.size === 0) {
    console.log('[links:check] no http(s) links found in dist/.');
    return;
  }

  const list = [...urls];
  console.log(`[links:check] checking ${list.length} unique URL(s)…`);

  const results = await mapWithConcurrency(list, CONCURRENCY, async (url) => {
    const r = await checkUrl(url);
    return { url, ...r };
  });

  let warnings = 0;
  for (const { url, ok, status, error } of results) {
    if (ok) continue;
    warnings += 1;
    const code = status || 'ERR';
    const detail = error ? ` (${error})` : '';
    console.warn(`[links:check] ${code} ${url}${detail}`);
  }

  console.log(
    `[links:check] checked ${list.length} URL(s); ${warnings} warning(s). Build not failed.`,
  );
}

main().catch((err) => {
  // Per  the link checker must never fail the build. Surface the
  // problem as a warning and continue.
  const reason = (err && err.stack) || (err && err.message) || String(err);
  console.warn('[links:check] checker errored, continuing:', reason);
});
