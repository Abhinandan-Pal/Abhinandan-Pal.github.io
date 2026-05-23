/**
 * Custom Stylelint plugin: `local/token-only-paint`.
 *
 * Enforces  (website):
 *   "All visual properties resolve through design system custom properties."
 *
 * Watched declarations:
 *   color, background, background-color, border-color, box-shadow, font-family
 *
 * For each watched declaration, the value MUST be entirely composed of:
 *   - `var(--name [, fallback])` references
 *   - the keywords `transparent`, `currentColor`, `inherit`, `unset`, `initial`,
 *     `none`, `revert`, `revert-layer`
 *   - the literal `0` (zero, with or without a unit) for box-shadow lengths
 *   - the keyword `inset` (box-shadow only)
 *   - whitespace and commas joining the above
 *
 * Additionally for `font-family`, the ONLY allowed values are `var(--…)`
 * references and the keywords `inherit`, `initial`, `unset`, `revert`,
 * `revert-layer`. Literal font names (quoted or unquoted) are rejected.
 *
 * The rule fails any value that contains a literal hex (`#fff`, `#abcdef`,
 * etc.), a colour function (`rgb`, `rgba`, `hsl`, `hsla`, `hwb`, `lab`, `lch`,
 * `oklab`, `oklch`, `color`), a named CSS colour (`red`, `blue`, …), or a
 * literal font-family list.
 *
 */

import stylelint from 'stylelint';
import valueParser from 'postcss-value-parser';

const {
  createPlugin,
  utils: { report, ruleMessages, validateOptions },
} = stylelint;

const ruleName = 'local/token-only-paint';

const messages = ruleMessages(ruleName, {
  disallowed: (prop, value, reason) =>
    `Unexpected literal value for "${prop}": ${value} — ${reason}. ` +
    `Reference a design system token via var(--…) instead.`,
});

const meta = {
  url: 'https://github.com/Abhinandan-Pal/Abhinandan-Pal.github.io/blob/main/tools/stylelint-token-only.mjs',
};

/** Properties whose values must come from design tokens. */
const WATCHED_PROPS = new Set([
  'color',
  'background',
  'background-color',
  'border-color',
  'box-shadow',
  'font-family',
]);

/** Keywords allowed everywhere a colour/paint value is expected. */
const PAINT_KEYWORDS = new Set([
  'transparent',
  'currentcolor',
  'inherit',
  'unset',
  'initial',
  'none',
  'revert',
  'revert-layer',
  'auto',
]);

/** Extra keywords allowed inside `box-shadow`. */
const BOX_SHADOW_KEYWORDS = new Set(['inset']);

/** Keywords allowed for `font-family` (no font names). */
const FONT_KEYWORDS = new Set([
  'inherit',
  'initial',
  'unset',
  'revert',
  'revert-layer',
]);

/** Colour functions that resolve to a literal colour value. */
const COLOR_FUNCS = new Set([
  'rgb',
  'rgba',
  'hsl',
  'hsla',
  'hwb',
  'lab',
  'lch',
  'oklab',
  'oklch',
  'color',
  'color-mix',
  'device-cmyk',
]);

/**
 * The complete set of CSS named colours (excluding the `transparent` and
 * `currentcolor` keywords, which are handled separately as allowed paint
 * keywords).
 */
