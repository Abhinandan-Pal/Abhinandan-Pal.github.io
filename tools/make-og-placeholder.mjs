#!/usr/bin/env node
// tools/make-og-placeholder.mjs
//
// Generates a placeholder Open Graph image at `assets/og-image.jpg` so that
// social previews and the site's `<head>` Open Graph tags resolve to a real
// asset before the proper renderer (`tools/render-og.mjs`, planned for task
// 8.5 / 7.x) lands. The generated JPEG is intentionally minimal:
//
//   * 1200 × 630 (the exact OG canvas required by )
//   * Single-component baseline JPEG (grayscale)
//   * Uniform mid-grey content — every MCU encodes DC = 0 and immediately
//     emits End-Of-Block, so the entropy stream is just the bit pattern
//     "001010" repeated once per 8×8 macroblock.
//   * Standard Annex-K.3 luminance Huffman tables (DC + AC), one DQT.
//
// The point of this script is to produce a *valid* JPEG whose SOF0 marker
// reports width = 1200 and height = 630. Image fidelity is irrelevant; the
// real artwork ships from `tools/render-og.mjs` later.
//
// Usage:
//   node tools/make-og-placeholder.mjs            (writes assets/og-image.jpg)
//   node tools/make-og-placeholder.mjs <outpath>  (writes to <outpath>)
//

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const WIDTH = 1200;
const HEIGHT = 630;

// ── Standard Annex-K.3 luminance Huffman tables ────────────────────────────
// DC table 0
const DC0_BITS = Uint8Array.of(
  0x00, 0x01, 0x05, 0x01, 0x01, 0x01, 0x01, 0x01,
  0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
);
const DC0_HUFFVAL = Uint8Array.of(
  0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07,
  0x08, 0x09, 0x0A, 0x0B,
);

// AC table 0
const AC0_BITS = Uint8Array.of(
  0x00, 0x02, 0x01, 0x03, 0x03, 0x02, 0x04, 0x03,
  0x05, 0x05, 0x04, 0x04, 0x00, 0x00, 0x01, 0x7D,
);
const AC0_HUFFVAL = Uint8Array.of(
  0x01, 0x02, 0x03, 0x00, 0x04, 0x11, 0x05, 0x12,
  0x21, 0x31, 0x41, 0x06, 0x13, 0x51, 0x61, 0x07,
  0x22, 0x71, 0x14, 0x32, 0x81, 0x91, 0xA1, 0x08,
  0x23, 0x42, 0xB1, 0xC1, 0x15, 0x52, 0xD1, 0xF0,
  0x24, 0x33, 0x62, 0x72, 0x82, 0x09, 0x0A, 0x16,
  0x17, 0x18, 0x19, 0x1A, 0x25, 0x26, 0x27, 0x28,
  0x29, 0x2A, 0x34, 0x35, 0x36, 0x37, 0x38, 0x39,
  0x3A, 0x43, 0x44, 0x45, 0x46, 0x47, 0x48, 0x49,
  0x4A, 0x53, 0x54, 0x55, 0x56, 0x57, 0x58, 0x59,
  0x5A, 0x63, 0x64, 0x65, 0x66, 0x67, 0x68, 0x69,
  0x6A, 0x73, 0x74, 0x75, 0x76, 0x77, 0x78, 0x79,
  0x7A, 0x83, 0x84, 0x85, 0x86, 0x87, 0x88, 0x89,
  0x8A, 0x92, 0x93, 0x94, 0x95, 0x96, 0x97, 0x98,
  0x99, 0x9A, 0xA2, 0xA3, 0xA4, 0xA5, 0xA6, 0xA7,
  0xA8, 0xA9, 0xAA, 0xB2, 0xB3, 0xB4, 0xB5, 0xB6,
  0xB7, 0xB8, 0xB9, 0xBA, 0xC2, 0xC3, 0xC4, 0xC5,
  0xC6, 0xC7, 0xC8, 0xC9, 0xCA, 0xD2, 0xD3, 0xD4,
  0xD5, 0xD6, 0xD7, 0xD8, 0xD9, 0xDA, 0xE1, 0xE2,
  0xE3, 0xE4, 0xE5, 0xE6, 0xE7, 0xE8, 0xE9, 0xEA,
  0xF1, 0xF2, 0xF3, 0xF4, 0xF5, 0xF6, 0xF7, 0xF8,
  0xF9, 0xFA,
);

// Coarse luminance quantization table — values don't matter for our
// uniform-DC / EOB-only payload, but the segment must be present.
const QUANT_TABLE = new Uint8Array(64).fill(16);

