// Regression test for the production "AI captions never work" bug. The
// abort-on-disconnect helper used to listen on req 'close', which Node has
// fired on body completion (not disconnect) since v16 — so every Claude /
// transcription call was aborted the moment its handler began. It must now
// stay quiet through a normal request/response, and still fire when the
// client really does drop the connection mid-request.
import { describe, expect, it } from "vitest";
import http from "node:http";
import net from "node:net";
import { abortOnClose } from "../server/abortOnClose.js";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function serve(handler) {
  return new Promise((resolve) => {
    const server = http.createServer(handler);
    server.listen(0, "127.0.0.1", () => resolve({ server, port: server.address().port }));
  });
}

describe("abortOnClose", () => {
  it("does not abort a normal request once its body has been read", async () => {
    const { server, port } = await serve((req, res) => {
      req.on("data", () => {});
      req.on("end", async () => {
        const { signal, finish } = abortOnClose(req, res);
        await sleep(60); // the upstream AI call in flight
        finish();
        res.end(JSON.stringify({ aborted: signal.aborted }));
      });
    });
    try {
      const r = await fetch(`http://127.0.0.1:${port}/`, { method: "POST", body: JSON.stringify({ photos: [] }), headers: { "content-type": "application/json" } });
      expect(await r.json()).toEqual({ aborted: false });
    } finally { server.close(); }
  });

  it("aborts when the client drops the connection mid-request", async () => {
    let seen;
    const observed = new Promise((resolve) => { seen = resolve; });
    const { server, port } = await serve((req, res) => {
      req.on("data", () => {});
      req.on("end", async () => {
        const { signal } = abortOnClose(req, res);
        signal.addEventListener("abort", () => seen("aborted"));
        await sleep(300);
        if (!signal.aborted) seen("completed");
        try { res.end("late"); } catch { /* socket gone */ }
      });
    });
    try {
      const sock = net.connect(port, "127.0.0.1", () => {
        sock.write("POST / HTTP/1.1\r\nHost: x\r\nContent-Type: application/json\r\nContent-Length: 2\r\n\r\n{}");
        setTimeout(() => sock.destroy(), 40); // hang up while the "AI call" is still running
      });
      expect(await observed).toBe("aborted");
    } finally { server.close(); }
  });
});
