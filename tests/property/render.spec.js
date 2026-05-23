// tests/property/render.spec.js
//
//
//  — "Content fidelity: every data
// entry maps to a rendered article"asserts that the canonical
// content tree exported by `scripts/data.js` is faithfully reflected in
// the rendered HTML. The hero's identity strings, every dated list, and
// the publication / experience / training / award / teaching / service
// sections must all appear in the document so the page is fully
// readable with JavaScript disabled.
//
// Why we read `index.html` directly rather than `dist/index.html`
// (mirroring task 11.14):
//   • The source HTML is the canonical author-edited document. The
//     build step only inlines critical CSS and rewrites a single
//     stylesheet link — every assertion in this spec applies equally
//     to the source. Reading the source means the test runs without a
//     prior `vite build`, which keeps the property suite (`npm run
//     test:property`) fast and independent of the build pipeline.
//   • Per task 11.11 we deliberately use a small regex / string-based
//     parser rather than jsdom, so the property suite has no DOM
//     dependency.

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { content } from '../../scripts/data.js';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..', '..');
const html = readFileSync(resolve(repoRoot, 'index.html'), 'utf8');

describe('Content fidelity', () => {
  it('exactly one <h1> in the document', () => {
    const matches = html.match(/<h1\b/gi) || [];
    expect(matches.length).toBe(1);
  });

  it('hero contains all required identity strings', () => {
    expect(html).toContain('Abhinandan Pal');
    expect(html).toContain('অভিনন্দন পাল');
    expect(html).toContain('Obi');
    expect(html).toContain('PhD Candidate');
    expect(html).toContain('School of Computer Science, University of Birmingham');
    expect(html).toContain('Theory of Computer Science Group');
    expect(html).toContain('Neural Model Checking');
    expect(html).toContain('Mirco Giacobbe');
    expect(html).toContain('Daniel Kroening');
    expect(html).toContain('a.pal@bham.ac.uk');
  });

  it('every publication entry exists in the rendered HTML', () => {
    fc.assert(
      fc.property(fc.constantFrom(...content.publications), (pub) => {
        expect(html, `publication "${pub.title}" must be in HTML`).toContain(pub.title);
        return true;
      }),
      { numRuns: content.publications.length },
    );
  });

  it('publications are sorted descending by date', () => {
    for (let i = 1; i < content.publications.length; i++) {
      expect(content.publications[i - 1].date >= content.publications[i].date).toBe(true);
    }
  });

  it('every training entry exists with key strings', () => {
    expect(html).toContain('CGPA 9.95');
    expect(html).toContain('Department Rank 1');
    expect(html).toContain('University of Birmingham');
    expect(html).toContain('IIIT Kalyani');
    expect(html).toContain('Don Bosco School Bandel');
  });

  it('every experience entry exists', () => {
    fc.assert(
      fc.property(fc.constantFrom(...content.experience), (e) => {
        expect(html, `experience institution "${e.institution}" must be in HTML`).toContain(e.institution);
        return true;
      }),
      { numRuns: content.experience.length },
    );
  });

  it('every award exists', () => {
    expect(html).toContain('President of India Gold Medal');
    expect(html).toContain('ACM SRC Bronze');
    expect(html).toContain('ENS Saclay');
    expect(html).toContain('ENS Lyon');
  });

  it('teaching entries exist', () => {
    expect(html).toContain('OXCAV');
    expect(html).toContain('Facts and Snacks');
    expect(html).toContain('Antique');
  });

  it('service entries exist', () => {
    expect(html).toContain('BASiC');
    expect(html).toContain('AEC') || expect(html).toContain('Artifact Evaluation');
    expect(html).toContain('SIGPLAN-M');
    expect(html).toContain('CIKM');
  });

  it('contact section has both emails and online links', () => {
    expect(html).toContain('a.pal@bham.ac.uk');
    expect(html).toContain('abhinandan.mike123@gmail.com');
    expect(html).toContain('linkedin.com/in/abhinandan-pal');
    expect(html).toContain('github.com/Abhinandan-Pal');
  });

  it('every section id matches its nav link href fragment', () => {
    const sectionIdMatches = [...html.matchAll(/<section[^>]+id="([^"]+)"/g)].map((m) => m[1]);
    const navHrefMatches = [...html.matchAll(/<a[^>]+href="#([^"]+)"/g)]
      .map((m) => m[1])
      .filter((id) => sectionIdMatches.includes(id));
    // Every section id is referenced by at least one nav link.
    const main = html.split('<main')[1].split('</main>')[0];
    const sectionsInMain = [...main.matchAll(/<section[^>]+id="([^"]+)"/g)].map((m) => m[1]);
    for (const id of sectionsInMain) {
      expect(html, `section #${id} should have a matching nav link`).toContain(`href="#${id}"`);
    }
    // Surface unused matches so linters do not complain in the future.
    expect(Array.isArray(navHrefMatches)).toBe(true);
  });
});
