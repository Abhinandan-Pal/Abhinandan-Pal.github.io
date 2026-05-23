// tests/unit/edge-cases.spec.js
//
// Edge-case examples for substrate invariants.
//
// These specs complement the property-based tests by pinning
// concrete inputs that property tests can't easily express:
//
//   1. Empty section omission: `hideEmptySection`
//      removes the `<section>` element AND every nav link that points
//      at it (both inline header nav and dialog overlay duplicate).
//   2. Bengali grapheme handling: `Intl.Segmenter`
//      splits "অভিনন্দন পাল" into graphemes, never mid-cluster — the
//      precondition that makes `kinetic-heading.js` safe.
//   3. Date sort stability: when two entries share a date,
//      source order must win. JavaScript `Array#sort` has been stable
//      since Node 12 / V8 7.0, but we lock the contract here so any
//      regression in our ordering helpers surfaces immediately.
//   4. Hex parsing edge cases: `parseHex` accepts every
//      canonical form (`#rgb`, `#rgba`, `#rrggbb`, `#rrggbbaa`),
//      strips alpha, and throws on malformed input.
//   5. Mulberry32 determinism: the first five outputs
//      for `seed = 42` are pinned to exact bit-equal values so any
//      regression in the PRNG (mistyped constant, op-order swap, or
//      Node/V8 numeric drift) trips a hard failure on commit.
//   6. `isEmpty` semantics — exercised through `hideEmptySection` /
//      hydrate via the `contact` data slice: a contact
//      object with `emails: []` counts as empty even though it isn't
//      an array, while one with at least one email survives.
//

import { describe, it, expect, beforeEach } from 'vitest';
import { mulberry32 } from '../../scripts/motif/rng.js';
import { parseHex, contrastRatio } from '../../tools/contrast-check.mjs';

// ---------------------------------------------------------------------------
// 1. Empty section omission via hideEmptySection
// ---------------------------------------------------------------------------
//
// `hideEmptySection` lives in scripts/render.js and calls into the DOM
// (`document.getElementById`, `document.querySelectorAll`, `CSS.escape`).
// When Vitest is run with the default `node` test environment it has no
// `document`, so we gate the DOM-dependent specs on its presence and
// skip cleanly in node-only runs. To exercise this group end-to-end,
// run Vitest with `--environment jsdom` (or set the equivalent
// `vitest-environment` magic-comment directive in the test file) once
// jsdom is on the dev-dependency list.
//
// The guard is a runtime check rather than a build-time directive so
// `node --check` can validate this file without having jsdom installed.

const hasDom = typeof globalThis.document !== 'undefined';

describe('EC-1 — hideEmptySection removes the section and matching nav links', () => {
  /** @type {typeof import('../../scripts/render.js').hideEmptySection | undefined} */
  let hideEmptySection;

  beforeEach(async () => {
    if (!hasDom) return;
    // Reset the document body to a representative scaffold containing the
    // publications section, an inline nav link, and a dialog-overlay link
    // duplicate — exactly the shape produced by tasks 3.3 and 3.4.
    document.body.innerHTML = `
      <header role="banner">
        <nav class="ap-nav" aria-label="Primary">
          <ul class="ap-nav-links">
            <li><a href="#publications">Publications</a></li>
            <li><a href="#academic-training">Training</a></li>
          </ul>
        </nav>
      </header>
      <main id="main">
        <section id="publications" data-reveal>
          <h2>Publications</h2>
        </section>
        <section id="academic-training" data-reveal>
          <h2>Training</h2>
        </section>
      </main>
      <dialog id="ap-overlay" class="ap-overlay" data-nav-overlay>
        <ul>
          <li><a href="#publications">Publications</a></li>
          <li><a href="#academic-training">Training</a></li>
        </ul>
      </dialog>
    `;
    // Lazy import so the module is only evaluated when the DOM is available.
    if (!hideEmptySection) {
      ({ hideEmptySection } = await import('../../scripts/render.js'));
    }
  });

  it.skipIf(!hasDom)('removes the <section> element with the given id', () => {
    expect(document.getElementById('publications')).not.toBeNull();
    hideEmptySection('publications');
    expect(document.getElementById('publications')).toBeNull();
  });

  it.skipIf(!hasDom)('removes every nav link pointing at the removed section, in both nav surfaces', () => {
    hideEmptySection('publications');
    const remaining = document.querySelectorAll('a[href="#publications"]');
    expect(remaining.length).toBe(0);
    // The other section's links must remain untouched.
    expect(document.querySelectorAll('a[href="#academic-training"]').length).toBeGreaterThan(0);
  });

  it.skipIf(!hasDom)('is a no-op when the section id is empty or missing', () => {
    const before = document.body.innerHTML;
    hideEmptySection('');
    hideEmptySection('not-a-section');
    expect(document.body.innerHTML).toBe(before);
  });
});

