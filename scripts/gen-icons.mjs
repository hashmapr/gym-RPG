// Generates PWA icons (192/512) + Apple touch (180) as raw PNGs with zero
// image dependencies: hand-rolled zlib deflate (stored blocks) + CRC32.
// Icon: dark rounded square, emerald barbell glyph.

import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url)) + '/..';

function crc32(buf) {
  let table = crc32.table;
  if (!table) {
    table = crc32.table = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c;
    }
  }
  let crc = -1;
  for (let i = 0; i < buf.length; i++) crc = (crc >>> 8) ^ table[(crc ^ buf[i]) & 0xff];
  return (crc ^ -1) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function png(width, height, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  // raw scanlines with filter byte 0
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function drawIcon(size) {
  const rgba = Buffer.alloc(size * size * 4);
  const bg = [9, 9, 11]; // zinc-950
  const fg = [52, 211, 153]; // emerald-400
  const radius = Math.round(size * 0.18);
  const bar = Math.round(size * 0.075); // bar thickness
  const plateW = Math.round(size * 0.09);
  const plateH = Math.round(size * 0.42);
  const barLen = Math.round(size * 0.52);
  const cx = size / 2;
  const cy = size / 2;

  const inRoundedRect = (x, y, x0, y0, w, h, r) => {
    if (x < x0 || x >= x0 + w || y < y0 || y >= y0 + h) return false;
    const dx = Math.max(x0 + r - x, x - (x0 + w - 1 - r), 0);
    const dy = Math.max(y0 + r - y, y - (y0 + h - 1 - r), 0);
    return dx * dx + dy * dy <= r * r;
  };

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let color = null;
      if (inRoundedRect(x, y, 0, 0, size, size, radius)) {
        color = bg;
        // barbell: horizontal bar + two plates
        const inBar =
          Math.abs(y - cy) <= bar / 2 &&
          Math.abs(x - cx) <= barLen / 2;
        const inLeftPlate = inRoundedRect(
          x, y,
          Math.round(cx - barLen / 2 - plateW), Math.round(cy - plateH / 2),
          plateW, plateH, Math.round(plateW * 0.3),
        );
        const inRightPlate = inRoundedRect(
          x, y,
          Math.round(cx + barLen / 2), Math.round(cy - plateH / 2),
          plateW, plateH, Math.round(plateW * 0.3),
        );
        if (inBar || inLeftPlate || inRightPlate) color = fg;
      }
      if (color) {
        const i = (y * size + x) * 4;
        rgba[i] = color[0];
        rgba[i + 1] = color[1];
        rgba[i + 2] = color[2];
        rgba[i + 3] = 255;
      }
    }
  }
  return png(size, size, rgba);
}

const outDir = join(root, 'public', 'icons');
mkdirSync(outDir, { recursive: true });
for (const size of [192, 512, 180]) {
  writeFileSync(join(outDir, `icon-${size}.png`), drawIcon(size));
  console.log(`icon-${size}.png written`);
}