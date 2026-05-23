// tests/unit/p3-token-only-paint.spec.js
//
//
//  — "All visual properties resolve
// through design system custom properties"is enforced at lint time by the
// workspace-local Stylelint rule `local/token-only-paint`
// (see `tools/stylelint-token-only.mjs`, wired into `stylelint.config.js`,
// and surfaced in CI via the `npm run lint:css` script).
//
// This spec is a regression gate for that enforcement chain. It does not
// re-implement the rule; it asserts that the four moving parts that make
// the rule effective are all in place:
//
//   1. The plugin file exists on disk at the documented location.
//   2. The plugin's default export is a Stylelint plugin object whose
//      `ruleName` is `local/token-only-paint`.
//   3. `stylelint.config.js` registers the plugin AND enables the rule
//      (with a documented override that exempts `styles/tokens.css`, which
//      is the canonical source of literal token values).
//   4. `package.json` exposes a `lint:css` script that invokes Stylelint
//      against `styles/**/*.css`, so CI running `npm run
//      lint:css` will actually fail the build on a violation.
//
// If any of these regress — the rule file is moved, the config no longer
// enables the rule, or the script is renamed — this test fails immediately
// and surfaces the regression long before CI runs Stylelint over real CSS.

import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..', '..');

const pluginPath = resolve(repoRoot, 'tools', 'stylelint-token-only.mjs');
const stylelintConfigPath = resolve(repoRoot, 'stylelint.config.js');
const packageJsonPath = resolve(repoRoot, 'package.json');

describe('token-only paint enforcement', () => {
  it('the custom Stylelint rule file exists at tools/stylelint-token-only.mjs', () => {
    // move or delete it without updating the config wiring below.
    expect(
      existsSync(pluginPath),
      `expected the plugin file at ${pluginPath} to exist`,
    ).toBe(true);
  });

  it('the plugin module default-exports a Stylelint plugin object with ruleName "local/token-only-paint"', async () => {
    // object of shape `{ ruleName, rule }`. The module's default export
    // must therefore expose `ruleName === 'local/token-only-paint'` so
    // that Stylelint can dispatch declarations to it.
    //
    // We import via a `file://` URL so the resolver works regardless of
    // how Vitest invokes the test file (CWD, symlinks, etc.).
    const mod = await import(pathToFileURL(pluginPath).href);
    expect(mod.default, 'plugin module must have a default export').toBeDefined();
    expect(mod.default.ruleName).toBe('local/token-only-paint');
  });

  it('stylelint.config.js registers the plugin and enables the rule', () => {
    // so that `npm run lint:css` actually evaluates the rule. We read the
    // config file as text (rather than importing it) so this test stays
    // resilient to module-loader differences and clearly anchors on the
    // exact tokens we care about.
    expect(
      existsSync(stylelintConfigPath),
      `expected ${stylelintConfigPath} to exist`,
    ).toBe(true);

    const cfg = readFileSync(stylelintConfigPath, 'utf8');

    // The plugin must be registered by its on-disk path.
    expect(
      cfg,
      'stylelint.config.js must register the local plugin file under `plugins`',
    ).toMatch(/['"]\.\/tools\/stylelint-token-only\.mjs['"]/);

    // The rule must be enabled (set to `true`) in the top-level rules map.
    expect(
      cfg,
      'stylelint.config.js must enable `local/token-only-paint: true`',
    ).toMatch(/['"]local\/token-only-paint['"]\s*:\s*true/);

    // The override that exempts `styles/tokens.css` (the source of literal
    // token values) must also be present, otherwise running the rule will
    // immediately flag every legitimate token declaration.
    expect(
      cfg,
      'stylelint.config.js must override `local/token-only-paint` for styles/tokens.css',
    ).toMatch(/styles\/tokens\.css/);
  });

  it('package.json defines a `lint:css` script that runs stylelint over styles/**/*.css', () => {
    // this script is renamed or removed, the rule never executes in CI.
    const pkg = JSON.parse(readFileSync(packageJsonPath, 'utf8'));

    expect(pkg.scripts, 'package.json must declare a "scripts" map').toBeDefined();
    expect(
      pkg.scripts['lint:css'],
      'package.json must declare a "lint:css" script',
    ).toBeDefined();

    const script = pkg.scripts['lint:css'];
    expect(script, '"lint:css" must invoke stylelint').toMatch(/stylelint/);
    expect(script, '"lint:css" must target styles/**/*.css').toMatch(
      /styles\/\*\*\/\*\.css/,
    );
  });
});
