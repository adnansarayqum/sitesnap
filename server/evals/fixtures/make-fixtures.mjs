#!/usr/bin/env node
// Regenerates the synthetic images used by Category B (structural
// multimodal) cases. Deterministic: running it again produces identical
// bytes. These are coloured fields with speckles and lines, not photographs
// of buildings; they exist so the suite can prove ids, batching and issue
// attribution hold, never that the model can read a real defect.
//
//   node server/evals/fixtures/make-fixtures.mjs
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createImage, rect, speckle, line, noise, prng, encode } from "../lib/png.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const W = 640, H = 480;

// flat fields compress to a few KB; per-pixel noise would make each file
// ~0.5 MB for no evidential gain, so only the "unreadable" fixture carries it
const fixtures = {
  // ceiling, black-spot cluster in one corner
  "synthetic-ceiling-mould-A.png": () => { const img = createImage(W, H, [236, 233, 226]); const r = prng(11); speckle(img, 90, 80, 70, 900, [28, 26, 24], r); return img; },
  // same family, different corner and density — a second exhibit of the same issue
  "synthetic-ceiling-mould-B.png": () => { const img = createImage(W, H, [236, 233, 226]); const r = prng(12); speckle(img, 540, 90, 90, 1400, [30, 28, 26], r); speckle(img, 470, 60, 40, 300, [60, 58, 54], r); return img; },
  // flooring: brown field with a torn lighter region and a dark gap line
  "synthetic-floor-damage.png": () => { const img = createImage(W, H, [120, 84, 52]); rect(img, 200, 260, 220, 120, [190, 170, 140]); line(img, 200, 260, 420, 380, [40, 28, 18], 4); return img; },
  // wall: beige with a horizontal brown tide band
  "synthetic-wall-stain.png": () => { const img = createImage(W, H, [222, 212, 190]); rect(img, 0, 300, W, 40, [150, 118, 80]); rect(img, 0, 340, W, 140, [190, 170, 140]); return img; },
  // pipework: grey field with a blue-green drip streak
  "synthetic-pipe-leak.png": () => { const img = createImage(W, H, [170, 172, 176]); const r = prng(41); rect(img, 300, 0, 40, H, [120, 122, 126]); line(img, 320, 200, 322, 470, [60, 110, 130], 6); speckle(img, 322, 460, 30, 200, [60, 110, 130], r); return img; },
  // ceiling with a diagonal dark crack
  "synthetic-crack-diagonal.png": () => { const img = createImage(W, H, [240, 238, 232]); line(img, 60, 400, 560, 90, [70, 66, 60], 2); line(img, 300, 250, 330, 262, [70, 66, 60], 1); return img; },
  // unreadable: near-black noise (small, so the noise stays affordable)
  "synthetic-unreadable-dark.png": () => { const img = createImage(240, 180, [8, 8, 10]); const r = prng(61); noise(img, 24, r); return img; },
  // plain wall, nothing to see
  "synthetic-blank-wall.png": () => createImage(W, H, [224, 216, 200]),
  // textured (stippled) ceiling finish
  "synthetic-textured-ceiling.png": () => { const img = createImage(W, H, [238, 236, 230]); const r = prng(81); speckle(img, W / 2, H / 2, 400, 9000, [214, 211, 204], r); speckle(img, W / 2, H / 2, 400, 3000, [250, 249, 246], r); return img; },
};

for (const [name, make] of Object.entries(fixtures)) {
  const out = path.join(here, name);
  fs.writeFileSync(out, encode(make()));
  console.log(`${name}  ${fs.statSync(out).size} bytes`);
}
