// Generates the PWA icons from the app mark: a map sheet with a route and a
// destination dot. Hand-rolled rasterizer + PNG encoder, so the repo carries no
// image tooling and the icons cannot drift from the SVG.
import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const outDir = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'public');

const BG = [250, 248, 243]; // #faf8f3
const INK = [27, 26, 23]; // #1b1a17
const ACCENT = [29, 78, 216]; // #1d4ed8

function crc32(buf) {
  let crc = ~0;
  for (const byte of buf) {
    crc ^= byte;
    for (let i = 0; i < 8; i += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return ~crc >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([length, typeBuf, data, crcBuf]);
}

function encodePng(size, pixels) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y += 1) {
    const rowStart = y * (size * 4 + 1);
    for (let x = 0; x < size; x += 1) {
      const src = (y * size + x) * 4;
      const dst = rowStart + 1 + x * 4;
      raw[dst] = pixels[src];
      raw[dst + 1] = pixels[src + 1];
      raw[dst + 2] = pixels[src + 2];
      raw[dst + 3] = pixels[src + 3];
    }
  }
  return Buffer.concat([
    signature,
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function sdRoundRect(px, py, cx, cy, hw, hh, r) {
  const qx = Math.abs(px - cx) - (hw - r);
  const qy = Math.abs(py - cy) - (hh - r);
  const ax = Math.max(qx, 0);
  const ay = Math.max(qy, 0);
  return Math.hypot(ax, ay) + Math.min(Math.max(qx, qy), 0) - r;
}

function distanceToSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

const ROUTE = [
  [0.28125, 0.65625],
  [0.421875, 0.5],
  [0.53125, 0.59375],
  [0.703125, 0.375],
];
const DOT = [0.703125, 0.375];
const STROKE = 0.03125;

function sample(x, y) {
  const sheet = sdRoundRect(x, y, 0.5, 0.5, 0.3125, 0.28125, 0.0625);
  if (Math.abs(sheet) <= STROKE) return INK;

  if (Math.hypot(x - DOT[0], y - DOT[1]) <= 0.0625) return ACCENT;

  for (let i = 0; i < ROUTE.length - 1; i += 1) {
    const [ax, ay] = ROUTE[i];
    const [bx, by] = ROUTE[i + 1];
    if (distanceToSegment(x, y, ax, ay, bx, by) <= STROKE) return ACCENT;
  }

  return BG;
}

function render(size) {
  const pixels = Buffer.alloc(size * size * 4);
  const ss = 4;
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const acc = [0, 0, 0];
      for (let sy = 0; sy < ss; sy += 1) {
        for (let sx = 0; sx < ss; sx += 1) {
          const c = sample((x + (sx + 0.5) / ss) / size, (y + (sy + 0.5) / ss) / size);
          acc[0] += c[0];
          acc[1] += c[1];
          acc[2] += c[2];
        }
      }
      const n = ss * ss;
      const i = (y * size + x) * 4;
      pixels[i] = Math.round(acc[0] / n);
      pixels[i + 1] = Math.round(acc[1] / n);
      pixels[i + 2] = Math.round(acc[2] / n);
      pixels[i + 3] = 255;
    }
  }
  return pixels;
}

for (const size of [192, 512]) {
  writeFileSync(resolve(outDir, `icon-${size}.png`), encodePng(size, render(size)));
  console.log('wrote', `icon-${size}.png`);
}
