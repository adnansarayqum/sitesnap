/* ---------- image helpers ---------- */

export const PHOTO_DIM = 2200;   // stored copy: fine for a printed report, under Graph's 4 MB upload cap
export const THUMB_DIM = 480;    // grid/list copy: a 2200px JPEG decodes to ~19 MB of bitmap per cell

export function fitWithin(width, height, maxDim) {
  if (width <= maxDim && height <= maxDim) return [width, height];
  return width > height
    ? [maxDim, Math.round((height * maxDim) / width)]
    : [Math.round((width * maxDim) / height), maxDim];
}

// `source` is anything drawImage accepts (an <img>, a <video>, a canvas).
export function drawScaled(source, srcW, srcH, maxDim, quality) {
  const [w, h] = fitWithin(srcW, srcH, maxDim);
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  c.getContext("2d").drawImage(source, 0, 0, w, h);
  return c.toDataURL("image/jpeg", quality);
}

export function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("The image couldn't be decoded"));
    img.src = src;
  });
}

// Decodes the picked/shot file once and produces both the stored copy and a
// small thumbnail for lists. Decoding via an object URL avoids first turning
// a 10 MB original into a 13 MB base64 string just to read it back.
export async function processCapture(file) {
  const url = URL.createObjectURL(file);
  try {
    const img = await loadImage(url);
    const w = img.naturalWidth || img.width, h = img.naturalHeight || img.height;
    return {
      dataUrl: drawScaled(img, w, h, PHOTO_DIM, 0.87),
      thumb: drawScaled(img, w, h, THUMB_DIM, 0.72),
    };
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function dataUrlToFile(dataUrl, name) {
  const [head, body] = dataUrl.split(",");
  const mime = head.match(/:(.*?);/)[1];
  const bin = atob(body);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return new File([arr], name, { type: mime });
}

export function canShareFiles() {
  return typeof navigator !== "undefined" && !!navigator.canShare && !!navigator.share;
}

export async function shareFiles(files, title) {
  if (!files.length) return { ok: false, reason: "empty" };
  if (!canShareFiles()) return { ok: false, reason: "unsupported" };
  try {
    if (navigator.canShare({ files })) {
      await navigator.share({ files, title });
      return { ok: true };
    }
    return { ok: false, reason: "unsupported" };
  } catch (err) {
    if (err && err.name === "AbortError") return { ok: false, reason: "cancelled" };
    return { ok: false, reason: "error" };
  }
}
