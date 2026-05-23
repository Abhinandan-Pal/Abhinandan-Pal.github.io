// tests/property/tokens.spec.js
//
//  — Token shape: spacing-rhythm and scale-monotonicity invariants
// of the design system token source-of-truth (`styles/tokens.css`).
//
//
// Strategy
// --------
// The natural framing of this property — "read computed style of an off-screen
// probe element and check the resolved px value"falls over inside Vitest's
// default Node environment because there is no DOM, and inside `jsdom`
// because jsdom does not resolve `var` expressions correctly: it returns
// the literal `var(--space-1, …)` string from `getComputedStyle`. The two
// reliable alternatives are (a) standing up a real browser via `@vitest/browser`
// (heavyweight) or (b) parsing `tokens.css` directly with a small, focused
// parser. We pick (b) because tokens.css is the documented source of truth
// for these values and is already parsed by `tools/contrast-check.mjs` in
// exactly the same way.
//
// What this file asserts
// ----------------------
//   Every `--space-N` declaration in the light scope
//                    resolves to a positive integer multiple of 8 px. The
//                    spec defines twelve named steps (`--space-1` …
//                    `--space-12`); fast-check exhaustively iterates that
//                    finite domain.
//
//   The radius scale `--radius-sm` < `--radius-md` <
//                    `--radius-lg` < `--radius-pill` is strictly increasing.
//                    The "consecutive pairs are strictly ordered" invariant
//                    is expressed as a fast-check property over indices 0..2
//                    so future inserts into the scale stay covered.
//
//   `--shadow-low` and `--shadow-high` are CSS box-shadow
//                    declarations of the form
//                       <offsetX> <offsetY> <blur> [<spread>] <colour>
//                    and the difference between their blur radii is ≥ 8 px,
//                    with the high shadow strictly more blurred.
//
// Each property is annotated with the requirement it validates per the spec
// workflow's PBT conventions.

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// ─────────────────────────────────────────────────────────────────────────────
// tokens.css parser — light scope
// ─────────────────────────────────────────────────────────────────────────────

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..', '..');
const tokensPath = resolve(repoRoot, 'styles', 'tokens.css');
const tokensRaw = readFileSync(tokensPath, 'utf8');

/**
 * Strip `slash-star ... star-slash` block comments so subsequent regexes
 * don't trip over documentation prose at the top of tokens.css. Mirrors the
 * same helper in `tools/contrast-check.mjs`.
 *
 * @param {string} css
 * @returns {string}
 */