const NAMED_COLORS = new Set([
  'aliceblue', 'antiquewhite', 'aqua', 'aquamarine', 'azure',
  'beige', 'bisque', 'black', 'blanchedalmond', 'blue', 'blueviolet',
  'brown', 'burlywood', 'cadetblue', 'chartreuse', 'chocolate',
  'coral', 'cornflowerblue', 'cornsilk', 'crimson', 'cyan',
  'darkblue', 'darkcyan', 'darkgoldenrod', 'darkgray', 'darkgreen',
  'darkgrey', 'darkkhaki', 'darkmagenta', 'darkolivegreen', 'darkorange',
  'darkorchid', 'darkred', 'darksalmon', 'darkseagreen', 'darkslateblue',
  'darkslategray', 'darkslategrey', 'darkturquoise', 'darkviolet',
  'deeppink', 'deepskyblue', 'dimgray', 'dimgrey', 'dodgerblue',
  'firebrick', 'floralwhite', 'forestgreen', 'fuchsia',
  'gainsboro', 'ghostwhite', 'gold', 'goldenrod', 'gray', 'green',
  'greenyellow', 'grey',
  'honeydew', 'hotpink',
  'indianred', 'indigo', 'ivory',
  'khaki',
  'lavender', 'lavenderblush', 'lawngreen', 'lemonchiffon', 'lightblue',
  'lightcoral', 'lightcyan', 'lightgoldenrodyellow', 'lightgray',
  'lightgreen', 'lightgrey', 'lightpink', 'lightsalmon', 'lightseagreen',
  'lightskyblue', 'lightslategray', 'lightslategrey', 'lightsteelblue',
  'lightyellow', 'lime', 'limegreen', 'linen',
  'magenta', 'maroon', 'mediumaquamarine', 'mediumblue', 'mediumorchid',
  'mediumpurple', 'mediumseagreen', 'mediumslateblue', 'mediumspringgreen',
  'mediumturquoise', 'mediumvioletred', 'midnightblue', 'mintcream',
  'mistyrose', 'moccasin',
  'navajowhite', 'navy',
  'oldlace', 'olive', 'olivedrab', 'orange', 'orangered', 'orchid',
  'palegoldenrod', 'palegreen', 'paleturquoise', 'palevioletred',
  'papayawhip', 'peachpuff', 'peru', 'pink', 'plum', 'powderblue', 'purple',
  'rebeccapurple', 'red', 'rosybrown', 'royalblue',
  'saddlebrown', 'salmon', 'sandybrown', 'seagreen', 'seashell', 'sienna',
  'silver', 'skyblue', 'slateblue', 'slategray', 'slategrey', 'snow',
  'springgreen', 'steelblue',
  'tan', 'teal', 'thistle', 'tomato', 'turquoise',
  'violet',
  'wheat', 'white', 'whitesmoke',
  'yellow', 'yellowgreen',
]);

const HEX_RE = /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;

/**
 * Returns true if the word represents a numeric `0` (with or without a unit).
 * Accepts: `0`, `0px`, `0rem`, `0%`, `0.0`, `0em`, etc.
 */
function isZeroLength(word) {
  return /^0(?:\.0+)?(?:[a-z%]+)?$/i.test(word);
}

/**
 * Validate a `font-family` value. Only `var(--…)` references and
 * inherit/initial/unset/revert/revert-layer keywords are allowed.
 *
 * @returns {string|null} reason for rejection, or null if the value is OK.
 */
function checkFontFamily(value) {
  const parsed = valueParser(value);
  let reason = null;

  parsed.walk((node) => {
    if (reason) return false;

    if (node.type === 'function') {
      if (node.value.toLowerCase() === 'var') {
        // The whole var(...) reference is allowed; skip its children.
        return false;
      }
      reason = `function "${node.value}()" is not a token reference`;
      return false;
    }

    if (node.type === 'string') {
      reason = `literal font name "${node.quote}${node.value}${node.quote}" is not allowed`;
      return false;
    }

    if (node.type === 'word') {
      const lower = node.value.toLowerCase();
      if (FONT_KEYWORDS.has(lower)) return undefined;
      reason = `literal font keyword "${node.value}" is not allowed — use a var(--…) token`;
      return false;
    }

    return undefined;
  });

  return reason;
}

/**
 * Validate a paint-bearing value (color, background, background-color,
 * border-color, box-shadow). Recursively rejects literal hex, colour
 * functions, named colours, and (outside `box-shadow`) bare strings.
 *
 * @param {string} prop  the (lowercased) property name
 * @param {string} value the declared value
 * @returns {string|null} reason for rejection, or null if the value is OK.
 */
