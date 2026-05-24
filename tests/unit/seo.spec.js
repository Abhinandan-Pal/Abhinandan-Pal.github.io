// tests/unit/seo.spec.js
//
//
//  — "SEO and structured-data
// invariants"asserts that the document head and the SEO companion
// files are well-formed for crawlers, social-media unfurlers, and
// schema.org consumers.
//
// Why we read `index.html` directly rather than `dist/index.html`:
//   • The source HTML is the canonical author-edited document; the build
//     step only inlines critical CSS and rewrites a single
//     stylesheet link. Every assertion in this spec — title length,
//     description length, OG/Twitter tags, JSON-LD, html lang, Bengali
//     run, robots.txt and sitemap.xml — applies equally to the source.
//   • Reading the source means the test runs without a prior `vite
//     build`, which keeps the unit suite (`npm run test:unit`) fast and
//     independent of the build pipeline.
// If `dist/index.html` exists (a build has been run) we still prefer the
// source: the head metadata is identical and the source lives at a
// stable path.
//
// What we check (mapped to requirements):
//   - <html lang="en">
//   - <title> ∈ [50,60] chars, contains "Abhinandan Pal"+"PhD"
//   - <meta name="description"> ∈ [140,160] chars, contains
//     "Abhinandan Pal", "Neural Model Checking",
//     "University of Birmingham"
//   - <link rel="canonical"> points at deployed URL
//   - Open Graph tags present
//     (og:type, og:title, og:description, og:url, og:image,
//     og:image:alt)
//   - Twitter Card tags present
//     (twitter:card, twitter:title, twitter:description,
//     twitter:image)
//   - JSON-LD Person schema with required fields
//     (@context, @type=Person, name, alternateName="Obi",
//      jobTitle, affiliation, url, email, sameAs[])
//   - Bengali run carries lang="bn"
//   - robots.txt exists
//   - sitemap.xml exists

import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..', '..');
const indexPath = resolve(repoRoot, 'index.html');
const html = readFileSync(indexPath, 'utf8');

/**
 * Read the `content` attribute of a `<meta>` tag identified either by
 * `name="…"` (HTML/Twitter-card style) or `property="…"` (Open Graph
 * style). HTML allows the attributes to appear in either order, so we
 * try both directions; we anchor on the exact attribute value with
 * quotes so e.g. `og:image` does not also match `og:image:alt`.
 *
 * Returns the matched content string, or `null` if no such tag is
 * present.
 *
 * @param {string} key   — value of the `name` or `property` attribute
 * @param {boolean} isProperty — true → match `property="…"`, false → `name="…"`
 * @returns {string | null}
 */
function metaContent(key, isProperty = false) {
  const attr = isProperty ? 'property' : 'name';
  const reKeyFirst = new RegExp(
    `<meta\\s+(?:[^>]*\\s)?${attr}=["']${key}["'][^>]*\\s+content=["']([^"']*)["']`,
    'i',
  );
  const reContentFirst = new RegExp(
    `<meta\\s+(?:[^>]*\\s)?content=["']([^"']*)["'][^>]*\\s+${attr}=["']${key}["']`,
    'i',
  );
  const m = html.match(reKeyFirst) || html.match(reContentFirst);
  return m ? m[1] : null;
}

