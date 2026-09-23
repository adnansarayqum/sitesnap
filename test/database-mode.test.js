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
  temp = await fs.mkdtemp(path.join(os.tmpdir(), "sitesnap-db-mode-"));
  await fs.writeFile(path.join(temp, "index.html"), "<!doctype html><div>fixture</div>");
  Object.assign(process.env, {
    NODE_ENV: "production",
    SITESNAP_ACCESS_KEY: "database-mode-test-key-1234",
    SITESNAP_DIST_DIR: temp,
    DATABASE_URL: "postgres://unused:unused@127.0.0.1:1/unused",
  });
  const { app } = await import("../server/index.js");
  server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  base = `http://127.0.0.1:${server.address().port}`;
  origin = base;
  const login = await fetch(base + "/api/session", {
    method: "POST", headers: { origin, "content-type": "application/json" }, body: JSON.stringify({ passphrase: "database-mode-test-key-1234" }),
  });
  cookie = login.headers.get("set-cookie").split(";")[0];
}, 30_000);

afterAll(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
  await fs.rm(temp, { recursive: true, force: true });
});

describe("DATABASE_URL single-client regression", () => {
  it("does not activate permanently-null org session guards", async () => {
    const rates = await fetch(base + "/api/price-book", { headers: { cookie } });
    expect(rates.status).toBe(200);
    expect(await rates.json()).toEqual({ rows: [], local: true });

    const priced = await fetch(base + "/api/ai/price", {
      method: "POST",
      headers: { cookie, origin, "content-type": "application/json" },
      body: JSON.stringify({ items: [], overrides: {} }),
    });
    expect(priced.status).toBe(200);
  });
});
