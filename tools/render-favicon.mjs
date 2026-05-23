#!/usr/bin/env node
// tools/render-favicon.mjs
//
// Build-time renderer for the motif favicon assets and the static
// footer mark.
//
// Three output files
//   * `assets/favicon.svg`vector favicon, 64×64 viewBox.
//   * `assets/favicon.png`64×64 RGB raster fallback.
//   * `assets/footer-mark.svg`small standalone mark for the footer
//; uses design system tokens via
//                                  `var(--color-line)` / `var(--color-accent-2)`
//                                  with hex fallbacks so it picks up
//                                  dark-scope overrides when inlined into the
//                                  document.
//
// Why two separate SVGs (favicon + footer mark)?
//   Favicons are loaded by the user agent *outside* the document context, so
//   `var(--color-line)` cannot resolve — there is no `:root` to inherit from.
//   The favicon therefore hard-codes the warm-cream / hairline / copper hex
//   triple from the light scope of `styles/tokens.css`. The footer mark, by
//   contrast, will be inlined into `index.html` and so MUST use
//   `var(...)` references in order to follow `prefers-color-scheme: dark`.
//
// Why PNG via raw zlib (no `node-canvas` / `sharp`)?
//   The dev-dependency budget for this site does not include a canvas package,
//   and the deployment target (GitHub Pages, static) cannot run native
//   bindings. The site already follows this pattern in
//   `tools/make-og-placeholder.mjs`, which produces a valid baseline JPEG with
//   no third-party encoder. Here we mirror the same approach for PNG: build a
//   raw RGB pixel buffer in JS, deflate it with `node:zlib`, and assemble the
//   four required PNG chunks (IHDR, IDAT, IEND, plus the 8-byte signature).
//   The result is a valid PNG that any browser, axe-core, and the Lighthouse
//   crawler can decode. PNG fidelity is acceptable for a 64-pixel branding
//   mark; the SVG is the primary rendition.
//
// Determinism
//   The motif algorithm is replayed verbatim from `scripts/motif.js init` /
//   `buildEdges`, with a fixed seed (`0xCAFEFACE`) and a low density chosen
//   to read cleanly at 64 px. Re-running this script always produces
//   byte-identical SVG and PNG outputs.
//

