// tests/unit/og-image.spec.js
//
//
// The Open Graph image referenced from `<head>` must exist
// at `assets/og-image.jpg` and must be at least 1200 × 630 pixels in JPEG
// format. Until `tools/render-og.mjs` (planned for task 8.5 / 7.x) generates
// the real artwork, `tools/make-og-placeholder.mjs` writes a minimal valid
// baseline JPEG with those dimensions. This spec parses the JPEG byte stream
// directly so it does not depend on any image-decoding library — it walks
// JPEG segment markers and reads the SOF (Start Of Frame, 0xFFC0–0xFFC3)
// payload to recover height and width.

import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..', '..');
const ogImagePath = resolve(repoRoot, 'assets', 'og-image.jpg');

/**
 * Walk a JPEG byte stream and return the dimensions reported in the first
 * SOF (Start Of Frame) marker we encounter. Supports baseline (SOF0),
 * extended sequential (SOF1), progressive (SOF2), and lossless (SOF3) —
 * which together cover every common JPEG variant likely to appear here.
 *
 * Throws if the file is not a valid JPEG (no SOI marker) or if no SOF
 * marker is found before EOI.
 *
 * Reference: ITU-T T.81 / ISO 10918-1, Annex B.1 ("Marker assignments") and
 * Annex B.2.2 ("Frame header syntax").
 *
 * @param {Buffer} bytes
 * @returns {{ width: number, height: number, marker: number }}
 */
function readJpegSofDimensions(bytes) {
  // SOI: every JPEG starts with 0xFFD8.
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) {
    throw new Error('Not a JPEG: missing SOI (0xFFD8) marker.');
  }

  let i = 2;
  while (i < bytes.length) {
    // Each marker starts with one or more 0xFF fill bytes.
    if (bytes[i] !== 0xff) {
      throw new Error(
        `Malformed JPEG at offset ${i}: expected 0xFF marker prefix, got 0x${bytes[i].toString(16)}.`,
      );
    }
    // Skip any consecutive 0xFF fill bytes.
    while (i < bytes.length && bytes[i] === 0xff) i += 1;
    if (i >= bytes.length) break;

    const marker = bytes[i];
    i += 1;

    // 0xD0–0xD9 (RSTn, SOI, EOI) carry no payload.
    if (marker === 0xd9 /* EOI */) break;
    if (marker === 0x00) continue; // stuffed byte inside entropy stream
    if (marker >= 0xd0 && marker <= 0xd7) continue; // RST0–RST7

    // SOF markers: 0xC0..0xCF except 0xC4 (DHT), 0xC8 (JPG reserved),
    // 0xCC (DAC). Cover the common encoded forms we care about.
    if (
      marker === 0xc0 || // baseline DCT
      marker === 0xc1 || // extended sequential DCT
      marker === 0xc2 || // progressive DCT
      marker === 0xc3 // lossless
    ) {
      // Frame header: [length(2)] [P(1)] [Y(2)] [X(2)] ...
      // Length includes the length bytes themselves.
      if (i + 7 >= bytes.length) {
        throw new Error('Malformed JPEG: SOF segment truncated.');
      }
      const height = (bytes[i + 3] << 8) | bytes[i + 4];
      const width = (bytes[i + 5] << 8) | bytes[i + 6];
      return { width, height, marker };
    }

    // Standalone markers without payload length.
    if (marker === 0xd8 /* SOI */) continue;

    // All other markers carry a 2-byte big-endian length immediately after.
    if (i + 2 > bytes.length) {
      throw new Error('Malformed JPEG: marker length truncated.');
    }
    const segLen = (bytes[i] << 8) | bytes[i + 1];
    if (segLen < 2) {
      throw new Error(
        `Malformed JPEG at offset ${i}: segment length ${segLen} < 2.`,
      );
    }
    // SOS (0xDA) is followed by entropy-coded data; scanning the entire
    // entropy stream byte-by-byte isn't necessary for our purposes (we read
    // SOF before SOS). Just bail if we somehow reach SOS before any SOF.
    if (marker === 0xda) {
      throw new Error('Reached SOS before any SOF marker.');
    }
    i += segLen;
  }

  throw new Error('No SOF marker found before EOI.');
}

describe('Open Graph image (assets/og-image.jpg)', () => {
  it('exists on disk', () => {
    expect(existsSync(ogImagePath), `expected ${ogImagePath} to exist`).toBe(true);
    expect(statSync(ogImagePath).size).toBeGreaterThan(0);
  });

  it('reports SOF dimensions of at least 1200×630', () => {
    // "an asset of at least 1200 by 630 pixels in JPEG, PNG, or WebP
    // format").
    const bytes = readFileSync(ogImagePath);
    const { width, height, marker } = readJpegSofDimensions(bytes);

    // Sanity: the marker should be one of the supported SOF variants.
    expect([0xc0, 0xc1, 0xc2, 0xc3]).toContain(marker);

    expect(width, `og-image width = ${width}`).toBeGreaterThanOrEqual(1200);
    expect(height, `og-image height = ${height}`).toBeGreaterThanOrEqual(630);
  });
});