describe('SEO and structured data', () => {
  it('declares <html lang="en">', () => {
    expect(html).toMatch(/<html\s+[^>]*\blang=["']en["']/i);
  });

  it('<title> length is in [50, 60] and contains "Abhinandan Pal" and "PhD"', () => {
    const m = html.match(/<title>([^<]*)<\/title>/i);
    expect(m, 'index.html must contain a <title> element').not.toBeNull();
    const title = m[1].trim();
    expect(title.length, `title length = ${title.length}`).toBeGreaterThanOrEqual(50);
    expect(title.length, `title length = ${title.length}`).toBeLessThanOrEqual(60);
    expect(title).toContain('Abhinandan Pal');
    expect(title).toContain('PhD');
  });

  it('<meta name="description"> length is in [140, 160] and contains required tokens', () => {
    const desc = metaContent('description');
    expect(desc, 'index.html must contain a <meta name="description">').not.toBeNull();
    expect(desc.length, `description length = ${desc.length}`).toBeGreaterThanOrEqual(140);
    expect(desc.length, `description length = ${desc.length}`).toBeLessThanOrEqual(160);
    expect(desc).toContain('Abhinandan Pal');
    expect(desc).toContain('Neural Model Checking');
    expect(desc).toContain('University of Birmingham');
  });

  it('declares a canonical URL pointing at the deployed site', () => {
    // Allow either `https://abhinandan-pal.github.io` or the same with a
    // trailing slash; both resolve to the canonical site root.
    expect(html).toMatch(
      /<link\s+(?:[^>]*\s)?rel=["']canonical["'][^>]*\s+href=["']https:\/\/abhinandan-pal\.github\.io\/?["']|<link\s+(?:[^>]*\s)?href=["']https:\/\/abhinandan-pal\.github\.io\/?["'][^>]*\s+rel=["']canonical["']/i,
    );
  });

  it('has the full Open Graph tag set', () => {
    const required = [
      'og:type',
      'og:title',
      'og:description',
      'og:url',
      'og:image',
      'og:image:alt',
    ];
    for (const key of required) {
      const value = metaContent(key, /* isProperty */ true);
      expect(value, `missing or empty <meta property="${key}">`).not.toBeNull();
      expect(value && value.length > 0, `<meta property="${key}"> must have non-empty content`).toBe(true);
    }
  });

  it('has the full Twitter Card tag set', () => {
    const required = [
      'twitter:card',
      'twitter:title',
      'twitter:description',
      'twitter:image',
    ];
    for (const key of required) {
      const value = metaContent(key, /* isProperty */ false);
      expect(value, `missing or empty <meta name="${key}">`).not.toBeNull();
      expect(value && value.length > 0, `<meta name="${key}"> must have non-empty content`).toBe(true);
    }
  });

  it('embeds a JSON-LD Person schema with the required fields', () => {
    // Pick the first <script type="application/ld+json"> block. There is
    // exactly one in the source today; if more are added later, this
    // assertion still applies to the first one (the Person schema).
    const m = html.match(
      /<script\b[^>]*\btype=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/i,
    );
    expect(m, 'index.html must contain a <script type="application/ld+json">').not.toBeNull();

    let json;
    expect(() => {
      json = JSON.parse(m[1]);
    }, 'JSON-LD payload must parse as JSON').not.toThrow();

    expect(json['@context']).toBe('https://schema.org');
    expect(json['@type']).toBe('Person');
    expect(json.name).toBe('Abhinandan Pal');
    expect(json.alternateName).toBe('Obi');
    expect(typeof json.jobTitle).toBe('string');
    expect(json.jobTitle.length).toBeGreaterThan(0);

    // `affiliation` may be a string or an object per schema.org. Either
    // shape is acceptable so long as it is present.
    expect(json.affiliation).toBeDefined();

    expect(typeof json.url).toBe('string');
    expect(json.url.length).toBeGreaterThan(0);
    expect(typeof json.email).toBe('string');
    expect(json.email.length).toBeGreaterThan(0);

    expect(Array.isArray(json.sameAs), 'sameAs must be an array').toBe(true);
    expect(json.sameAs.length).toBeGreaterThanOrEqual(2);
  });

  it('marks the Bengali run with lang="bn"', () => {
    // Bengali graphemes for "অভিনন্দন পাল" (Abhinandan Pal). We do not
    // hard-code the Unicode codepoints in the assertion message because
    // some terminals render them poorly; the regex below carries them.
    expect(html).toMatch(
      /<span\b[^>]*\blang=["']bn["'][^>]*>\s*অভিনন্দন\s+পাল\s*<\/span>/,
    );
  });

  it('robots.txt exists at the repository root', () => {
    const robotsPath = resolve(repoRoot, 'robots.txt');
    expect(existsSync(robotsPath), `expected ${robotsPath} to exist`).toBe(true);
    const robots = readFileSync(robotsPath, 'utf8');
    // Spot-check the canonical contents documented in .
    expect(robots).toMatch(/User-agent:\s*\*/i);
    expect(robots).toMatch(/Allow:\s*\//i);
    expect(robots).toMatch(/Sitemap:\s*https?:\/\//i);
  });

  it('sitemap.xml exists at the repository root', () => {
    const sitemapPath = resolve(repoRoot, 'sitemap.xml');
    expect(existsSync(sitemapPath), `expected ${sitemapPath} to exist`).toBe(true);
    const sitemap = readFileSync(sitemapPath, 'utf8');
    // Spot-check that the sitemap declares the deployed URL.
    expect(sitemap).toMatch(/<urlset\b/);
    expect(sitemap).toMatch(/<loc>\s*https:\/\/abhinandan-pal\.github\.io\/?\s*<\/loc>/);
  });
});
