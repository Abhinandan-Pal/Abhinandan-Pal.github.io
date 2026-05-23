// ESLint flat config for the website.
//
// Scope:
// - Browser ES modules in scripts/, with shared rules for tools/ and tests/.
// - Tests can use vitest and Playwright globals.
// -
//   discipline supported by linting against unused vars / sloppy code in
//   the JS that drives the DOM).

import js from '@eslint/js';

/** Browser globals used by progressive-enhancement modules. */
const browserGlobals = {
  window: 'readonly',
  document: 'readonly',
  navigator: 'readonly',
  location: 'readonly',
  history: 'readonly',
  console: 'readonly',
  performance: 'readonly',
  requestAnimationFrame: 'readonly',
  cancelAnimationFrame: 'readonly',
  requestIdleCallback: 'readonly',
  cancelIdleCallback: 'readonly',
  setTimeout: 'readonly',
  clearTimeout: 'readonly',
  setInterval: 'readonly',
  clearInterval: 'readonly',
  queueMicrotask: 'readonly',
  matchMedia: 'readonly',
  getComputedStyle: 'readonly',
  IntersectionObserver: 'readonly',
  ResizeObserver: 'readonly',
  MutationObserver: 'readonly',
  CSS: 'readonly',
  Image: 'readonly',
  HTMLElement: 'readonly',
  HTMLDialogElement: 'readonly',
  HTMLAnchorElement: 'readonly',
  HTMLCanvasElement: 'readonly',
  CanvasRenderingContext2D: 'readonly',
  OffscreenCanvas: 'readonly',
  Worker: 'readonly',
  customElements: 'readonly',
  Intl: 'readonly',
  URL: 'readonly',
  URLSearchParams: 'readonly',
  fetch: 'readonly',
  AbortController: 'readonly',
  Event: 'readonly',
  CustomEvent: 'readonly',
  PointerEvent: 'readonly',
  KeyboardEvent: 'readonly',
};

/** Node-ish globals for build/tooling scripts in tools/. */
const nodeGlobals = {
  process: 'readonly',
  console: 'readonly',
  Buffer: 'readonly',
  __dirname: 'readonly',
  __filename: 'readonly',
  globalThis: 'readonly',
  setTimeout: 'readonly',
  clearTimeout: 'readonly',
  setInterval: 'readonly',
  clearInterval: 'readonly',
  setImmediate: 'readonly',
  URL: 'readonly',
  URLSearchParams: 'readonly',
  fetch: 'readonly',
  AbortController: 'readonly',
};

/** Vitest + Playwright test globals. */
const testGlobals = {
  // Vitest
  describe: 'readonly',
  it: 'readonly',
  test: 'readonly',
  expect: 'readonly',
  beforeAll: 'readonly',
  beforeEach: 'readonly',
  afterAll: 'readonly',
  afterEach: 'readonly',
  vi: 'readonly',
  // Playwright
  page: 'readonly',
  browser: 'readonly',
  context: 'readonly',
};

const sharedRules = {
  'no-unused-vars': ['error', {
    argsIgnorePattern: '^_',
    varsIgnorePattern: '^_',
    caughtErrorsIgnorePattern: '^_',
  }],
  'no-console': 'warn',
  'prefer-const': 'error',
};

export default [
  // Ignore generated, vendored, and dependency directories.
  {
    ignores: [
      'dist/**',
      'node_modules/**',
      'coverage/**',
      'playwright-report/**',
      'test-results/**',
      '.lighthouseci/**',
    ],
  },

  // Base recommended rule set from @eslint/js.
  js.configs.recommended,

  // Browser ES modules: scripts/ runs in the page.
  {
    files: ['scripts/**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: browserGlobals,
    },
    rules: sharedRules,
  },

  // Build / tooling scripts: Node ESM context.
  {
    files: ['tools/**/*.{js,mjs}'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: nodeGlobals,
    },
    rules: {
      ...sharedRules,
      // Tooling legitimately logs progress and warnings to stdout/stderr.
      'no-console': 'off',
    },
  },

  // Tests: Vitest unit/property + Playwright e2e share this block.
  {
    files: ['tests/**/*.{js,mjs}'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        ...browserGlobals,
        ...nodeGlobals,
        ...testGlobals,
      },
    },
    rules: {
      ...sharedRules,
      // Tests intentionally log diagnostic data on failure paths.
      'no-console': 'off',
    },
  },
];