import { writeFile, mkdir } from 'node:fs/promises';
import { resolve, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';

import {
  mulberry32,
  poissonDisk,
  kNearest,
  lerp,
  clamp,
} from '../scripts/motif/rng.js';

// ── Constants ──────────────────────────────────────────────────────────────

/**
 * Fixed seed for the favicon and footer mark. Distinct from the SVG-fallback
 * seed (`0xC0DEFACE`) so the two static appearances do not look like the same
 * graph at different sizes —  asks for two visible appearances; making
 * them visibly distinct reinforces the recurring-mark reading.
 */
const FIXED_SEED = 0xcafeface >>> 0;

/**
 * Density tuned for legibility at 64 CSS pixels. With density = 0.1 the node
 * count is `round(30 + 9) = 39` and the edge count lands in the ~50–80 band
 * after the nearest-neighbour stitch — both safely inside the  floor
 * and ceiling. Higher densities pack into mush at this resolution.
 */
const DENSITY = 0.1;

/** Favicon canvas size — 64 CSS pixels per the task and design contract. */
const FAVICON_SIZE = 64;

/**
 * Footer mark viewBox. The footer.css rule sizes `.ap-mark` at 28×28 CSS
 * pixels; we author the SVG with a 64-unit viewBox so the same coordinate
 * formulas can be shared between the favicon and the mark, and the user
 * agent's `preserveAspectRatio` default scales it cleanly to whatever the
 * footer styles request.
 */
const FOOTER_SIZE = 64;

/**
 * Light-scope token values literal-baked into the favicon SVG and the PNG.
 * These mirror `styles/tokens.css` exactly; if either file changes, update
 * both. Tokens.css is the source of truth.
 */
const COLOR_BG_LIGHT = '#f7f4ef';     // --color-bg
const COLOR_LINE_LIGHT = '#c9bfb1';   // --color-line
const COLOR_ACCENT_2_LIGHT = '#c98c5a'; // --color-accent-2

// ── Algorithm — mirrors `scripts/motif.js init` + `buildEdges` ─────────

/**
 * Build the deterministic motif graph for `(seed, density)`.
 *
 * This is the same routine used by `tools/render-svg-motif.mjs`; both build
 * scripts and the runtime canvas (`scripts/motif.js`) consume the same pure
 * helpers so the three renditions of the motif are guaranteed to agree
 * topologically (same node positions, same edges) for a given seed.
 *
 * @param {number} seed - 32-bit unsigned integer.
 * @param {number} density - Continuous density in [0, 1].
 * @returns {{
 *   nodes: Array<{x: number, y: number}>,
 *   edges: Array<{a: {x:number,y:number}, b: {x:number,y:number}}>,
 * }}
 */
function buildMotifGraph(seed, density) {
  const rng = mulberry32(seed);
  const n = clamp(Math.round(30 + density * 90), 30, 120);
  const k = density < 0.5 ? 2 : density < 0.85 ? 3 : 4;

  const pts = poissonDisk(n, 0.85 / Math.sqrt(n), rng);
  while (pts.length < 30) pts.push({ x: rng(), y: rng() });

  const nodes = pts.map((p) => ({ x: p.x, y: p.y }));

  const N = nodes.length;
  const seen = new Set();
  const edges = [];
  const indexOf = new Map();
  for (let i = 0; i < N; i++) indexOf.set(nodes[i], i);

  const addNeighbours = (kk) => {
    for (let i = 0; i < N; i++) {
      const ni = nodes[i];
      const neighbours = kNearest(nodes, ni, kk);
      for (let p = 0; p < neighbours.length; p++) {
        const m = neighbours[p];
        const j = indexOf.get(m);
        const a = i < j ? i : j;
        const b = i < j ? j : i;
        const key = a * N + b;
        if (seen.has(key)) continue;
        seen.add(key);
        edges.push({ a: nodes[a], b: nodes[b] });
      }
    }
  };

  addNeighbours(k);

  // Widen k until the 40-edge floor is crossed or neighbours exhaust.
  let kk = k + 1;
  while (edges.length < 40 && kk <= N - 1) {
    addNeighbours(kk);
    kk++;
  }

  // Drop uniformly-random surplus down to the 240-edge cap.
  while (edges.length > 240) {
    const idx = Math.floor(rng() * edges.length);
    edges.splice(idx, 1);
  }

  return { nodes, edges };
}

/** Largest edge length, used to scale signal-strength stroke width. */
function computeMaxDist(edges) {
  let m = 0;
  for (let i = 0; i < edges.length; i++) {
    const e = edges[i];
    const dx = e.a.x - e.b.x;
    const dy = e.a.y - e.b.y;
    const d = Math.hypot(dx, dy);
    if (d > m) m = d;
  }
  return m || 1;
}

// ── SVG emission ───────────────────────────────────────────────────────────

const fx = (u, scale) => (u * scale).toFixed(2);
const fw = (w) => Number(w.toFixed(2)).toString();

/**
 * Build the favicon SVG: a complete, self-contained SVG document with literal
 * hex paint values from the light scope. A solid background rect fills the
 * viewBox so the mark reads against any browser tab colour; in dark UAs the
 * cream square reads as a small "page" tile, which is a deliberate stylistic
 * choice consistent with the editorial identity.
 *
 * @param {ReturnType<typeof buildMotifGraph>} graph
 * @returns {string} An SVG document string.
 */
function buildFaviconSvg(graph) {
  const { nodes, edges } = graph;
  const maxDist = computeMaxDist(edges);
  const S = FAVICON_SIZE;

  const lines = edges
    .map((e) => {
      const dx = e.a.x - e.b.x;
      const dy = e.a.y - e.b.y;
      const d = Math.hypot(dx, dy);
      // Slightly thicker than the hero canvas at this scale so 1-pixel
      // hairlines do not vanish under nearest-neighbour scaling in browser
      // tab strips. Range chosen so the thinnest stroke is still ≥ 0.6 px
      // at 64×64 (the favicon's intrinsic size).
      const sw = lerp(1.1, 0.6, d / maxDist);
      return (
        `  <line x1="${fx(e.a.x, S)}" y1="${fx(e.a.y, S)}"` +
        ` x2="${fx(e.b.x, S)}" y2="${fx(e.b.y, S)}"` +
        ` stroke="${COLOR_LINE_LIGHT}" stroke-width="${fw(sw)}"` +
        ` stroke-linecap="round" />`
      );
    })
    .join('\n');

  const circles = nodes
    .map(
      (n) =>
        `  <circle cx="${fx(n.x, S)}" cy="${fx(n.y, S)}"` +
        ` r="1.4" fill="${COLOR_ACCENT_2_LIGHT}" />`,
    )
    .join('\n');

  // viewBox uses square coordinates so the favicon's intrinsic 1:1 ratio is
  // preserved. `shape-rendering="geometricPrecision"` keeps the strokes from
  // being snapped to a coarse pixel grid by some user agents.
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${S} ${S}"` +
      ' shape-rendering="geometricPrecision">',
    `  <rect width="${S}" height="${S}" fill="${COLOR_BG_LIGHT}" />`,
    lines,
    circles,
    '</svg>',
    '',
  ].join('\n');
}

