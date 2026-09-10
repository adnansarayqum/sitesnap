// Structured operational events, one JSON line each, so what happened to a
// case can be followed in the logs without any of the evidence itself:
// identifiers, stage names, statuses, counts and timings — never a photo, a
// transcript, a note or a prompt.
const REDACT = new Set(["text", "transcript", "note", "dataUrl", "prompt", "content", "defect", "works", "caption"]);

export function event(name, fields = {}) {
  const safe = {};
  for (const [k, v] of Object.entries(fields)) {
    if (v === undefined || REDACT.has(k)) continue;
    safe[k] = typeof v === "string" && v.length > 200 ? v.slice(0, 200) + "…" : v;
  }
  console.info(JSON.stringify({ evt: name, at: new Date().toISOString(), ...safe }));
}

// A small semaphore: one surveyor's "Draft findings" is one user action but
// several provider calls; this caps how many pipelines the process runs at
// once so a busy firm can't exhaust the provider's rate limit or the box.
export function semaphore(max) {
  let active = 0;
  const queue = [];
  return {
    async run(fn) {
      if (active >= max) await new Promise((r) => queue.push(r));
      active += 1;
      try { return await fn(); } finally { active -= 1; const next = queue.shift(); if (next) next(); }
    },
    get active() { return active; },
    get waiting() { return queue.length; },
  };
}
