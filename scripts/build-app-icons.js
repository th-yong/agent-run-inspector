#!/usr/bin/env node
// Draws the app icons (web/icon-192.png, web/icon-512.png; web/icon-32.png for the tab, without padding;
// src/macos/AppIcon.icns for the macOS app): the brand mark's blue-to-teal tile
// (web/app.css .brand i) with a white agent graph (one lead, two workers). No dependencies:
// shapes are distance functions, 4x4 supersampled, written as PNG with node:zlib.
// Run: node scripts/build-app-icons.js
import { writeFileSync } from 'node:fs';
import { deflateSync, crc32 } from 'node:zlib';

const FROM = [0x4c, 0x6e, 0xf5]; // --llm
const TO = [0x0c, 0x85, 0x99]; // --tool

const seg = (px, py, ax, ay, bx, by) => {
  const dx = bx - ax; const dy = by - ay;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(px - ax - t * dx, py - ay - t * dy);
};
const roundRect = (x, y, half, r) => {
  const qx = Math.abs(x - 0.5) - half + r; const qy = Math.abs(y - 0.5) - half + r;
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
};
const LEAD = [0.5, 0.31]; const W1 = [0.31, 0.69]; const W2 = [0.69, 0.69];

/** [r, g, b, a] at unit coordinates. */
function sample(px, py, K) {
  // K: share of the canvas the tile fills; 0.82 pads it like macOS app icons for the Dock
  const x = (px - 0.5) / K + 0.5; const y = (py - 0.5) / K + 0.5;
  if (roundRect(x, y, 0.5, 0.225) > 0) return [0, 0, 0, 0];
  const glyph = Math.min(
    Math.hypot(x - LEAD[0], y - LEAD[1]) - 0.095,
    Math.hypot(x - W1[0], y - W1[1]) - 0.085,
    Math.hypot(x - W2[0], y - W2[1]) - 0.085,
    seg(x, y, ...LEAD, ...W1) - 0.032,
    seg(x, y, ...LEAD, ...W2) - 0.032,
  );
  if (glyph <= 0) return [255, 255, 255, 255];
  const t = (x + y) / 2; // 135deg gradient
  return [...FROM.map((c, i) => Math.round(c + (TO[i] - c) * t)), 255];
}

function png(size, K) {
  const N = 4;
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let py = 0; py < size; py++) {
    raw[py * (size * 4 + 1)] = 0; // filter: none
    for (let px = 0; px < size; px++) {
      const acc = [0, 0, 0, 0];
      for (let sy = 0; sy < N; sy++) {
        for (let sx = 0; sx < N; sx++) {
          const [r, g, b, a] = sample((px + (sx + 0.5) / N) / size, (py + (sy + 0.5) / N) / size, K);
          acc[0] += r * a; acc[1] += g * a; acc[2] += b * a; acc[3] += a;
        }
      }
      const o = py * (size * 4 + 1) + 1 + px * 4;
      const a = acc[3];
      raw[o] = a ? Math.round(acc[0] / a) : 0;
      raw[o + 1] = a ? Math.round(acc[1] / a) : 0;
      raw[o + 2] = a ? Math.round(acc[2] / a) : 0;
      raw[o + 3] = Math.round(a / (N * N));
    }
  }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body));
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; // 8-bit RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0)),
  ]);
}

// macOS app icon (src/macos/AppIcon.icns): an ICNS container of PNGs, one per slot.
const ICNS = [['icp4', 16], ['icp5', 32], ['ic11', 32], ['ic12', 64], ['ic07', 128], ['ic13', 256], ['ic08', 256], ['ic14', 512], ['ic09', 512], ['ic10', 1024]];
const pngs = new Map();
const entries = ICNS.map(([type, size]) => {
  if (!pngs.has(size)) pngs.set(size, png(size, 0.82));
  const head = Buffer.alloc(8); head.write(type, 0, 'latin1'); head.writeUInt32BE(8 + pngs.get(size).length, 4);
  return Buffer.concat([head, pngs.get(size)]);
});
const icnsHead = Buffer.alloc(8); icnsHead.write('icns', 0, 'latin1');
icnsHead.writeUInt32BE(8 + entries.reduce((n, e) => n + e.length, 0), 4);
writeFileSync(new URL('../src/macos/AppIcon.icns', import.meta.url), Buffer.concat([icnsHead, ...entries]));
console.log('wrote src/macos/AppIcon.icns');

for (const [size, K] of [[32, 1], [192, 0.82], [512, 0.82]]) {
  const file = new URL(`../web/icon-${size}.png`, import.meta.url);
  writeFileSync(file, png(size, K));
  console.log(`wrote web/icon-${size}.png`);
}
