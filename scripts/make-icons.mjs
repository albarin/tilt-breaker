#!/usr/bin/env node
/**
 * Generates the extension icons: a white pawn on chess.com green.
 *
 * No dependencies. Rasterises by hand with 4x supersampling and writes the PNG with
 * `zlib`, which ships with Node, so the icons can be regenerated on any machine without
 * installing an SVG converter.
 *
 *   node scripts/make-icons.mjs
 */

import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'icon');
const SIZES = [16, 32, 48, 96, 128];
const SS = 4; // supersampling per axis: 16 samples per pixel

const GREEN = [0x81, 0xb6, 0x4c];
const WHITE = [0xff, 0xff, 0xff];

// -- Geometry, all in normalised 0..1 coordinates ------------------------------------

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

function inRoundedRect(px, py, x, y, w, h, r) {
  if (px < x || px > x + w || py < y || py > y + h) return false;
  const cx = clamp(px, x + r, x + w - r);
  const cy = clamp(py, y + r, y + h - r);
  return (px - cx) ** 2 + (py - cy) ** 2 <= r * r;
}

const inCircle = (px, py, cx, cy, r) => (px - cx) ** 2 + (py - cy) ** 2 <= r * r;

function inPolygon(px, py, pts) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i];
    const [xj, yj] = pts[j];
    if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** The background: a full-bleed rounded square. */
const inBackground = (x, y) => inRoundedRect(x, y, 0, 0, 1, 1, 0.22);

/** The pawn: head, collar, tapering body and base. */
function inPawn(x, y) {
  return (
    inCircle(x, y, 0.5, 0.3, 0.135) ||
    inRoundedRect(x, y, 0.355, 0.44, 0.29, 0.075, 0.037) ||
    inPolygon(x, y, [
      [0.415, 0.515],
      [0.585, 0.515],
      [0.645, 0.735],
      [0.355, 0.735],
    ]) ||
    inRoundedRect(x, y, 0.28, 0.735, 0.44, 0.11, 0.05)
  );
}

// -- Rasterising ---------------------------------------------------------------------

/** Returns non-premultiplied RGBA, with alpha averaged from the supersampling. */
function render(size) {
  const rgba = Buffer.alloc(size * size * 4);
  const samples = SS * SS;

  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let background = 0;
      let pawn = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const x = (px + (sx + 0.5) / SS) / size;
          const y = (py + (sy + 0.5) / SS) / size;
          if (!inBackground(x, y)) continue;
          background++;
          if (inPawn(x, y)) pawn++;
        }
      }

      const i = (py * size + px) * 4;
      if (background === 0) continue; // outside the icon: transparent

      // Blend white over green by how much of this pixel the pawn covers.
      const t = pawn / background;
      for (let ch = 0; ch < 3; ch++) {
        rgba[i + ch] = Math.round(GREEN[ch] * (1 - t) + WHITE[ch] * t);
      }
      rgba[i + 3] = Math.round((background / samples) * 255);
    }
  }
  return rgba;
}

// -- PNG encoding --------------------------------------------------------------------

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buf) {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function encodePng(rgba, size) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // 8 bits per channel
  ihdr[9] = 6; // RGBA
  // 10..12 stay zero: deflate, no adaptive filter, no interlacing.

  // Each row is prefixed with its filter byte; we use 0 (none).
  const stride = size * 4;
  const raw = Buffer.alloc((stride + 1) * size);
  for (let y = 0; y < size; y++) {
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// -- Run -------------------------------------------------------------------------------

mkdirSync(OUT_DIR, { recursive: true });
for (const size of SIZES) {
  const png = encodePng(render(size), size);
  writeFileSync(join(OUT_DIR, `${size}.png`), png);
  console.log(`icon/${size}.png  ${png.length} B`);
}
