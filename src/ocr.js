// On-device text recognition — reading a serial number straight off a
// boiler plate or meter face into a note, without typing it by hand. Runs
// entirely on the phone via a bundled WASM model (public/tesseract/), so
// it works with no signal, same as the rest of a room's capture. The model
// is ~8MB and is only fetched the first time OCR is actually used; the
// service worker then keeps it for the next offline use.
let workerPromise = null;

function getWorker() {
  if (!workerPromise) {
    workerPromise = (async () => {
      const { createWorker } = await import("tesseract.js");
      return createWorker("eng", 1, {
        workerPath: "/tesseract/worker.min.js",
        corePath: "/tesseract",
        langPath: "/tesseract",
        gzip: true,
      });
    })().catch((e) => { workerPromise = null; throw e; });
  }
  return workerPromise;
}

export async function recognizeText(dataUrlOrBlob) {
  const worker = await getWorker();
  const { data } = await worker.recognize(dataUrlOrBlob);
  return (data && data.text ? data.text : "").trim();
}

// Serial/model plates are usually short runs of caps, digits and a few
// separators — pull those lines out first so the surveyor sees the number,
// not a paragraph of stray text the model also picked up off the label.
export function likelySerials(text) {
  return text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length >= 4 && /[A-Z0-9]{4,}/.test(l) && /^[A-Z0-9 \-/.:]+$/i.test(l));
}
