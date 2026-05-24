#!/usr/bin/env node
// tools/contrast-check.mjs
//
// WCAG contrast helpers for the website.
//
// Provides:
//   • parseHex(hex)            — accepts `#abc`, `#abcd`, `#aabbcc`, `#aabbccdd`
//                                (alpha ignored); returns `{r, g, b}` ∈ [0, 255]³.
//   • relativeLuminance(rgb)   — WCAG 2.1 relative luminance for an `{r, g, b}`
//                                colour expressed in 0–255 sRGB channels.
//   • contrastRatio(fg, bg)    — WCAG 2.1 contrast ratio (1 .. 21) between
//                                two colours given as `{r, g, b}` objects or
//                                hex strings.
//   • meetsAA({fg, bg, large, nonText})
//                              — returns boolean: `true` when the pair clears
//                                the relevant AA threshold (4.5 for body text,
//                                3 for large text and non-text UI).
//   • readDocumentedPairs    — async helper that parses `styles/tokens.css`
//                                and returns the enumerated (fg, bg) test pairs
//                                in both `light` and `dark` scopes.
//
// CLI mode (executed when this module is the entry point) reads
// `styles/tokens.css`, enumerates the documented pairs documented in the
// design document for , and prints a pass/fail table for the
// light + dark scopes. The CLI always exits 0; the authoritative pass/fail
// gate is the fast-check property test in `tests/property/contrast.spec.js`
//, which consumes the helpers exported here.
//

import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// ─────────────────────────────────────────────────────────────────────────────
// Pure helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Parse a CSS hex colour into `{r, g, b}` channel values.
 *
 * Accepts the four canonical hex forms:
 *   • `#rgb`4-bit per channel, expanded by digit duplication.
 *   • `#rgba`same with alpha; alpha is ignored.
 *   • `#rrggbb`8-bit per channel.
 *   • `#rrggbbaa`same with alpha; alpha is ignored.
 *
 * Whitespace is tolerated, and a missing leading `#` is accepted.
 *
 * @param {string} hex
 * @returns {{r:number, g:number, b:number}}
 */
export function parseHex(hex) {
  if (typeof hex !== 'string') {
    throw new TypeError(`parseHex expects a string; got ${typeof hex}`);
  }
  let h = hex.trim().replace(/^#/, '').toLowerCase();
  if (!/^[0-9a-f]+$/.test(h)) {
    throw new Error(`Invalid hex colour: "${hex}"`);
  }
  if (h.length === 3 || h.length === 4) {
    // Expand "abc"  → "aabbcc"
    //        "abcd" → "aabbccdd" (alpha trimmed below)
    h = h
      .slice(0, 3)
      .split('')
      .map((c) => c + c)
      .join('');
  } else if (h.length === 8) {
    // Strip alpha.
    h = h.slice(0, 6);
  } else if (h.length !== 6) {
    throw new Error(`Invalid hex colour length: "${hex}"`);
  }
  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16),
  };
}

/**
 * Linearise a single sRGB channel per the WCAG 2.1 relative-luminance
 * formula. Input is 0–255; output is the linear-light value in [0, 1].
 *
 * @param {number} c — channel value in [0, 255]
 * @returns {number}
 */
function channelToLinear(c) {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
}

/**
 * Compute the WCAG 2.1 relative luminance of a colour.
 *
 *   L = 0.2126·R + 0.7152·G + 0.0722·B
 *
 * with R, G, B as the linearised channels.
 *
 * @param {{r:number, g:number, b:number}} rgb
 * @returns {number} L in [0, 1]
 */
export function relativeLuminance({ r, g, b }) {
  return (
    0.2126 * channelToLinear(r) +
    0.7152 * channelToLinear(g) +
    0.0722 * channelToLinear(b)
  );
}

/**
 * Compute the WCAG 2.1 contrast ratio between two colours.
 *
 *   ratio = (L_lighter + 0.05) / (L_darker + 0.05)
 *
 * Each colour may be passed as either an `{r, g, b}` object (channels in
 * [0, 255]) or a hex string accepted by `parseHex`.
 *
 * @param {string|{r:number, g:number, b:number}} fg
 * @param {string|{r:number, g:number, b:number}} bg
 * @returns {number} ratio in [1, 21]
 */
export function contrastRatio(fg, bg) {
  const cf = typeof fg === 'string' ? parseHex(fg) : fg;
  const cb = typeof bg === 'string' ? parseHex(bg) : bg;
  const lf = relativeLuminance(cf);
  const lb = relativeLuminance(cb);
  const lighter = Math.max(lf, lb);
  const darker = Math.min(lf, lb);
  return (lighter + 0.05) / (darker + 0.05);
}