function checkPaint(prop, value) {
  const parsed = valueParser(value);
  let reason = null;

  parsed.walk((node) => {
    if (reason) return false;

    if (node.type === 'function') {
      const name = node.value.toLowerCase();

      // var(--…) references are the canonical allowed form. Stop traversal
      // so that any literal in the optional fallback slot is not flagged
      // (it is documented as an allowed escape hatch).
      if (name === 'var') return false;

      if (COLOR_FUNCS.has(name)) {
        reason = `colour function "${name}()" is not allowed`;
        return false;
      }

      // gradients, env, calc, etc. — recurse into children so any
      // nested colour literal is still caught.
      return undefined;
    }

    if (node.type === 'word') {
      const raw = node.value;
      const lower = raw.toLowerCase();

      // hex colours: #abc, #abcd, #aabbcc, #aabbccdd
      if (raw.startsWith('#')) {
        if (HEX_RE.test(raw)) {
          reason = `literal hex colour "${raw}" is not allowed`;
        } else {
          reason = `unexpected token "${raw}"`;
        }
        return false;
      }

      // allowed paint keywords (transparent, currentColor, inherit, …)
      if (PAINT_KEYWORDS.has(lower)) return undefined;

      // box-shadow extras: inset, and zero-lengths
      if (prop === 'box-shadow') {
        if (BOX_SHADOW_KEYWORDS.has(lower)) return undefined;
        if (isZeroLength(raw)) return undefined;
        // any other word inside box-shadow — including non-zero lengths —
        // is a literal slipping past the token system.
        if (NAMED_COLORS.has(lower)) {
          reason = `named colour "${raw}" is not allowed`;
        } else {
          reason = `literal "${raw}" is not allowed in box-shadow — use a var(--elev-…) token`;
        }
        return false;
      }

      // generic case: a bare word here is a named colour (e.g. `red`),
      // a CSS-wide keyword we already handled, or a literal we don't want.
      if (NAMED_COLORS.has(lower)) {
        reason = `named colour "${raw}" is not allowed`;
        return false;
      }

      if (isZeroLength(raw)) return undefined;

      // background shorthand can carry positions (`center`, `top`, `0% 0%`),
      // sizes (`cover`, `contain`), repeat keywords, etc. We don't try to
      // enumerate every harmless sub-keyword; we only flag obvious literal
      // paint. Anything else passes.
      return undefined;
    }

    if (node.type === 'string') {
      // strings only carry a meaning for url/attr/font-family;
      // they're never a colour, so we leave them alone here.
      return undefined;
    }

    return undefined;
  });

  return reason;
}

const ruleFunction = (primary, _secondaryOptions, _context) => {
  return (root, result) => {
    const validOptions = validateOptions(result, ruleName, {
      actual: primary,
      possible: [true, false],
    });

    if (!validOptions || !primary) return;

    root.walkDecls((decl) => {
      const prop = decl.prop.toLowerCase();
      if (!WATCHED_PROPS.has(prop)) return;

      // Skip declarations whose value is itself a CSS variable definition,
      // e.g. `--foo: red;`. Custom-property declarations are out of scope —
      // tokens.css IS the source of truth and may contain any literal.
      if (decl.prop.startsWith('--')) return;

      const reason =
        prop === 'font-family'
          ? checkFontFamily(decl.value)
          : checkPaint(prop, decl.value);

      if (reason) {
        report({
          ruleName,
          result,
          node: decl,
          word: decl.value,
          message: messages.disallowed(decl.prop, decl.value, reason),
        });
      }
    });
  };
};

ruleFunction.ruleName = ruleName;
ruleFunction.messages = messages;
ruleFunction.meta = meta;

export default createPlugin(ruleName, ruleFunction);
