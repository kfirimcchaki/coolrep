#!/usr/bin/env node
/**
 * Generates the PNG app icons the web manifest needs (192/512/maskable).
 *
 * Browsers only offer "install app" when a manifest declares raster icons at
 * 192px and 512px, so these are built here from the same idea as app/icon.svg:
 * a violet→blue gradient tile with a white "NT" mark. Everything is plain math
 * plus zlib, so the repository needs no image toolchain.
 *
 *   node scripts/make-icons.mjs
 */
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { deflateSync } from 'node:zlib';

const outDir = path.join(process.cwd(), 'spa/icons');

/* 5x7 pixel glyphs. */
const GLYPHS = {
  N: ['10001', '11001', '10101', '10011', '10001', '10001', '10001'],
  T: ['11111', '00100', '00100', '00100', '00100', '00100', '00100'],
};

const START = [0x7c, 0x5c, 0xff];
const END = [0x46, 0x66, 0xff];
const BG = [0x08, 0x09, 0x0d];

function sample(x, y, size, inset) {
  // Returns [r,g,b,a] for a pixel at (x,y), supersampled by the caller.
  const r = size * 0.24 * inset;
  const margin = (size * (1 - inset)) / 2;
  const left = margin;
  const right = size - margin;
  if (x < left || x > right || y < left || y > right) return null;

  const radius = r;
  const cx = Math.min(Math.max(x, left + radius), right - radius);
  const cy = Math.min(Math.max(y, left + radius), right - radius);
  const inside =
    (x >= left + radius && x <= right - radius) || (y >= left + radius && y <= right - radius)
      ? true
      : (x - cx) ** 2 + (y - cy) ** 2 <= radius ** 2;
  if (!inside) return null;

  const t = (x + y) / (2 * size);
  const rgb = [
    Math.round(START[0] + (END[0] - START[0]) * t),
    Math.round(START[1] + (END[1] - START[1]) * t),
    Math.round(START[2] + (END[2] - START[2]) * t),
  ];
  return [...rgb, 255];
}

function render(size, { inset = 1, transparent = true } = {}) {
  const pixels = Buffer.alloc(size * size * 4);
  const glyphScale = size * 0.055 * inset;
  const cells = 11; // N + gap + T
  const gridW = cells - 1;
  const glyphW = glyphScale * 11;
  const glyphH = glyphScale * 7;
  const originX = (size - glyphW) / 2 + 0;
  const originY = (size - glyphH) / 2;
  const gap = glyphScale * 0.55;

  const inGlyph = (x, y) => {
    if (x < originX || y < originY) return false;
    const col = Math.floor((x - originX) / glyphScale);
    const row = Math.floor((y - originY) / glyphScale);
    if (row < 0 || row > 6 || col < 0 || col > gridW) return false;
    const letters = ['N', 'T'];
    const nWidth = 5;
    const secondStart = nWidth + 1; // one cell gap
    let glyph = null;
    let localCol = col;
    if (col < nWidth) {
      glyph = letters[0];
    } else if (col >= secondStart && col < secondStart + 5) {
      glyph = letters[1];
      localCol = col - secondStart;
    } else {
      return false;
    }
    return GLYPHS[glyph][row][localCol] === '1';
  };

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      let hits = 0;
      const offsets = [
        [0.25, 0.25],
        [0.75, 0.25],
        [0.25, 0.75],
        [0.75, 0.75],
      ];
      for (const [ox, oy] of offsets) {
        const sx = x + ox;
        const sy = y + oy;
        const base = sample(sx, sy, size, inset);
        if (!base) continue;
        hits += 1;
        let [pr, pg, pb] = base;
        if (inGlyph(sx, sy)) [pr, pg, pb] = [255, 255, 255];
        r += pr;
        g += pg;
        b += pb;
      }
      const index = (y * size + x) * 4;
      if (hits === 0) {
        if (transparent) continue;
        pixels[index] = BG[0];
        pixels[index + 1] = BG[1];
        pixels[index + 2] = BG[2];
        pixels[index + 3] = 255;
        continue;
      }
      pixels[index] = Math.round(r / hits);
      pixels[index + 1] = Math.round(g / hits);
      pixels[index + 2] = Math.round(b / hits);
      pixels[index + 3] = 255;
    }
  }
  return pixels;
}

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buffer) {
  let crc = -1;
  for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ -1) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([length, body, crc]);
}

function png(size, pixels) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8; // bit depth
  header[9] = 6; // RGBA
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y += 1) {
    raw[y * (size * 4 + 1)] = 0; // filter: none
    pixels.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

await mkdir(outDir, { recursive: true });

const targets = [
  { file: 'icon-192.png', size: 192, options: {} },
  { file: 'icon-512.png', size: 512, options: {} },
  { file: 'icon-maskable-512.png', size: 512, options: { inset: 0.72, transparent: false } },
  { file: 'apple-touch-icon.png', size: 180, options: { inset: 1, transparent: false } },
];

for (const target of targets) {
  const buffer = png(target.size, render(target.size, target.options));
  await writeFile(path.join(outDir, target.file), buffer);
  console.log(`${target.file.padEnd(26)} ${target.size}×${target.size}  ${(buffer.length / 1024).toFixed(1)} KiB`);
}
console.log(`\nicons written to ${path.relative(process.cwd(), outDir)}/`);