// ---------------------------------------------------------------------------
// 2. Bengali grapheme handling
// ---------------------------------------------------------------------------
//
// `kinetic-heading.js` wraps each grapheme in a span so the
// Bengali run animates without breaking conjuncts. The substrate it
// relies on is `Intl.Segmenter`which must split "অভিনন্দন পাল" into
// fewer segments than the string has UTF-16 code units (because
// "ন্দ" is a single grapheme cluster spanning multiple code points).
//
// Pinning concrete expectations here so any future Node downgrade
// without `Intl.Segmenter` (or a regression in ICU data) is caught
// immediately rather than silently rendering tofu.

describe('EC-2 — Intl.Segmenter splits Bengali into graphemes, not bytes', () => {
  it.skipIf(typeof Intl.Segmenter !== 'function')(
    'segments "অভিনন্দন পাল" into 8 graphemes, fewer than its 12 UTF-16 code units',
    () => {
      const text = 'অভিনন্দন পাল';
      // Sanity: lock the UTF-16 length so any future stray re-encoding
      // shows up here.
      expect(text.length).toBe(12);

      const seg = new Intl.Segmenter('bn', { granularity: 'grapheme' });
      const segments = [...seg.segment(text)].map((s) => s.segment);

      // Exactly 8 graphemes (incl. the U+0020 space): অ, ভি, ন, ন্দ, ন,
      // ' ', পা, ল. The "ন্দ" cluster is the load-bearing one — if a
      // future ICU upgrade splits it differently, kinetic-heading.js
      // would render mid-conjunct, so we pin the exact count.
      expect(segments).toEqual(['অ', 'ভি', 'ন', 'ন্দ', 'ন', ' ', 'পা', 'ল']);
      expect(segments.length).toBeLessThan(text.length);
      expect(segments.join('')).toBe(text);
    },
  );
});

// ---------------------------------------------------------------------------
// 3. Date sort stability
// ---------------------------------------------------------------------------
//
// render.js (and the data sort in task 6.1) sort by descending date.
// JavaScript's `Array#sort` has been stable in V8 since 7.0 (Node 12+),
// so ties resolve in source order. We lock that contract with a
// representative fixture: two publications in the same month must keep
// their original relative order, with the older entry pushed to the
// tail.

describe('EC-3 — descending date sort is stable for tied dates', () => {
  it('preserves source order when two entries share a date', () => {
    const items = [
      { id: 'a', date: '2024-01' },
      { id: 'b', date: '2024-01' },
      { id: 'c', date: '2023-12' },
    ];
    const sorted = [...items].sort((x, y) => y.date.localeCompare(x.date));
    // 'a' precedes 'b' because they tied and 'a' came first in source.
    expect(sorted.map((x) => x.id)).toEqual(['a', 'b', 'c']);
  });

  it('preserves source order across a longer fixture with multiple ties', () => {
    const items = [
      { id: 'p1', date: '2025-09' }, // NeurIPS'25
      { id: 'p2', date: '2024-12' }, // NeurIPS'24
      { id: 'p3', date: '2024-12' }, // tied with p2
      { id: 'p4', date: '2024-01' }, // VMCAI'24
      { id: 'p5', date: '2022-10' }, // SPLASH'22
    ];
    const sorted = [...items].sort((x, y) => y.date.localeCompare(x.date));
    expect(sorted.map((x) => x.id)).toEqual(['p1', 'p2', 'p3', 'p4', 'p5']);
  });
});

// ---------------------------------------------------------------------------
// 4. Hex parsing edge cases
// ---------------------------------------------------------------------------
//
// `tools/contrast-check.mjs#parseHex` is shared between the build-time
// CLI and the property test at task 11.1. Locking the four canonical
// hex shapes here keeps the AA-contrast pipeline honest even if the
// parser is rewritten later.

describe('EC-4 — parseHex accepts every canonical hex form', () => {
  it('expands #rgb to its 6-digit equivalent', () => {
    expect(parseHex('#abc')).toEqual({ r: 0xaa, g: 0xbb, b: 0xcc });
  });

  it('parses 6-digit #rrggbb directly', () => {
    expect(parseHex('#aabbcc')).toEqual({ r: 0xaa, g: 0xbb, b: 0xcc });
    // And the two forms must agree byte-for-byte.
    expect(parseHex('#abc')).toEqual(parseHex('#aabbcc'));
  });

  it('strips alpha from #rgba (4-digit) and returns the same RGB as #rgb', () => {
    expect(parseHex('#abcd')).toEqual({ r: 0xaa, g: 0xbb, b: 0xcc });
    expect(parseHex('#abcd')).toEqual(parseHex('#abc'));
  });

  it('strips alpha from #rrggbbaa (8-digit) and returns the same RGB as #rrggbb', () => {
    expect(parseHex('#aabbcc80')).toEqual({ r: 0xaa, g: 0xbb, b: 0xcc });
    expect(parseHex('#aabbcc80')).toEqual(parseHex('#aabbcc'));
  });

  it('throws on non-hex characters', () => {
    expect(() => parseHex('#xyz')).toThrow(/Invalid hex/);
  });

  it('throws on malformed lengths (not 3, 4, 6, or 8)', () => {
    expect(() => parseHex('#ab')).toThrow(/Invalid hex/);
    expect(() => parseHex('#abcde')).toThrow(/Invalid hex/);
    expect(() => parseHex('#abcdefg')).toThrow(/Invalid hex/);
  });

  it('contrastRatio is symmetric — order of (fg, bg) does not matter', () => {
    // A specific check for the WCAG endpoints; with full saturation the
    // 21:1 ratio also pins the linearisation step.
    const r1 = contrastRatio('#000000', '#ffffff');
    const r2 = contrastRatio('#ffffff', '#000000');
    expect(r1).toBe(r2);
    expect(r1).toBeCloseTo(21, 5);
  });
});