/** Build a baseline grayscale JPEG of the requested dimensions. */
function buildJpeg(width, height) {
  const out = [];
  const push = (...bytes) => out.push(...bytes);
  const pushU16 = (v) => out.push((v >> 8) & 0xff, v & 0xff);

  // SOI
  push(0xff, 0xd8);

  // APP0 / JFIF
  push(0xff, 0xe0);
  pushU16(16);                   // segment length
  push(0x4a, 0x46, 0x49, 0x46, 0x00); // "JFIF\0"
  push(0x01, 0x01);              // version 1.01
  push(0x00);                    // units: none
  pushU16(1); pushU16(1);        // X/Y density = 1
  push(0x00, 0x00);              // no thumbnail

  // DQT (one luminance quant table, id 0, 8-bit precision)
  push(0xff, 0xdb);
  pushU16(2 + 1 + 64);
  push(0x00);                    // Pq=0, Tq=0
  for (const v of QUANT_TABLE) push(v);

  // SOF0 — baseline DCT, 1 component (Y), sampling 1×1, qtable 0
  push(0xff, 0xc0);
  pushU16(8 + 3 * 1);            // length = 11
  push(0x08);                    // sample precision
  pushU16(height);               // image height
  pushU16(width);                // image width
  push(0x01);                    // Nf
  push(0x01, 0x11, 0x00);        // component 1: id=1, H=1 V=1, qtable=0

  // DHT — DC table 0
  push(0xff, 0xc4);
  pushU16(2 + 1 + 16 + DC0_HUFFVAL.length);
  push(0x00);                    // Tc=0 (DC), Th=0
  for (const v of DC0_BITS) push(v);
  for (const v of DC0_HUFFVAL) push(v);

  // DHT — AC table 0
  push(0xff, 0xc4);
  pushU16(2 + 1 + 16 + AC0_HUFFVAL.length);
  push(0x10);                    // Tc=1 (AC), Th=0
  for (const v of AC0_BITS) push(v);
  for (const v of AC0_HUFFVAL) push(v);

  // SOS — 1 component (Y), DC table 0, AC table 0, full spectral selection
  push(0xff, 0xda);
  pushU16(6 + 2 * 1);            // length = 8
  push(0x01);                    // Ns
  push(0x01, 0x00);              // Cs1=1, Td=0 Ta=0
  push(0x00, 0x3f, 0x00);        // Ss=0, Se=63, Ah=0 Al=0

  // Entropy-coded scan: every 8×8 MCU emits DC-difference category 0 ("00",
  // 2 bits, from DC0) followed immediately by EOB ("1010", 4 bits, from AC0).
  // → 6 bits per MCU. For 1200×630 grayscale, MCUs = ceil(W/8) × ceil(H/8)
  //   = 150 × 79 = 11 850.
  // → Stream = bit pattern "001010" × 11 850 = 71 100 bits = 8 887.5 bytes,
  //   final byte padded with 1-bits per JPEG spec (Annex F.1.2.3).
  // Since "001010001010001010001010" packs cleanly into three bytes
  // (0x28 0xA2 0x8A) covering 4 MCUs, we batch in groups of 4 and handle
  // the tail (11 850 mod 4 = 2 MCUs, 12 bits) explicitly.
  // No 0xFF bytes appear in the pattern, so byte-stuffing is unnecessary.
  const mcusX = Math.ceil(width / 8);
  const mcusY = Math.ceil(height / 8);
  const totalMcus = mcusX * mcusY;
  const groups = Math.floor(totalMcus / 4);
  for (let i = 0; i < groups; i += 1) {
    push(0x28, 0xa2, 0x8a);
  }
  const tail = totalMcus - groups * 4;
  if (tail === 1) {
    // 6 bits "001010" + 2 pad bits "11" → "00101011" = 0x2B
    push(0x2b);
  } else if (tail === 2) {
    // 12 bits "001010 001010"
    //  → byte 1: "00101000" = 0x28
    //  → byte 2: "1010" + "1111" pad = "10101111" = 0xAF
    push(0x28, 0xaf);
  } else if (tail === 3) {
    // 18 bits "001010 001010 001010"
    //  → byte 1: "00101000" = 0x28
    //  → byte 2: "10100010" = 0xA2
    //  → byte 3: "10" + "111111" pad = "10111111" = 0xBF
    push(0x28, 0xa2, 0xbf);
  }

  // EOI
  push(0xff, 0xd9);

  return Buffer.from(out);
}

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..');
const outPath = process.argv[2]
  ? resolve(process.argv[2])
  : resolve(repoRoot, 'assets', 'og-image.jpg');

mkdirSync(dirname(outPath), { recursive: true });
const jpeg = buildJpeg(WIDTH, HEIGHT);
writeFileSync(outPath, jpeg);

console.log(`Wrote ${outPath} (${jpeg.length} bytes, ${WIDTH}×${HEIGHT})`);