/**
 * Build the footer mark SVG.
 *
 * Differences from the favicon:
 *   * No background `<rect>`the footer mark sits on top of the page
 *     background and should be transparent so the warm-cream / dark-ink page
 *     colour shows through.
 *   * Strokes / fills use `var(--color-line)` and `var(--color-accent-2)` so
 *     the mark adapts to dark-mode token overrides when inlined into the
 *     document. Hex literals from the light scope are kept as documented
 *     fallbacks in case the SVG is ever loaded in a context where
 *     the tokens do not resolve.
 *   * `aria-hidden` is omitted from the SVG itself; the `.ap-mark` element in
 *     the footer markup carries the accessibility attributes.
 *
 * @param {ReturnType<typeof buildMotifGraph>} graph
 * @returns {string} An SVG document string.
 */
function buildFooterMarkSvg(graph) {
  const { nodes, edges } = graph;
  const maxDist = computeMaxDist(edges);
  const S = FOOTER_SIZE;

  const lines = edges
    .map((e) => {
      const dx = e.a.x - e.b.x;
      const dy = e.a.y - e.b.y;
      const d = Math.hypot(dx, dy);
      const sw = lerp(1.1, 0.6, d / maxDist);
      return (
        `  <line x1="${fx(e.a.x, S)}" y1="${fx(e.a.y, S)}"` +
        ` x2="${fx(e.b.x, S)}" y2="${fx(e.b.y, S)}"` +
        ` stroke-width="${fw(sw)}" stroke-linecap="round"` +
        ` style="stroke: var(--color-line, ${COLOR_LINE_LIGHT})" />`
      );
    })
    .join('\n');

  const circles = nodes
    .map(
      (n) =>
        `  <circle cx="${fx(n.x, S)}" cy="${fx(n.y, S)}" r="1.4"` +
        ` style="fill: var(--color-accent-2, ${COLOR_ACCENT_2_LIGHT})" />`,
    )
    .join('\n');

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${S} ${S}"` +
      ' shape-rendering="geometricPrecision">',
    lines,
    circles,
    '</svg>',
    '',
  ].join('\n');
}

// ── PNG rasterizer ─────────────────────────────────────────────────────────
//
// We rasterize the motif into an RGB pixel buffer and assemble a baseline,
// truecolour (color type 2) PNG by hand. No third-party encoder is involved
// and no native bindings are required.
//
// Pipeline
//   1. Allocate a `width * height * 3` byte buffer (RGB, 8 bits per channel).
//   2. Fill with the background colour.
//   3. Stroke each edge using a Wu-style anti-aliased line with width
//      proportional to the runtime canvas's signal-strength formula. We
//      rasterize as a thick line by walking adjacent pixels along the
//      perpendicular axis.
//   4. Fill each node as a 1.4-radius disc.
//   5. Pre-pend each scanline with PNG filter byte 0 (None).
//   6. Deflate the resulting bytes with `zlib.deflateSync`.
//   7. Emit signature + IHDR + IDAT + IEND, each chunk including a CRC-32.
//
// The PNG spec (RFC 2083 / W3C PNG 2nd Ed.) is the reference. Color type 2,
// bit depth 8, no interlace, default Adam7 disabled — these are the simplest
// settings that every browser is required to decode.

/**
 * Standard PNG CRC-32 (polynomial 0xEDB88320, reversed). The constants in
 * this implementation match the reference C code in the PNG spec, Annex 15.
 */
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

/** CRC-32 over the bytes of `buf`, using the lookup table above. */
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

/** Assemble one PNG chunk: length + 4-byte type + payload + CRC of (type+payload). */
function pngChunk(type, payload) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(payload.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crcInput = Buffer.concat([typeBuf, payload]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(crcInput), 0);
  return Buffer.concat([length, typeBuf, payload, crc]);
}

/** Parse a `#rrggbb` hex literal into a `[r, g, b]` triple. */
function hexToRgb(hex) {
  const h = hex.replace(/^#/, '');
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
  ];
}

