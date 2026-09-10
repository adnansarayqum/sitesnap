// Minimal PNG writer for synthetic evaluation fixtures. No image library:
// RGB, 8-bit, filter 0, one zlib stream. Enough to draw flat colour fields,
// rectangles, speckle clusters and lines so Category B cases can check that
// photo ids, batches and exhibit numbers flow through the pipeline — these
// images say nothing about real building pathology and are labelled as such.
import zlib from "node:zlib";

const crc = (buf) => zlib.crc32(buf) >>> 0;
const u32 = (n) => { const b = Buffer.alloc(4); b.writeUInt32BE(n >>> 0); return b; };
const chunk = (type, data) => Buffer.concat([u32(data.length), Buffer.from(type, "ascii"), data, u32(crc(Buffer.concat([Buffer.from(type, "ascii"), data])))]);

export function createImage(width, height, fill = [200, 200, 200]) {
  const px = Buffer.alloc(width * height * 3);
  for (let i = 0; i < width * height; i++) { px[i * 3] = fill[0]; px[i * 3 + 1] = fill[1]; px[i * 3 + 2] = fill[2]; }
  return { width, height, px };
}

export function set(img, x, y, rgb) {
  if (x < 0 || y < 0 || x >= img.width || y >= img.height) return;
  const i = (y * img.width + x) * 3;
  img.px[i] = rgb[0]; img.px[i + 1] = rgb[1]; img.px[i + 2] = rgb[2];
}

export function rect(img, x0, y0, w, h, rgb) {
  for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) set(img, x, y, rgb);
}

// deterministic PRNG so a fixture's bytes (and therefore its hash) never change
export function prng(seed) {
  let s = seed >>> 0 || 1;
  return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 0xffffffff; };
}

export function speckle(img, cx, cy, radius, count, rgb, rnd) {
  for (let i = 0; i < count; i++) {
    const a = rnd() * Math.PI * 2, r = Math.sqrt(rnd()) * radius;
    const x = Math.round(cx + Math.cos(a) * r), y = Math.round(cy + Math.sin(a) * r);
    const s = 1 + Math.floor(rnd() * 3);
    rect(img, x, y, s, s, rgb);
  }
}

export function line(img, x0, y0, x1, y1, rgb, thickness = 2) {
  const steps = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0));
  for (let i = 0; i <= steps; i++) {
    const x = Math.round(x0 + (x1 - x0) * (i / steps)), y = Math.round(y0 + (y1 - y0) * (i / steps));
    rect(img, x, y, thickness, thickness, rgb);
  }
}

export function noise(img, amount, rnd) {
  for (let i = 0; i < img.px.length; i++) {
    const v = img.px[i] + Math.round((rnd() - 0.5) * amount);
    img.px[i] = Math.max(0, Math.min(255, v));
  }
}

export function encode(img) {
  const raw = Buffer.alloc((img.width * 3 + 1) * img.height);
  for (let y = 0; y < img.height; y++) {
    raw[y * (img.width * 3 + 1)] = 0;
    img.px.copy(raw, y * (img.width * 3 + 1) + 1, y * img.width * 3, (y + 1) * img.width * 3);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(img.width, 0); ihdr.writeUInt32BE(img.height, 4);
  ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}
