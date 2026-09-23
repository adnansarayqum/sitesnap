import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

let server;
let base;
let origin;
let cookie;
let temp;

beforeAll(async () => {
  temp = await fs.mkdtemp(path.join(os.tmpdir(), "sitesnap-server-"));
  await fs.writeFile(path.join(temp, "index.html"), "<!doctype html><title>fixture</title><div id=app>SiteSnap fixture</div>");
  Object.assign(process.env, {
    NODE_ENV: "production",
    SITESNAP_ACCESS_KEY: "test-only-access-key-1234",
    SITESNAP_DIST_DIR: temp,
    COMMIT_SHA: "f633838d202822d116336e63d87a88c088c1f41c",
    RELEASE_ID: "release-42",
  });
  delete process.env.DATABASE_URL;
  const { app } = await import("../server/index.js");
  server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  const address = server.address();
  base = `http://127.0.0.1:${address.port}`;
  origin = base;
}, 30_000);

afterAll(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
  await fs.rm(temp, { recursive: true, force: true });
});

describe("production server routing and access", () => {
  it("serves root, index.html and deep links but keeps unknown APIs JSON", async () => {
    for (const route of ["/", "/index.html", "/cases/insp_1234"]) {
      const response = await fetch(base + route);
      expect(response.status).toBe(200);
      expect(await response.text()).toContain("SiteSnap fixture");
    }
    const missing = await fetch(base + "/api/does-not-exist");
    expect(missing.status).toBe(404);
    expect(missing.headers.get("content-type")).toMatch(/json/);
    expect(await missing.json()).toEqual({ error: "not found" });
  });

  it("returns only bounded readiness and release identity", async () => {
    const response = await fetch(base + "/readyz");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      status: "ok",
      version: "2.1.0",
      commit: "f633838d202822d116336e63d87a88c088c1f41c",
      release: "release-42",
    });
  });

  it("requires same-origin login and sets a hardened session cookie", async () => {
    const rejected = await fetch(base + "/api/session", {
      method: "POST", headers: { "content-type": "application/json", origin: "https://attacker.invalid" }, body: JSON.stringify({ passphrase: "test-only-access-key-1234" }),
    });
    expect(rejected.status).toBe(403);

    const response = await fetch(base + "/api/session", {
      method: "POST", headers: { "content-type": "application/json", origin }, body: JSON.stringify({ passphrase: "test-only-access-key-1234" }),
    });
    expect(response.status).toBe(200);
    const setCookie = response.headers.get("set-cookie");
    expect(setCookie).toMatch(/^ss_access=/);
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toContain("SameSite=Strict");
    expect(setCookie).toContain("Secure");
    cookie = setCookie.split(";")[0];
  });

  it("protects AI reads and rejects authenticated writes without an origin", async () => {
    expect((await fetch(base + "/api/ai/config")).status).toBe(401);
    expect((await fetch(base + "/api/ai/config", { headers: { cookie } })).status).toBe(200);
    const noOrigin = await fetch(base + "/api/events", {
      method: "POST", headers: { cookie, "content-type": "application/json" }, body: JSON.stringify({ events: [] }),
    });
    expect(noOrigin.status).toBe(403);
    const allowed = await fetch(base + "/api/events", {
      method: "POST", headers: { cookie, origin, "content-type": "application/json" }, body: JSON.stringify({ events: [] }),
    });
    expect(allowed.status).toBe(200);
  });

  it("cannot bypass capability guards with path variants", async () => {
    for (const [method, route] of [
      ["GET", "/API/AI/CONFIG"],
      ["GET", "/api/ai/config/"],
      ["GET", "/api/ai/config?variant=1"],
      ["DELETE", "/Api/Ai/config"],
      ["GET", "/API/PRICE-BOOK/"],
      ["PATCH", "/api/price-book/rows/test?variant=1"],
      ["GET", "/api/admin/pilot/"],
      ["POST", "/API/EVENTS"],
      ["POST", "/api/events/"],
      ["POST", "/API/FEEDBACK?variant=1"],
      ["POST", "/api/cloud/pair/"],
      ["GET", "/API/CLOUD/CLAIM/?pair=test"],
      ["POST", "/API/CLOUD/TOKEN/"],
      ["POST", "/api/cloud/revoke?variant=1"],
      ["GET", "/AUTH/GOOGLE/START/?pair=test"],
      ["GET", "/auth/%67oogle/start?pair=test"],
    ]) {
      const response = await fetch(base + route, {
        method,
        headers: { origin, "content-type": "application/json" },
        body: ["GET", "HEAD", "DELETE"].includes(method) ? undefined : "{}",
      });
      expect(response.status, `${method} ${route}`).toBe(401);
    }

    // The same Express matcher authorizes and dispatches a variant.
    expect((await fetch(base + "/API/AI/CONFIG/", { headers: { cookie } })).status).toBe(200);

    for (const route of ["/API/EVENTS", "/api/events/", "/API/CLOUD/TOKEN/", "/api/cloud/pair/"]) {
      const response = await fetch(base + route, {
        method: "POST",
        headers: { origin, "content-type": "application/json" },
        body: "{}",
      });
      expect(response.status, route).toBe(401);
    }

    // Variants Express itself does not dispatch must stay non-capable.
    for (const [method, route] of [["GET", "/api//ai/config"], ["GET", "/api/%61i/config"], ["POST", "/api/cloud//token"]]) {
      const response = await fetch(base + route, {
        method,
        headers: { origin, "content-type": "application/json" },
        body: method === "GET" ? undefined : "{}",
      });
      expect(response.status, route).toBe(404);
      expect(response.headers.get("content-type"), route).toMatch(/json/);
    }
  });

  it("rate-limits repeated login guesses", async () => {
    const statuses = [];
    for (let i = 0; i < 9; i += 1) {
      const response = await fetch(base + "/api/session", {
        method: "POST", headers: { "content-type": "application/json", origin }, body: JSON.stringify({ passphrase: `wrong-${i}` }),
      });
      statuses.push(response.status);
    }
    expect(statuses).toContain(429);
  });
});