/**
 * Check whether a (fg, bg) pair meets WCAG 2.1 AA.
 *
 *   • body text:                 ≥ 4.5 : 1
 *   • large text or non-text UI: ≥ 3 : 1
 *
 * @param {{
 *   fg: string|{r:number, g:number, b:number},
 *   bg: string|{r:number, g:number, b:number},
 *   large?: boolean,
 *   nonText?: boolean,
 * }} options
 * @returns {boolean}
 */
export function meetsAA({ fg, bg, large = false, nonText = false }) {
  const required = large || nonText ? 3 : 4.5;
  return contrastRatio(fg, bg) >= required;
}

// ─────────────────────────────────────────────────────────────────────────────
// tokens.css parser
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The colour roles consumed by `documentedPairsForScope`. Anchored to the
 * tokens declared in `styles/tokens.css` (+ design Colour palette).
 */
const _COLOUR_ROLES = [
  'bg',
  'panel',
  'panel-opaque',
  'text',
  'text-muted',
  'text-soft',
  'line',
  'accent',
  'accent-2',
  'blue',
  'focus',
];

/**
 * Strip /* … *\/ block comments from a CSS source. Used so the regex passes
 * below don't trip over the documentation comments at the top of tokens.css.
 *
 * @param {string} css
 * @returns {string}
 */
