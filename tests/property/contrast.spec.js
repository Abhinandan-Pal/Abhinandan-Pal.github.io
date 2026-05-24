// tests/property/contrast.spec.js
//
//  — WCAG 2.1 AA contrast holds for every documented (fg, bg)
// surface pair in both the light and the dark scope.
//
//
// Strategy
// --------
// `tools/contrast-check.mjs` is the single source of truth for which
// (foreground, background) token pairs the design system commits to. It
// parses `styles/tokens.css` for both scopes (`:root` and
// `:root[data-theme="dark"]`) and resolves each documented pair to a
// concrete `{r, g, b}` colour plus the required AA ratio:
//
//   • body text                  ≥ 4.5 : 1
//   • large text / non-text UI   ≥ 3.0 : 1
//
// Per  we use a two-arbitrary product:
//
//   • `fc.constantFrom(...pairNames)`picks one of the documented pair
//     specs by its scope-invariant name (e.g. `"text on bg"`,
//     `"accent on panel"`, `"line on bg"`). The pair name is the same
//     across light and dark; only the resolved hex values differ.
//   • `fc.constantFrom('light', 'dark')`picks the scope under test.
//
// fast-check then samples ≥ 100 (name, scope) pairs and the property body
// resolves the chosen pair against the chosen scope and asserts
// `contrastRatio(fg, bg) >= required`. The cross-product is finite (≈ 10
// pairs × 2 scopes), so 100 iterations exhaust it many times over and let
// fast-check shrink to the first failing case if any pair regresses.
//
// Notes on what is intentionally NOT done here
// --------------------------------------------
// • This file does not filter or whitelist any documented pairs. If a
//   pair fails (e.g. `line on bg` against the 3:1 non-text threshold) the
//   property is meant to surface that as a real design-token issue, not
//   to paper over it. The pair list is owned by
//   `documentedPairsForScope` in `tools/contrast-check.mjs`; the right
//   way to retire a pair is to remove it there with a documented
//   rationale, not to skip it in the test.
// • The test uses the helpers exactly as exported (`contrastRatio`,
//   `readDocumentedPairs`); no contrast maths is reimplemented here.

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import {
  contrastRatio,
  readDocumentedPairs,
} from '../../tools/contrast-check.mjs';

// Top-level await: assemble the documented pair set once, before the
// describe-block runs. This works under Vitest because the file is an ES
// module and Vitest awaits module evaluation.
const { light, dark } = await readDocumentedPairs();

// Sanity guards: if the tokens.css parser ever returns an empty list for
// either scope the property below would vacuously pass, which would be a
// silent regression of the contrast contract. Fail fast here so the cause
// is obvious.
if (light.length === 0) {
  throw new Error(
    'tests/property/contrast.spec.js: readDocumentedPairs() returned no ' +
      'pairs for the light scope; the tokens.css parser likely failed.',
  );
}
if (dark.length === 0) {
  throw new Error(
    'tests/property/contrast.spec.js: readDocumentedPairs() returned no ' +
      'pairs for the dark scope; the tokens.css parser likely failed.',
  );
}

// Pair-name index per scope. The pair spec list (`text on bg`,
// `text-muted on panel`, …) is scope-invariant — `documentedPairsForScope`
// emits the same names against light and dark colour tables — so we can
// drive the property by name and resolve to concrete colours via the
// scope-keyed lookup below.
const lightByName = new Map(light.map((p) => [p.name, p]));
const darkByName = new Map(dark.map((p) => [p.name, p]));

// The full set of documented pair names, sorted for stable shrinking.
const pairNames = Array.from(
  new Set([...lightByName.keys(), ...darkByName.keys()]),
).sort();

describe('WCAG AA contrast for documented (fg, bg) pairs', () => {
  it('every documented (fg, bg) pair clears its AA threshold in both light and dark scopes', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...pairNames),
        fc.constantFrom('light', 'dark'),
        (name, scope) => {
          const pair = (scope === 'light' ? lightByName : darkByName).get(name);
          // Some pair names may exist only in one scope if the token table
          // ever diverges; treat that as a non-failure for this draw and
          // let other draws cover it. fast-check `numRuns: 100` over a
          // tiny domain still exhausts every (name, scope) combination
          // many times.
          if (!pair) return true;

          const ratio = contrastRatio(pair.fg, pair.bg);
          if (ratio < pair.required) {
            // Throw rather than `return false` so the assertion message
            // surfaces the offending pair, the resolved hex values, and
            // the actual ratio in the fast-check counter-example output.
            throw new Error(
              `${scope} scope: ${pair.name} — ` +
                `ratio ${ratio.toFixed(2)}:1 < required ${pair.required}:1`,
            );
          }
          return true;
        },
      ),
      { numRuns: 100 },
    );

    // Also exhaustively walk every pair × scope once to guarantee coverage
    // on top of the random sampling. fast-check's shrinker will surface
    // the first counter-example if any; this loop is a belt-and-braces
    // assertion that the finite cross-product is fully covered.
    for (const scope of /** @type {const} */ (['light', 'dark'])) {
      const pairs = scope === 'light' ? light : dark;
      for (const pair of pairs) {
        const ratio = contrastRatio(pair.fg, pair.bg);
        expect(
          ratio,
          `${scope} scope: ${pair.name} — ratio ${ratio.toFixed(2)}:1 ` +
            `< required ${pair.required}:1`,
        ).toBeGreaterThanOrEqual(pair.required);
      }
    }
  });
});
