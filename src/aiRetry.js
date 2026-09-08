// Keeps an AI request (a photo caption, a transcription, a findings draft)
// alive across a dropped signal instead of surfacing a hard error the
// surveyor has to notice and retry by hand mid-inspection. Scope: retries
// happen in memory for as long as the screen that started the request stays
// open — the same tradeoff already accepted for background photo filing
// (filing.js) — not across an app restart.
const CONNECTIVITY_CODES = new Set(["ai_unreachable", "ai_interrupted"]);

function isConnectivityError(e) {
  if (!e || e.name === "AbortError") return false;
  if (typeof navigator !== "undefined" && navigator.onLine === false) return true;
  if (e.code && CONNECTIVITY_CODES.has(e.code)) return true;
  if (e.status === 503 || e.status === 499) return true;
  // fetch() itself throws a bare TypeError when the request never reached
  // the server at all (no route to host, DNS failure, connection refused)
  if (e instanceof TypeError) return true;
  return false;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function waitForOnline() {
  if (typeof window === "undefined") return new Promise(() => {});
  return new Promise((resolve) => {
    const onOnline = () => { window.removeEventListener("online", onOnline); resolve(); };
    window.addEventListener("online", onOnline);
  });
}

// Runs fn() once; on a connectivity failure it waits (backing off, but
// retrying immediately the moment the browser reports it's back online)
// and tries again, until it succeeds, isAlive() goes false, or a
// non-connectivity error surfaces (which is never retried — a real 400
// or a cancelled request comes straight back to the caller).
export async function withOfflineRetry(fn, { onQueued, isAlive = () => true, maxAttempts = 30 } = {}) {
  let attempt = 0;
  for (;;) {
    try {
      return await fn();
    } catch (e) {
      if (!isConnectivityError(e) || attempt >= maxAttempts || !isAlive()) throw e;
      attempt += 1;
      if (attempt === 1 && onQueued) onQueued(e);
      const backoff = Math.min(30000, 4000 * attempt);
      await Promise.race([sleep(backoff), waitForOnline()]);
      if (!isAlive()) throw e;
    }
  }
}
