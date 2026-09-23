import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

let child;
let base;
let temp;
let output = "";

beforeAll(async () => {
  temp = await fs.mkdtemp(path.join(os.tmpdir(), "sitesnap-startup-"));
  await fs.writeFile(path.join(temp, "index.html"), "<!doctype html><div id=\"root\"></div>");
  const port = 32219;
  base = `http://127.0.0.1:${port}`;
  child = spawn(process.execPath, ["server/index.js"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      NODE_ENV: "production",
      PORT: String(port),
      PUBLIC_URL: base,
      SITESNAP_ACCESS_KEY: "startup-test-access-key-1234",
      SITESNAP_DIST_DIR: temp,
      DATABASE_URL: "postgres://unused:unused@127.0.0.1:1/unused",
      ANTHROPIC_API_KEY: "",
      OPENAI_API_KEY: "",
      TOKEN_KEY: "",
      MS_CLIENT_ID: "",
      MS_CLIENT_SECRET: "",
      GOOGLE_CLIENT_ID: "",
      GOOGLE_CLIENT_SECRET: "",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.on("data", (chunk) => { output += chunk; });
  child.stderr.on("data", (chunk) => { output += chunk; });
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`server exited early (${child.exitCode})\n${output}`);
    try { if ((await fetch(base + "/readyz")).ok) return; } catch { /* starting */ }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`server did not start with optional database unavailable\n${output}`);
}, 20_000);

afterAll(async () => {
  if (child && child.exitCode === null) {
    if (process.platform === "win32") spawn("taskkill", ["/pid", String(child.pid), "/t", "/f"], { stdio: "ignore" });
    else child.kill("SIGTERM");
  }
  if (child) await Promise.race([new Promise((resolve) => child.once("exit", resolve)), new Promise((resolve) => setTimeout(resolve, 5_000))]);
  if (temp) await fs.rm(temp, { recursive: true, force: true });
});

describe("production startup with optional database", () => {
  it("keeps the local-first app ready when Postgres is unreachable", async () => {
    const readiness = await fetch(base + "/readyz");
    expect(readiness.status).toBe(200);
    expect((await readiness.json()).status).toBe("ok");
    const deadline = Date.now() + 5_000;
    while (!/optional database unavailable; continuing without it/i.test(output) && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    expect(output).toMatch(/optional database unavailable; continuing without it/i);
    const health = await (await fetch(base + "/healthz")).json();
    expect(health).toEqual({ ok: true, mode: "local", db: false });
  });
});