/**
 * Mutable RGB framebuffer wrapper with a tiny set of drawing primitives.
 * Coordinates are doubles in pixel space; pixels are clamped to the buffer
 * bounds before write so off-canvas geometry is silently dropped.
 */
class RgbFrame {
  constructor(width, height, [r, g, b]) {
    this.width = width;
    this.height = height;
    // Pre-fill with the background colour — one allocation, one fill loop.
    this.buf = Buffer.alloc(width * height * 3);
    for (let i = 0; i < this.buf.length; i += 3) {
      this.buf[i] = r;
      this.buf[i + 1] = g;
      this.buf[i + 2] = b;
    }
  }

  /**
   * Blend `[r, g, b]` over the existing pixel at `(x, y)` with `alpha` ∈ [0, 1].
   * Out-of-range coordinates are no-ops.
   */
  blend(x, y, r, g, b, alpha) {
    const xi = x | 0;
    const yi = y | 0;
    if (xi < 0 || xi >= this.width || yi < 0 || yi >= this.height) return;
    if (alpha <= 0) return;
    const a = alpha > 1 ? 1 : alpha;
    const idx = (yi * this.width + xi) * 3;
    const inv = 1 - a;
    this.buf[idx] = Math.round(this.buf[idx] * inv + r * a);
    this.buf[idx + 1] = Math.round(this.buf[idx + 1] * inv + g * a);
    this.buf[idx + 2] = Math.round(this.buf[idx + 2] * inv + b * a);
  }

  /**
   * Stroke a thick anti-aliased line from `(x0, y0)` to `(x1, y1)` with the
   * given RGB colour and pixel `width`.
   *
   * Algorithm: sample along the line at 1-pixel parametric steps; at each
   * sample, blend a small disc whose radius equals `width / 2`. Coverage at a
   * pixel is `clamp(radius - distance_to_centre + 0.5, 0, 1)`, giving a
   * Wu-like AA edge without the algorithmic complexity of true Wu lines.
   * This is sufficient for the favicon's branding-mark fidelity bar.
   */
  strokeLine(x0, y0, x1, y1, [r, g, b], width) {
    const dx = x1 - x0;
    const dy = y1 - y0;
    const len = Math.hypot(dx, dy);
    if (len < 1e-6) {
      this.fillDisc(x0, y0, width / 2, [r, g, b]);
      return;
    }
    const steps = Math.max(1, Math.ceil(len * 2));
    const radius = Math.max(0.5, width / 2);
    const r2 = Math.ceil(radius + 1);
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      const cx = x0 + dx * t;
      const cy = y0 + dy * t;
      const ix = Math.floor(cx);
      const iy = Math.floor(cy);
      for (let py = iy - r2; py <= iy + r2; py++) {
        for (let px = ix - r2; px <= ix + r2; px++) {
          const ddx = px + 0.5 - cx;
          const ddy = py + 0.5 - cy;
          const dist = Math.hypot(ddx, ddy);
          const cov = radius - dist + 0.5;
          if (cov > 0) this.blend(px, py, r, g, b, cov > 1 ? 1 : cov);
        }
      }
    }
  }

  /**
   * Fill an anti-aliased disc centred at `(cx, cy)` with the given `radius`
   * and RGB colour. Coverage uses the same `radius - distance + 0.5` formula
   * as `strokeLine`.
   */
  fillDisc(cx, cy, radius, [r, g, b]) {
    const r2 = Math.ceil(radius + 1);
    const ix = Math.floor(cx);
    const iy = Math.floor(cy);
    for (let py = iy - r2; py <= iy + r2; py++) {
      for (let px = ix - r2; px <= ix + r2; px++) {
        const ddx = px + 0.5 - cx;
        const ddy = py + 0.5 - cy;
        const dist = Math.hypot(ddx, ddy);
        const cov = radius - dist + 0.5;
        if (cov > 0) this.blend(px, py, r, g, b, cov > 1 ? 1 : cov);
      }
    }
  }

  /**
   * Encode the framebuffer as a complete PNG byte stream.
   *
   * Layout:
   *   signature (8B) | IHDR (13B payload) | IDAT (zlib-compressed scanlines) | IEND
   *
   * Each scanline is prefixed with PNG filter byte 0 (None). We use
   * `deflateSync` at the default compression level — the resulting IDAT
   * stream is well under 4 KB for a 64×64 RGB image.
   */
  toPng() {
    const W = this.width;
    const H = this.height;
    const stride = 1 + W * 3; // 1 filter byte + RGB triples
    const raw = Buffer.alloc(stride * H);
    for (let y = 0; y < H; y++) {
      const dstRow = y * stride;
      raw[dstRow] = 0; // filter type: None
      raw.set(this.buf.subarray(y * W * 3, (y + 1) * W * 3), dstRow + 1);
    }
    const compressed = deflateSync(raw);

    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(W, 0);
    ihdr.writeUInt32BE(H, 4);
    ihdr[8] = 8;  // bit depth: 8 bits per channel
    ihdr[9] = 2;  // colour type: 2 (truecolour RGB)
    ihdr[10] = 0; // compression: deflate
    ihdr[11] = 0; // filter: adaptive (per-scanline filter byte)
    ihdr[12] = 0; // interlace: none

    const signature = Buffer.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    ]);

    return Buffer.concat([
      signature,
      pngChunk('IHDR', ihdr),
      pngChunk('IDAT', compressed),
      pngChunk('IEND', Buffer.alloc(0)),
    ]);
  }
}