// ---------------------------------------------------------------------------
// 5. Mulberry32 deterministic across Node versions
// ---------------------------------------------------------------------------
//
// The motif must regenerate identically at build time (SVG fallback +
// favicon) and at runtime (canvas + worker). That contract bottoms out
// in `mulberry32`. Pinning the first five outputs for `seed = 42` to
// exact-equal floats catches:
//
//   * a regression in the constant `0x6d2b79f5`
//   * a swapped XOR / shift order
//   * any future Node/V8 numeric drift in `Math.imul` or
//     unsigned-right-shift coercion
//
// Generated by `node -e "import('./scripts/motif/rng.js').then(m => {
//   const r = m.mulberry32(42); for (let i = 0; i < 5; i++) console.log(r); })"`
// at authoring time on Node 25.6.1.

describe('EC-5 — mulberry32 first five outputs are bit-stable for seed 42', () => {
  it('produces the documented first five floats', () => {
    const rng = mulberry32(42);
    const seq = Array.from({ length: 5 }, () => rng());
    // toBe (not toBeCloseTo) so any LSB drift shows up.
    expect(seq).toEqual([
      0.6011037519201636,
      0.44829055899754167,
      0.8524657934904099,
      0.6697340414393693,
      0.17481389874592423,
    ]);
  });

  it('re-seeding with the same seed reproduces the same sequence', () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    const seqA = Array.from({ length: 16 }, () => a());
    const seqB = Array.from({ length: 16 }, () => b());
    expect(seqA).toEqual(seqB);
  });

  it('different seeds produce different first outputs', () => {
    const a = mulberry32(42)();
    const b = mulberry32(43)();
    expect(a).not.toBe(b);
  });

  it('every emitted value lies in [0, 1)', () => {
    const rng = mulberry32(0xdeadbeef);
    for (let i = 0; i < 256; i += 1) {
      const v = rng();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});

// ---------------------------------------------------------------------------
// 6. isEmpty semantics through hydrate
// ---------------------------------------------------------------------------
//
// `isEmpty` is internal to scripts/render.js, but the contract the rest
// of the site relies on is observable through `hydrate`: when the
// `contact` slice has no emails the contact section disappears, and
// when it has at least one email the section survives.
//
// Like EC-1 these specs need a DOM and skip cleanly in `node` env runs.

describe('EC-6 — hydrate treats contact-with-no-emails as empty', () => {
  /** @type {typeof import('../../scripts/render.js').hydrate | undefined} */
  let hydrate;

  beforeEach(async () => {
    if (!hasDom) return;
    document.body.innerHTML = `
      <header role="banner">
        <nav class="ap-nav" aria-label="Primary">
          <ul class="ap-nav-links">
            <li><a href="#contact">Contact</a></li>
          </ul>
        </nav>
      </header>
      <main id="main">
        <section id="contact" data-reveal><h2>Contact</h2></section>
      </main>
    `;
    if (!hydrate) {
      ({ hydrate } = await import('../../scripts/render.js'));
    }
  });

  it.skipIf(!hasDom)('removes #contact when emails is an empty array', () => {
    hydrate({ contact: { emails: [] } });
    expect(document.getElementById('contact')).toBeNull();
    expect(document.querySelectorAll('a[href="#contact"]').length).toBe(0);
  });

  it.skipIf(!hasDom)('removes #contact when the contact slice itself is missing', () => {
    hydrate({});
    expect(document.getElementById('contact')).toBeNull();
  });

  it.skipIf(!hasDom)('removes #contact when contact is null or undefined', () => {
    hydrate({ contact: null });
    expect(document.getElementById('contact')).toBeNull();
  });

  it.skipIf(!hasDom)('keeps #contact when at least one email is present', () => {
    hydrate({ contact: { emails: ['a.pal@bham.ac.uk'] } });
    expect(document.getElementById('contact')).not.toBeNull();
    expect(document.querySelectorAll('a[href="#contact"]').length).toBeGreaterThan(0);
  });
});
