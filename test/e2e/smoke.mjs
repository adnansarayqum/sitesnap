import { spawn } from "node:child_process";
import path from "node:path";
import { chromium } from "playwright-core";

const port = 32147;
const base = `http://127.0.0.1:${port}`;
const accessKey = "e2e-only-access-key-1234";
const expectedCommit = "0123456789abcdef0123456789abcdef01234567";
const child = spawn(process.execPath, ["server/index.js"], {
  cwd: process.cwd(),
  env: {
    ...process.env,
    NODE_ENV: "production",
    PORT: String(port),
    PUBLIC_URL: base,
    SITESNAP_ACCESS_KEY: accessKey,
    SITESNAP_DIST_DIR: path.join(process.cwd(), "dist"),
    ANTHROPIC_API_KEY: "",
    OPENAI_API_KEY: "",
    DATABASE_URL: "",
    COMMIT_SHA: expectedCommit,
    RELEASE_ID: "ci",
  },
  stdio: ["ignore", "pipe", "pipe"],
});

let output = "";
child.stdout.on("data", (chunk) => { output += chunk; });
child.stderr.on("data", (chunk) => { output += chunk; });

async function waitForServer() {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`server exited early (${child.exitCode})\n${output}`);
    try { if ((await fetch(`${base}/readyz`)).ok) return; } catch { /* booting */ }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error(`server did not become ready\n${output}`);
}

let browser;
try {
  await waitForServer();
  const readiness = await (await fetch(`${base}/readyz`)).json();
  if (readiness.commit !== expectedCommit) throw new Error(`readiness commit mismatch: ${readiness.commit}`);
  const unknown = await fetch(`${base}/api/not-a-route`);
  if (unknown.status !== 404 || !/json/.test(unknown.headers.get("content-type") || "")) throw new Error("unknown API did not return JSON 404");
  for (const route of ["/index.html", "/cases/example"]) {
    const shell = await fetch(base + route);
    const shellBody = await shell.text();
    if (!shell.ok || !shellBody.includes("id=\"root\"")) throw new Error(`${route} did not serve the shell (${shell.status} ${shellBody.slice(0, 120)})\nserver:\n${output}`);
  }

  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(base, { waitUntil: "networkidle" });
  await page.getByLabel("Access key").fill(accessKey);
  await page.getByRole("button", { name: "Unlock" }).click();
  await page.getByRole("button", { name: /new inspection/i }).waitFor({ timeout: 15_000 });

  await page.waitForFunction(() => navigator.serviceWorker && navigator.serviceWorker.controller, null, { timeout: 15_000 });
  // A controlled navigation used to prune every lazy chunk that was not
  // referenced directly by index.html. Reload once, then prove the complete
  // Vite manifest remains available before taking the device offline.
  await page.reload({ waitUntil: "networkidle" });
  const missingChunks = await page.evaluate(async () => {
    const manifest = await fetch("/manifest.json", { cache: "no-store" }).then((response) => response.json());
    const expected = Object.values(manifest)
      .flatMap((entry) => [entry.file, ...(entry.css || []), ...(entry.assets || [])])
      .filter(Boolean)
      .map((file) => new URL(`/${file.replace(/^\//, "")}`, location.origin).href);
    const names = await caches.keys();
    const shell = names.find((name) => name.startsWith("sitesnap-shell-"));
    if (!shell) return ["<missing shell cache>"];
    const cached = new Set((await (await caches.open(shell)).keys()).map((request) => request.url));
    return expected.filter((url) => !cached.has(url));
  });
  if (missingChunks.length) throw new Error(`manifest chunks missing after controlled navigation: ${missingChunks.join(", ")}`);
  await page.evaluate(() => localStorage.removeItem("sitesnap:device-activated-v1"));
  await context.setOffline(true);
  await page.goto(`${base}/offline/deep-link`, { waitUntil: "domcontentloaded" });
  await page.getByRole("heading", { name: /connect to activate sitesnap/i }).waitFor({ timeout: 15_000 });
  await page.evaluate(() => localStorage.setItem("sitesnap:device-activated-v1", "yes"));
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: /new inspection/i }).waitFor({ timeout: 15_000 });
  console.log("production smoke passed: auth, SPA fallback, JSON 404, exact readiness identity, full lazy cache, offline activation gate and reload");
} finally {
  if (browser) await browser.close();
  if (child.exitCode === null) {
    if (process.platform === "win32") spawn("taskkill", ["/pid", String(child.pid), "/t", "/f"], { stdio: "ignore" });
    else child.kill("SIGTERM");
    await Promise.race([
      new Promise((resolve) => child.once("exit", resolve)),
      new Promise((resolve) => setTimeout(resolve, 5_000)),
    ]);
  }
}