function stripBlockComments(css) {
  return css.replace(/\/\*[\s\S]*?\*\//g, '');
}

/**
 * Find the body (text between matching braces) of the first CSS rule whose
 * selector matches `selectorPattern`. Returns `null` if no rule is found.
 *
 * The matcher is brace-balanced so it survives nested at-rules and
 * `color-mix(...)` calls inside declarations.
 *
 * `selectorPattern` MUST NOT include the trailing `{`. The matcher locates
 * the next `{` past the matched selector and walks forward from there
 * tracking brace depth.
 *
 * @param {string} css
 * @param {RegExp} selectorPattern — must include a leading anchor or context
 *                                   so the match starts at the selector.
 * @returns {string|null}
 */
function extractRuleBody(css, selectorPattern) {
  const match = selectorPattern.exec(css);
  if (!match) return null;
  // Position immediately after the matched selector text. Walk forward
  // until the `{` that opens the rule body.
  let i = match.index + match[0].length;
  while (i < css.length && css[i] !== '{') i += 1;
  if (i >= css.length) return null;
  // i now points at the opening `{`. Walk forward, tracking brace depth.
  let depth = 1;
  let j = i + 1;
  while (j < css.length && depth > 0) {
    const ch = css[j];
    if (ch === '{') depth += 1;
    else if (ch === '}') depth -= 1;
    if (depth === 0) break;
    j += 1;
  }
  if (depth !== 0) return null;
  return css.slice(i + 1, j);
}

/**
 * Extract every `--color-<role>: #hex;` declaration from a rule body and
 * return a map keyed by role.
 *
 * Only hex literals are considered; tokens whose value resolves to a
 * `var(...)` or `color-mix(...)` expression are skipped. The contrast
 * helpers operate on concrete colour values, which is sufficient for the
 * documented (fg, bg) pairs whose surfaces are all hex literals.
 *
 * @param {string} body
 * @returns {Record<string, {r:number, g:number, b:number}>}
 */
function extractColourTokens(body) {
  /** @type {Record<string, {r:number, g:number, b:number}>} */
  const out = {};
  const re = /--color-([a-z0-9-]+)\s*:\s*(#[0-9a-fA-F]{3,8})\s*;/g;
  let m;
  while ((m = re.exec(body)) !== null) {
    const role = m[1];
    try {
      out[role] = parseHex(m[2]);
    } catch {
      // Ignore malformed values; they'll surface elsewhere via Stylelint.
    }
  }
  return out;
}

/**
 * Read `styles/tokens.css` and return the colour-token maps for the
 * `light` and `dark` scopes.
 *
 *   • Light scope is the first `:root { … }` rule (no attribute / media
 *     selector context).
 *   • Dark scope is the `:root[data-theme="dark"] { … }` rule. The
 *     `@media (prefers-color-scheme: dark)` block redeclares the same
 *     palette and is therefore equivalent for our purposes; we only need
 *     one source of dark values.
 *
 * @param {string} [tokensPath] — override path for testing
 * @returns {Promise<{
 *   light: Record<string, {r:number, g:number, b:number}>,
 *   dark:  Record<string, {r:number, g:number, b:number}>,
 * }>}
 */
export async function readScopeTokens(tokensPath) {
  const here = dirname(fileURLToPath(import.meta.url));
  const path = tokensPath ?? resolve(here, '..', 'styles', 'tokens.css');
  const raw = await readFile(path, 'utf8');
  const css = stripBlockComments(raw);

  // The light scope is the first `:root {` rule that is NOT preceded by an
  // attribute selector. We anchor the match at the start of the file or
  // after a closing brace / newline boundary, and exclude `:root[`.
  // The trailing `{` is intentionally left to extractRuleBody, which scans
  // forward for it; matching it here would cause the brace-tracking pass
  // to start hunting for the *next* `{` and accidentally land inside a
  // nested rule (e.g. the inner `:root` of `@media (prefers-color-scheme: dark)`).
  const lightBody =
    extractRuleBody(css, /(^|[\s}])\s*:root(?!\[)\s*(?=\{)/) ?? '';

  const darkBody =
    extractRuleBody(css, /:root\[data-theme="dark"\]\s*(?=\{)/) ?? '';

  return {
    light: extractColourTokens(lightBody),
    dark: extractColourTokens(darkBody),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Documented (fg, bg) pairs
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Build the enumerated (fg, bg) test pairs for a single scope.
 *
 * The pair list mirrors the documented body / surface combinations from
 * the design palette: every text-bearing role against both surface roles
 * (`bg` and `panel`), plus accent / blue against both surfaces (treated
 * as large-text or non-text UI).
 *
 * Each entry includes:
 *   • `name`short label for the pass/fail table (e.g. `text on bg`).
 *   • `fgRole`the foreground token role.
 *   • `bgRole`the background token role.
 *   • `large`true for tokens that are only used at large-text sizes
 *                  (e.g. display headings or chip-style labels).
 *   • `nonText`true for tokens used only as non-text UI (e.g. focus
 *                  rings, hairline borders).
 *
 * @returns {Array<{
 *   name: string, fgRole: string, bgRole: string,
 *   large: boolean, nonText: boolean,
 * }>}
 */
function documentedPairSpecs() {
  /** @type {Array<{name:string, fgRole:string, bgRole:string, large:boolean, nonText:boolean}>} */
  const pairs = [];
  const surfaces = ['bg', 'panel'];

  // Body-text roles — must clear AA  : 1.
  for (const surface of surfaces) {
    pairs.push({
      name: `text on ${surface}`,
      fgRole: 'text',
      bgRole: surface,
      large: false,
      nonText: false,
    });
    pairs.push({
      name: `text-muted on ${surface}`,
      fgRole: 'text-muted',
      bgRole: surface,
      large: false,
      nonText: false,
    });
  }

  // Accent and blue tints are used for chip-links and primary buttons —
  // treated as large-text targets for AA (≥ 3 : 1). The button itself
  // also lays white text on a blue/accent gradient, which is a separate
  // body-text pair handled in the full enumeration; here we cover the
  // text-coloured-on-surface direction.
  for (const surface of surfaces) {
    pairs.push({
      name: `blue on ${surface}`,
      fgRole: 'blue',
      bgRole: surface,
      large: true,
      nonText: false,
    });
    pairs.push({
      name: `accent on ${surface}`,
      fgRole: 'accent',
      bgRole: surface,
      large: true,
      nonText: false,
    });
  }

  // Hairline borders and focus rings — non-text UI, ≥ 3 : 1 against bg.
  pairs.push({
    name: 'line on bg',
    fgRole: 'line',
    bgRole: 'bg',
    large: false,
    nonText: true,
  });
  pairs.push({
    name: 'focus on bg',
    fgRole: 'focus',
    bgRole: 'bg',
    large: false,
    nonText: true,
  });

  return pairs;
}

/**
 * Resolve the documented (fg, bg) pair specs against a colour-token map
 * for one scope, returning the concrete RGB colours and AA thresholds.
 *
 * Pairs whose tokens are missing from the map are silently skipped; this
 * is a defensive measure for partial/in-progress token sets, and is
 * intentionally non-fatal here. The downstream property test
 * fails the build if any documented pair is missing.
 *
 * @param {Record<string, {r:number, g:number, b:number}>} tokens
 * @returns {Array<{
 *   name: string,
 *   fg: {r:number, g:number, b:number},
 *   bg: {r:number, g:number, b:number},
 *   large: boolean,
 *   nonText: boolean,
 *   required: number,
 * }>}
 */
export function documentedPairsForScope(tokens) {
  const out = [];
  for (const spec of documentedPairSpecs()) {
    const fg = tokens[spec.fgRole];
    const bg = tokens[spec.bgRole];
    if (!fg || !bg) continue;
    out.push({
      name: spec.name,
      fg,
      bg,
      large: spec.large,
      nonText: spec.nonText,
      required: spec.large || spec.nonText ? 3 : 4.5,
    });
  }
  return out;
}

/**
 * Read `tokens.css` and produce the resolved documented pairs for both
 * scopes, suitable for direct consumption by `fc.constantFrom(...)` in
 * the property test at `tests/property/contrast.spec.js`.
 *
 * @param {string} [tokensPath] — override path for testing
 * @returns {Promise<{
 *   light: ReturnType<typeof documentedPairsForScope>,
 *   dark:  ReturnType<typeof documentedPairsForScope>,
 * }>}
 */
export async function readDocumentedPairs(tokensPath) {
  const scopes = await readScopeTokens(tokensPath);
  return {
    light: documentedPairsForScope(scopes.light),
    dark: documentedPairsForScope(scopes.dark),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers shared between exports and the CLI
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Format an `{r, g, b}` colour as a `#rrggbb` hex string.
 *
 * @param {{r:number, g:number, b:number}} rgb
 * @returns {string}
 */
function toHex({ r, g, b }) {
  const part = (n) => n.toString(16).padStart(2, '0');
  return `#${part(r)}${part(g)}${part(b)}`;
}

/**
 * Pad a string `s` to at least `width` columns with spaces on the right.
 *
 * @param {string} s
 * @param {number} width
 * @returns {string}
 */
function pad(s, width) {
  return s.length >= width ? s : s + ' '.repeat(width - s.length);
}

// ─────────────────────────────────────────────────────────────────────────────
// CLI mode
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Print a single scope's pass/fail table to stdout.
 *
 * The table columns are:
 *   scope · pair · fg hex · bg hex · ratio · required · pass
 *
 * @param {string} scope
 * @param {ReturnType<typeof documentedPairsForScope>} pairs
 */
function printScopeTable(scope, pairs) {
  const rows = pairs.map((p) => {
    const ratio = contrastRatio(p.fg, p.bg);
    return {
      scope,
      name: p.name,
      fg: toHex(p.fg),
      bg: toHex(p.bg),
      ratio: ratio.toFixed(2),
      required: p.required.toFixed(1),
      pass: ratio >= p.required ? 'PASS' : 'FAIL',
    };
  });

  const header = {
    scope: 'scope',
    name: 'pair',
    fg: 'fg',
    bg: 'bg',
    ratio: 'ratio',
    required: 'req',
    pass: 'pass',
  };

  const widths = {
    scope: Math.max(header.scope.length, ...rows.map((r) => r.scope.length)),
    name: Math.max(header.name.length, ...rows.map((r) => r.name.length)),
    fg: Math.max(header.fg.length, ...rows.map((r) => r.fg.length)),
    bg: Math.max(header.bg.length, ...rows.map((r) => r.bg.length)),
    ratio: Math.max(header.ratio.length, ...rows.map((r) => r.ratio.length)),
    required: Math.max(
      header.required.length,
      ...rows.map((r) => r.required.length),
    ),
    pass: Math.max(header.pass.length, ...rows.map((r) => r.pass.length)),
  };

  const renderRow = (r) =>
    `| ${pad(r.scope, widths.scope)} ` +
    `| ${pad(r.name, widths.name)} ` +
    `| ${pad(r.fg, widths.fg)} ` +
    `| ${pad(r.bg, widths.bg)} ` +
    `| ${pad(r.ratio, widths.ratio)} ` +
    `| ${pad(r.required, widths.required)} ` +
    `| ${pad(r.pass, widths.pass)} |`;

  const separator =
    `|${'-'.repeat(widths.scope + 2)}` +
    `|${'-'.repeat(widths.name + 2)}` +
    `|${'-'.repeat(widths.fg + 2)}` +
    `|${'-'.repeat(widths.bg + 2)}` +
    `|${'-'.repeat(widths.ratio + 2)}` +
    `|${'-'.repeat(widths.required + 2)}` +
    `|${'-'.repeat(widths.pass + 2)}|`;

  console.log(renderRow(header));
  console.log(separator);
  for (const row of rows) {
    console.log(renderRow(row));
  }
}

/**
 * CLI entry point. Reads `styles/tokens.css`, enumerates the documented
 * pairs for the light and dark scopes, and prints a pass/fail table per
 * scope. Always exits 0; the property test at  is the gate.
 */
async function main() {
  const { light, dark } = await readDocumentedPairs();

  console.log('\nWCAG 2.1 contrast — documented (fg, bg) pairs\n');

  if (light.length === 0) {
    console.warn('  [warn] no light-scope tokens parsed from styles/tokens.css');
  } else {
    printScopeTable('light', light);
  }

  console.log('');

  if (dark.length === 0) {
    console.warn('  [warn] no dark-scope tokens parsed from styles/tokens.css');
  } else {
    printScopeTable('dark', dark);
  }

  console.log('');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main();
}
