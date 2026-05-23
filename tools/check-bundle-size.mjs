#!/usr/bin/env node
// tools/check-bundle-size.mjs
//
// with the GenerativeMotif chunk independently capped at 15 KB gzipped.
//
// What this script does:
//   1. Walks `dist/` recursively for every emitted `.js` file (Vite ships JS
//      under `dist/assets/<name>-<hash>.js`, but the script also handles JS
//      placed at the dist root or in nested folders).
//   2. Computes the gzipped size of each file via the `gzip-size` package.
//   3. Prints a Markdown-style table on stdout, sorted by gzipped size.
//   4. Exits 1 on any budget violation:
//        - sum of gzipped JS bytes  > 50 KB
//        - any file matching `motif*.js` > 15 KB gzipped (matched on basename
//          using the same `motif*` glob semantics Rollup uses for chunk names)
//
// Usage:
//   node tools/check-bundle-size.mjs            (defaults to ./dist)
//   node tools/check-bundle-size.mjs <dist-dir> (override)

import { readdir, stat } from 'node:fs/promises';
import { resolve, dirname, join, basename, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSizeFromFile } from 'gzip-size';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..');

const TOTAL_BUDGET_BYTES = 50 * 1024;   // 50 KB gzipped, all JS combined
const MOTIF_BUDGET_BYTES = 15 * 1024;   // 15 KB gzipped, motif chunk alone

/**
 * Recursively yield absolute paths of every `.js` file under `dir`.
 * Skips source maps and non-JS assets.
 */
async function* walkJs(dir) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (err) {
    if (err && err.code === 'ENOENT') return;
    throw err;
  }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      yield* walkJs(full);
    } else if (entry.isFile() && entry.name.endsWith('.js')) {
      yield full;
    }
  }
}

/**
 * Returns true if the file basename should count against the motif budget.
 * Matches `motif.js`, `motif-<hash>.js`, `motif.worker.js`,
 * `motif.worker-<hash>.js`, etc. — i.e. anything Vite/Rollup emits when the
 * `manualChunks` rule names a chunk `motif*`.
 */
function isMotifChunk(filePath) {
  return /^motif(?:[.-][^/\\]*)?\.js$/.test(basename(filePath));
}

/** Format a byte count as a right-aligned, comma-separated decimal string. */
function fmtBytes(n, width) {
  return n.toLocaleString('en-US').padStart(width, ' ');
}

/** Print a Markdown table of per-file sizes, sorted by gzip size desc. */
function printTable(rows) {
  const pathWidth = Math.max(4, ...rows.map((r) => r.display.length));
  const rawWidth = Math.max(7, ...rows.map((r) => fmtBytes(r.raw, 0).length));
  const gzWidth = Math.max(8, ...rows.map((r) => fmtBytes(r.gz, 0).length));

  const header =
    '| ' +
    'File'.padEnd(pathWidth) + ' | ' +
    'Raw (B)'.padStart(rawWidth) + ' | ' +
    'Gzip (B)'.padStart(gzWidth) +
    ' |';
  const sep =
    '| ' +
    '-'.repeat(pathWidth) + ' | ' +
    '-'.repeat(rawWidth) + ' | ' +
    '-'.repeat(gzWidth) +
    ' |';

  console.log(header);
  console.log(sep);
  for (const r of rows) {
    console.log(
      '| ' +
        r.display.padEnd(pathWidth) + ' | ' +
        fmtBytes(r.raw, rawWidth) + ' | ' +
        fmtBytes(r.gz, gzWidth) +
        ' |',
    );
  }
}

async function main() {
  const distArg = process.argv[2];
  const distDir = distArg ? resolve(distArg) : resolve(repoRoot, 'dist');

  let distStat;
  try {
    distStat = await stat(distDir);
  } catch (err) {
    if (err && err.code === 'ENOENT') {
      console.error(
        `✗ Bundle-size check: ${relative(repoRoot, distDir) || distDir} ` +
          `does not exist. Run \`npm run build\` first.`,
      );
      process.exit(1);
    }
    throw err;
  }
  if (!distStat.isDirectory()) {
    console.error(`✗ Bundle-size check: ${distDir} is not a directory.`);
    process.exit(1);
  }

  const rows = [];
  for await (const path of walkJs(distDir)) {
    const [{ size: raw }, gz] = await Promise.all([
      stat(path),
      gzipSizeFromFile(path),
    ]);
    const display = relative(repoRoot, path).split(sep).join('/');
    rows.push({ path, display, raw, gz, motif: isMotifChunk(path) });
  }

  rows.sort((a, b) => b.gz - a.gz);

  if (rows.length === 0) {
    console.error(
      `✗ Bundle-size check: no .js files found under ` +
        `${relative(repoRoot, distDir) || distDir}.`,
    );
    process.exit(1);
  }

  printTable(rows);

  const totalGz = rows.reduce((s, r) => s + r.gz, 0);
  const motifGz = rows
    .filter((r) => r.motif)
    .reduce((s, r) => s + r.gz, 0);

  console.log('');
  console.log(
    `Total JS gzipped: ${totalGz.toLocaleString('en-US')} B ` +
      `(budget: ${TOTAL_BUDGET_BYTES.toLocaleString('en-US')} B)`,
  );
  console.log(
    `Motif JS gzipped: ${motifGz.toLocaleString('en-US')} B ` +
      `(budget: ${MOTIF_BUDGET_BYTES.toLocaleString('en-US')} B)`,
  );

  let fail = false;
  if (totalGz > TOTAL_BUDGET_BYTES) {
    console.error(
      `✗ Total JS budget exceeded: ${totalGz} > ${TOTAL_BUDGET_BYTES} ` +
        `bytes gzipped.`,
    );
    fail = true;
  }
  if (motifGz > MOTIF_BUDGET_BYTES) {
    console.error(
      `✗ Motif chunk budget exceeded: ${motifGz} > ${MOTIF_BUDGET_BYTES} ` +
        `bytes gzipped.`,
    );
    fail = true;
  }

  if (fail) process.exit(1);
  console.log('✓ All JS bundle-size budgets satisfied.');
}

main().catch((err) => {
  console.error('✗ Bundle-size check crashed:', err);
  process.exit(1);
});