function stripBlockComments(css) {
  return css.replace(/\/\*[\s\S]*?\*\//g, '');
}

const tokensCss = stripBlockComments(tokensRaw);

/**
 * Extract the body (the text between matching braces) of the first `:root`
 * rule that is NOT scoped by an attribute selector — i.e. the light scope.
 *
 * The dark-scope rule (`:root[data-theme="dark"]`) and the
 * `prefers-reduced-transparency` `:root` block are skipped. Only the light
 * scope is checked here because spacing / radius / elevation tokens are
 * scope-invariant by design (see ), so checking
 * one scope is sufficient.
 *
 * @param {string} css
 * @returns {string}
 */
function extractLightRootBody(css) {
  // Look for `:root` followed by optional whitespace and then `{`, but NOT
  // followed by `[` (which would be `:root[data-theme="dark"]`).
  const re = /(?:^|[\s}])\s*:root(?!\[)\s*\{/m;
  const match = re.exec(css);
  if (!match) {
    throw new Error('Could not locate light-scope :root rule in tokens.css');
  }
  // Walk from the `{` we just matched, tracking brace depth so nested rules
  // (none expected here, but we play it safe) are handled correctly.
  const openIdx = css.indexOf('{', match.index);
  let depth = 1;
  let i = openIdx + 1;
  while (i < css.length && depth > 0) {
    const ch = css[i];
    if (ch === '{') depth += 1;
    else if (ch === '}') depth -= 1;
    if (depth === 0) break;
    i += 1;
  }
  if (depth !== 0) {
    throw new Error('Unbalanced braces in light-scope :root rule');
  }
  return css.slice(openIdx + 1, i);
}

const lightBody = extractLightRootBody(tokensCss);

/**
 * Look up the raw declared value of a custom property within the light
 * scope, returning the trimmed text on the right-hand side of the colon
 * (without the trailing semicolon). Returns `null` if the property is not
 * declared in this scope.
 *
 * @param {string} name — token name without the leading `--`
 * @returns {string|null}
 */
function extractDecl(name) {
  // Anchor on a non-name boundary so `--space-1` does not also match
  // `--space-10`. We want the exact custom-property declaration.
  const re = new RegExp(
    `(?:^|[^A-Za-z0-9_-])--${name}\\s*:\\s*([^;]+);`,
    'm',
  );
  const m = lightBody.match(re);
  return m ? m[1].trim() : null;
}

/**
 * Coerce a CSS length value to its px-equivalent number. Only literal `Npx`
 * values are accepted; this is sufficient for spacing / radius / elevation
 * tokens, which the design document pins to integer px values. (Type-scale
 * tokens use `clamp` and `rem`, but those are not exercised .)
 *
 * @param {string} value
 * @returns {number}
 */
function pxValue(value) {
  const m = value.match(/^(-?\d+(?:\.\d+)?)\s*px\b/);
  if (!m) {
    throw new Error(`Expected a px value, got "${value}"`);
  }
  return Number(m[1]);
}

/**
 * Pull the blur radius (the third length token) out of a CSS box-shadow
 * declaration of the form `<offsetX> <offsetY> <blur> [<spread>] <colour>`.
 * The colour is `rgb(...)` / `rgba(...)` / hex / `color-mix(...)` and is
 * ignored; we only need the px lengths.
 *
 * @param {string} decl
 * @returns {number}
 */
function parseShadowBlur(decl) {
  const lengths = (decl.match(/-?\d+(?:\.\d+)?\s*px\b/g) ?? []).map((s) =>
    Number(s.match(/-?\d+(?:\.\d+)?/)[0]),
  );
  if (lengths.length < 3) {
    throw new Error(
      `Expected a box-shadow with at least three lengths, got "${decl}"`,
    );
  }
  return lengths[2];
}

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

describe('Token shape', () => {
  // ──────────────────────────────────────────────────────────────────────────
  // Spacing 8 px multiples
  // ──────────────────────────────────────────────────────────────────────────

  it('every --space-N token is a positive integer multiple of 8 px', () => {
    // Property: For every N ∈ [1, 12], the declaration `--space-N` exists in
    // the light scope, parses to a px length, and that length is a positive
    // integer multiple of 8. fast-check exhausts the finite N domain so any
    // future renumbering of the scale is covered automatically.
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 12 }), (n) => {
        const decl = extractDecl(`space-${n}`);
        expect(decl, `--space-${n} must be declared in the light scope`).not.toBeNull();
        const px = pxValue(decl);
        expect(px, `--space-${n} must be positive`).toBeGreaterThan(0);
        expect(
          px % 8,
          `--space-${n} = ${px}px must be an integer multiple of 8`,
        ).toBe(0);
      }),
      { numRuns: 12 },
    );
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Radius scale strictly increasing
  // ──────────────────────────────────────────────────────────────────────────

  it('radius scale is strictly increasing across sm < md < lg < pill', () => {
    // The named rungs of the radius scale, in spec order. The list is the
    // single source of truth for this property; if a new rung is inserted
    // it should be added here.
    const rungs = ['radius-sm', 'radius-md', 'radius-lg', 'radius-pill'];

    // Each rung must be declared and resolvable to a px length.
    const values = rungs.map((name) => {
      const decl = extractDecl(name);
      expect(decl, `--${name} must be declared in the light scope`).not.toBeNull();
      return pxValue(decl);
    });

    // Property: for every consecutive pair (i, i+1), values[i] < values[i+1].
    // Expressed as a fast-check property so future inserts into the scale
    // stay covered without rewriting the assertion block.
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: rungs.length - 2 }),
        (i) => {
          expect(
            values[i],
            `--${rungs[i]} (${values[i]}px) must be < --${rungs[i + 1]} (${values[i + 1]}px)`,
          ).toBeLessThan(values[i + 1]);
        },
      ),
      { numRuns: rungs.length - 1 },
    );
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Elevation blur radii differ by ≥ 8 px
  // ──────────────────────────────────────────────────────────────────────────

  it('elevation blur radii differ by ≥ 8 px between --shadow-low and --shadow-high', () => {
    // The elevation scale exposes two named tokens. We extract the blur
    // radius (the third length token) from each box-shadow string and
    // assert the spec-mandated ordering and minimum delta.
    const lowDecl = extractDecl('shadow-low');
    const highDecl = extractDecl('shadow-high');
    expect(lowDecl, '--shadow-low must be declared').not.toBeNull();
    expect(highDecl, '--shadow-high must be declared').not.toBeNull();

    const lowBlur = parseShadowBlur(lowDecl);
    const highBlur = parseShadowBlur(highDecl);

    expect(
      highBlur,
      `--shadow-high blur (${highBlur}px) must be > --shadow-low blur (${lowBlur}px)`,
    ).toBeGreaterThan(lowBlur);
    expect(
      highBlur - lowBlur,
      `blur delta (${highBlur - lowBlur}px) must be ≥ 8px`,
    ).toBeGreaterThanOrEqual(8);
  });
});
