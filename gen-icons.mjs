// Icon generator — creates triforce PNG icons at multiple sizes using pngjs
import { PNG } from 'pngjs';
import { writeFileSync } from 'fs';

// Triforce logo in normalized coords (0–1 based on 100x87 viewBox)
// Outer stroke triangle: points="50,2 98,85 2,85" — used for maskable padding reference
// Three filled shards:
const W_VB = 100, H_VB = 87;
const SHARDS = [
  [[50, 25], [74, 68], [26, 68]],  // top shard
  [[27, 25], [51, 68], [3,  68]],  // bottom-left shard
  [[73, 25], [97, 68], [49, 68]],  // bottom-right shard
];

// Colors
const BG   = { r: 4,   g: 5,   b: 7,   a: 255 };
const GOLD = { r: 240, g: 192, b: 64,  a: 243 }; // opacity .95

function edgeFunction(ax, ay, bx, by, px, py) {
  return (px - ax) * (by - ay) - (py - ay) * (bx - ax);
}

function inTriangle(pts, px, py) {
  const [[ax,ay],[bx,by],[cx,cy]] = pts;
  const d1 = edgeFunction(ax,ay, bx,by, px,py);
  const d2 = edgeFunction(bx,by, cx,cy, px,py);
  const d3 = edgeFunction(cx,cy, ax,ay, px,py);
  const hasNeg = (d1 < 0) || (d2 < 0) || (d3 < 0);
  const hasPos = (d1 > 0) || (d2 > 0) || (d3 > 0);
  return !(hasNeg && hasPos);
}

function makeIcon(size, maskable = false) {
  const png = new PNG({ width: size, height: size });

  // Scale: fit the 100x87 viewbox into the icon, centred
  // For maskable, add ~12% safe-zone padding on each side
  const pad  = maskable ? size * 0.16 : size * 0.06;
  const scaleX = (size - 2 * pad) / W_VB;
  const scaleY = (size - 2 * pad) / H_VB;
  const scale  = Math.min(scaleX, scaleY);
  const offX   = (size - W_VB * scale) / 2;
  const offY   = (size - H_VB * scale) / 2;

  // Pre-scale shard triangles
  const scaled = SHARDS.map(shard =>
    shard.map(([x, y]) => [x * scale + offX, y * scale + offY])
  );

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const idx = (y * size + x) * 4;
      // Anti-alias: sample a 2x2 grid within the pixel
      let hits = 0;
      for (const sy of [0.25, 0.75]) {
        for (const sx of [0.25, 0.75]) {
          const px = x + sx, py = y + sy;
          for (const tri of scaled) {
            if (inTriangle(tri, px, py)) { hits++; break; }
          }
        }
      }
      const alpha = hits / 4; // 0, 0.25, 0.5, 0.75, or 1
      png.data[idx]   = Math.round(BG.r + (GOLD.r - BG.r) * alpha);
      png.data[idx+1] = Math.round(BG.g + (GOLD.g - BG.g) * alpha);
      png.data[idx+2] = Math.round(BG.b + (GOLD.b - BG.b) * alpha);
      png.data[idx+3] = 255;
    }
  }

  return PNG.sync.write(png);
}

const SIZES = [72, 96, 128, 144, 152, 192, 384, 512];

for (const s of SIZES) {
  const buf = makeIcon(s, false);
  writeFileSync(`public/icons/icon-${s}x${s}.png`, buf);
  console.log(`  icon-${s}x${s}.png`);
}

// Maskable 512x512
const maskBuf = makeIcon(512, true);
writeFileSync('public/icons/icon-512x512-maskable.png', maskBuf);
console.log('  icon-512x512-maskable.png');

console.log('Done.');