/**
 * Build the 64×64 favicon PNG by rasterizing the same motif graph used for
 * the SVG. Stroke and fill colours come from the light-scope tokens.
 *
 * @param {ReturnType<typeof buildMotifGraph>} graph
 * @returns {Buffer} A complete PNG byte stream.
 */
function buildFaviconPng(graph) {
  const { nodes, edges } = graph;
  const maxDist = computeMaxDist(edges);
  const S = FAVICON_SIZE;

  const bg = hexToRgb(COLOR_BG_LIGHT);
  const line = hexToRgb(COLOR_LINE_LIGHT);
  const accent = hexToRgb(COLOR_ACCENT_2_LIGHT);

  const frame = new RgbFrame(S, S, bg);

  for (const e of edges) {
    const dx = e.a.x - e.b.x;
    const dy = e.a.y - e.b.y;
    const d = Math.hypot(dx, dy);
    const sw = lerp(1.1, 0.6, d / maxDist);
    frame.strokeLine(e.a.x * S, e.a.y * S, e.b.x * S, e.b.y * S, line, sw);
  }
  for (const n of nodes) {
    frame.fillDisc(n.x * S, n.y * S, 1.4, accent);
  }

  return frame.toPng();
}

// ── Entry point ────────────────────────────────────────────────────────────

async function main() {
  const here = dirname(fileURLToPath(import.meta.url));
  const repoRoot = resolve(here, '..');
  const assetsDir = resolve(repoRoot, 'assets');
  await mkdir(assetsDir, { recursive: true });

  const graph = buildMotifGraph(FIXED_SEED, DENSITY);

  // Sanity-check  bounds. The same checks in render-svg-motif protect
  // the hero fallback; we repeat them here so the favicon also fails fast if
  // a future change to the algorithm or seed pushes the graph out of envelope.
  if (graph.nodes.length < 30 || graph.nodes.length > 120) {
    throw new Error(
      `Node count out of bounds: ${graph.nodes.length} ∉ [30, 120].`,
    );
  }
  if (graph.edges.length < 40 || graph.edges.length > 240) {
    throw new Error(
      `Edge count out of bounds: ${graph.edges.length} ∉ [40, 240].`,
    );
  }

  const svg = buildFaviconSvg(graph);
  const png = buildFaviconPng(graph);
  const footerSvg = buildFooterMarkSvg(graph);

  const svgPath = resolve(assetsDir, 'favicon.svg');
  const pngPath = resolve(assetsDir, 'favicon.png');
  const footerPath = resolve(assetsDir, 'footer-mark.svg');

  await writeFile(svgPath, svg, 'utf8');
  await writeFile(pngPath, png);
  await writeFile(footerPath, footerSvg, 'utf8');

  console.log(
    `Rendered favicon (seed=0x${FIXED_SEED.toString(16)}, density=${DENSITY}): ` +
      `${graph.nodes.length} nodes, ${graph.edges.length} edges`,
  );
  console.log(`  → ${relative(repoRoot, svgPath)} (${svg.length} bytes)`);
  console.log(`  → ${relative(repoRoot, pngPath)} (${png.length} bytes)`);
  console.log(
    `  → ${relative(repoRoot, footerPath)} (${footerSvg.length} bytes)`,
  );
}

main().catch((err) => {
  console.error('✗ render-favicon crashed:', err);
  process.exit(1);
});
