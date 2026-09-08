// Aborts an upstream call (Claude, the transcription provider) when the
// surveyor's own connection drops mid-request — a closed tab or a dead
// mobile signal shouldn't leave a multi-minute draft burning tokens for a
// response nobody will read.
//
// Listens on the *response*, not the request. Since Node 16, `req`'s
// 'close' fires as soon as the request body has been fully read — i.e. the
// moment a JSON/raw-body route handler starts — so listening there aborted
// every AI call immediately, which reached the phone as a generic 500 and,
// once that got its own status, as a bogus "no signal". `res` 'close' fires
// when the connection actually goes away, or after the response is written;
// `writableFinished` tells the two apart.
export function abortOnClose(req, res) {
  const controller = new AbortController();
  let done = false;
  res.on("close", () => { if (!done && !res.writableFinished) controller.abort(); });
  return { signal: controller.signal, finish: () => { done = true; } };
}
