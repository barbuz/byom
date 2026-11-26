// Generates the app icon from the flag mark in src/lib/flagMark.js: the SVG
// files and the PNG rasterisations, so the checked-in icons cannot drift from
// the shape. Hand-rolled rasterizer + PNG encoder, so the repo carries no
// image tooling.
import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  MARK,
  MARK_ICON,
  MARK_PENNANT_PATH,
  MARK_POLE_PATH,
  MARK_POLE_WIDTH,
} from '../src/lib/flagMark.js';

const outDir = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'public');

const TILE = [29, 78, 216]; // #1d4ed8
const FLAG = [250, 248, 243]; // #faf8f3
const TILE_HEX = '#1d4ed8';
const FLAG_HEX = '#faf8f3';

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

function distanceToSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

function insidePole(x, y) {
  const { pole } = MARK;
  return distanceToSegment(x, y, pole.x, pole.end, pole.x, pole.base) <= pole.width / 2;
}

// The pennant's right edge is two mirrored curves meeting at the tip: the b's
// bowl above it, its mirror below. Each is monotonic in y, so the x at a given
// height is a quadratic root.
function pennantRightEdge(y) {
  const { pennant } = MARK;
  const upper = y <= pennant.tipY;
  const y0 = upper ? pennant.top : pennant.bottom;
  const controlY = upper
    ? pennant.top + (pennant.tipY - pennant.top) * pennant.control.y
    : pennant.bottom - (pennant.bottom - pennant.tipY) * pennant.control.y;
  const controlX = pennant.left + pennant.control.x * (pennant.tipX - pennant.left);
  const a = y0 - 2 * controlY + pennant.tipY;
  const b = 2 * (controlY - y0);
  const c = y0 - y;
  const t = (-b + Math.sqrt(b * b - 4 * a * c)) / (2 * a);
  return (1 - t) ** 2 * pennant.left + 2 * t * (1 - t) * controlX + t ** 2 * pennant.tipX;
}

function insidePennant(x, y) {
  const { pennant } = MARK;
  if (x < pennant.left || x > pennant.tipX || y < pennant.top || y > pennant.bottom) return false;
  return x <= pennantRightEdge(y);
}

function sample(u, v) {
  const x = (u * MARK_ICON.size - MARK_ICON.x) / MARK_ICON.scale;
  const y = (v * MARK_ICON.size - MARK_ICON.y) / MARK_ICON.scale;
  return insidePole(x, y) || insidePennant(x, y) ? FLAG : TILE;
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

const round = (value) => Number(value.toFixed(4));

function iconSvg(px) {
  return [
    `<svg width="${px}" height="${px}" viewBox="0 0 ${MARK_ICON.size} ${MARK_ICON.size}" xmlns="http://www.w3.org/2000/svg">`,
    `  <rect width="${MARK_ICON.size}" height="${MARK_ICON.size}" rx="${MARK_ICON.radius}" fill="${TILE_HEX}"/>`,
    `  <g transform="translate(${round(MARK_ICON.x)} ${round(MARK_ICON.y)}) scale(${round(MARK_ICON.scale)})">`,
    `    <path d="${MARK_PENNANT_PATH}" fill="${FLAG_HEX}"/>`,
    `    <path d="${MARK_POLE_PATH}" fill="none" stroke="${FLAG_HEX}" stroke-width="${MARK_POLE_WIDTH}" stroke-linecap="round"/>`,
    '  </g>',
    '</svg>',
    '',
  ].join('\n');
}

for (const [name, px] of [['favicon.svg', 64], ['icon-192.svg', 192], ['icon-512.svg', 512]]) {
  writeFileSync(resolve(outDir, name), iconSvg(px));
  console.log('wrote', name);
}

for (const size of [192, 512]) {
  writeFileSync(resolve(outDir, `icon-${size}.png`), encodePng(size, render(size)));
  console.log('wrote', `icon-${size}.png`);
}

// iOS ignores manifest icons for the home screen and falls back to a page
// screenshot, so it needs its own link and asset.
writeFileSync(resolve(outDir, 'apple-touch-icon.png'), encodePng(180, render(180)));
console.log('wrote', 'apple-touch-icon.png');
