/**
 * Stylelint configuration for the website.
 *
 * Extends `stylelint-config-standard` and wires in the workspace-local rule
 * `local/token-only-paint` (see `tools/stylelint-token-only.mjs`), which
 * enforces : every `color`, `background`,
 * `background-color`, `border-color`, `box-shadow`, and `font-family`
 * declaration must resolve through a design system custom property.
 *
 * The token-source-of-truth file `styles/tokens.css` defines the actual
 * colour / type / shadow values and is therefore exempt from the rule via an
 * override block.
 */

/** @type {import('stylelint').Config} */
export default {
  extends: ['stylelint-config-standard'],
  plugins: ['./tools/stylelint-token-only.mjs'],
  rules: {
    'local/token-only-paint': true,

    // The custom rule already enforces token usage for colour-bearing
    // properties; keep the standard config's other defaults but relax a few
    // rules that conflict with the editorial CSS we are about to author.
    'no-descending-specificity': null,
    'selector-class-pattern': null,
    'custom-property-pattern': null,
  },
  overrides: [
    {
      // tokens.css defines the literal colour / shadow values that everything
      // else must reference; the token-only rule must not run against it.
      files: ['styles/tokens.css'],
      rules: {
        'local/token-only-paint': null,
      },
    },
  ],
};
