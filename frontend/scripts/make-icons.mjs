// Draws the icons of the app (public/icons/*.png). Run it from the frontend
// folder:  node scripts/make-icons.mjs
//
// The drawing is our own: a canary-yellow dot with two rings on the dark page
// colour. These are the colours of the app (--bg and --canary of the dark
// theme). It uses `sharp`, which Next.js already installs; nothing is added to
// package.json.
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const BG = '#0f1114';
const CANARY = '#f2c94c';
const out = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'icons');
mkdirSync(out, { recursive: true });

// 512 x 512 drawing. "any": rounded corners. "maskable": the whole square is
// filled and everything that matters stays inside the middle 80 percent, so a
// round or squircle mask cannot cut it.
const drawing = (rounded) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <rect width="512" height="512" ${rounded ? 'rx="112"' : ''} fill="${BG}"/>
  <circle cx="256" cy="256" r="150" fill="none" stroke="${CANARY}" stroke-opacity="0.35" stroke-width="14"/>
  <circle cx="256" cy="256" r="100" fill="none" stroke="${CANARY}" stroke-opacity="0.65" stroke-width="14"/>
  <circle cx="256" cy="256" r="48" fill="${CANARY}"/>
</svg>`;

const files = [
  ['icon-192.png', 192, true],
  ['icon-512.png', 512, true],
  ['maskable-192.png', 192, false],
  ['maskable-512.png', 512, false],
];
for (const [name, size, rounded] of files) {
  await sharp(Buffer.from(drawing(rounded)))
    .resize(size, size)
    .png()
    .toFile(join(out, name));
  console.log(`public/icons/${name} (${size} x ${size})`);
}
