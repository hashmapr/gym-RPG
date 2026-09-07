// Generates all Overload icons as raw PNGs with zero image dependencies:
// hand-rolled zlib deflate (stored blocks) + CRC32.
// Sprint 7.5 branding: white sigil-eye on pure black — the Instrument
// Panel Monochrome face. Outputs:
//   public/icons/icon-{192,512,180}.png   (PWA)
//   ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png (1024)
//   ios/App/App/Assets.xcassets/Splash.imageset/splash-2732x2732*.png

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

// White sigil-eye on pure black: almond outline (lens shape) + solid
// pupil. `eyeScale` sizes the mark relative to the canvas.
function drawSigilEye(size, { eyeScale = 0.5, bg = [0, 0, 0] } = {}) {
  const rgba = Buffer.alloc(size * size * 4);
  const fg = [255, 255, 255];
  const cx = size / 2;
  const cy = size / 2;
  const a = (size * eyeScale) / 2; // half-width
  const b = a * 0.52; // half-height (almond proportion)
  const stroke = Math.max(2, Math.round(size * 0.028));
  const pupilR = a * 0.34;

  const inLens = (x, y) => {
    const dx = (x - cx) / a;
    const dy = (y - cy) / b;
    if (Math.abs(dx) > 1) return false;
    return Math.abs(dy) <= Math.sqrt(Math.max(0, 1 - dx * dx));
  };

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let on = false;
      if (inLens(x, y)) {
        // outline: lens minus an eroded lens
        const eroded =
          inLens(x - stroke, y) &&
          inLens(x + stroke, y) &&
          inLens(x, y - stroke) &&
          inLens(x, y + stroke);
        const dx = x - cx;
        const dy = y - cy;
        const inPupil = dx * dx + dy * dy <= pupilR * pupilR;
        on = !eroded || inPupil;
      }
      if (on) {
        const i = (y * size + x) * 4;
        rgba[i] = fg[0];
        rgba[i + 1] = fg[1];
        rgba[i + 2] = fg[2];
        rgba[i + 3] = 255;
      } else if (bg[0] || bg[1] || bg[2]) {
        const i = (y * size + x) * 4;
        rgba[i] = bg[0];
        rgba[i + 1] = bg[1];
        rgba[i + 2] = bg[2];
        rgba[i + 3] = 255;
      }
    }
  }
  return png(size, size, rgba);
}

// PWA icons (transparent bg — page provides the black)
const outDir = join(root, 'public', 'icons');
mkdirSync(outDir, { recursive: true });
for (const size of [192, 512, 180]) {
  writeFileSync(join(outDir, `icon-${size}.png`), drawSigilEye(size, { eyeScale: 0.56 }));
  console.log(`icon-${size}.png written`);
}

// iOS AppIcon: single 1024, opaque black
const iconDir = join(root, 'ios', 'App', 'App', 'Assets.xcassets', 'AppIcon.appiconset');
writeFileSync(join(iconDir, 'AppIcon-512@2x.png'), drawSigilEye(1024, { eyeScale: 0.56 }));
console.log('AppIcon-512@2x.png (1024) written');

// Splash: 2732 black canvas, small centered mark
const splashDir = join(root, 'ios', 'App', 'Assets.xcassets', 'Splash.imageset');
mkdirSync(splashDir, { recursive: true });
for (const name of ['splash-2732x2732.png', 'splash-2732x2732-1.png', 'splash-2732x2732-2.png']) {
  writeFileSync(join(splashDir, name), drawSigilEye(2732, { eyeScale: 0.16 }));
  console.log(`${name} written`);
}
