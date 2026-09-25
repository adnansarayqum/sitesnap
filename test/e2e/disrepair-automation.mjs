// Live E2E pass over this session's new work: case metadata + "Import from
// letter", mock AI drafting/approval, and the MLA/TLB .xlsm export buttons.
// The existing test/e2e/local.mjs predates all of this. Run with AI_MOCK=1
// against a server on BASE (default :3000) — mock mode is required for the
// AI-off gating to flip and for a deterministic drafted finding.
import { chromium } from "playwright-core";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const BASE = process.env.BASE || "http://localhost:3000";
const S = fs.mkdtempSync(path.join(os.tmpdir(), "sitesnap-e2e-dis-"));
const results = [];
const rec = (id, status, detail = "") => { results.push({ id, status, detail }); console.log(`${status.padEnd(4)} ${id}${detail ? " — " + detail : ""}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM || "/opt/pw-browsers/chromium",
  args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"],
});

async function makePhoto(browser, idx, dir) {
  const p = await browser.newPage({ viewport: { width: 1200, height: 900 } });
  const dataUrl = await p.evaluate((idx) => {
    const c = document.createElement("canvas"); c.width = 1200; c.height = 900;
    const g = c.getContext("2d");
    g.fillStyle = "#cfc9bb"; g.fillRect(0, 0, 1200, 900);
    const r = g.createRadialGradient(500, 400, 20, 500, 400, 300);
    r.addColorStop(0, "rgba(40,36,30,.85)"); r.addColorStop(1, "rgba(0,0,0,0)");
    g.fillStyle = r; g.beginPath(); g.ellipse(500, 400, 340, 240, 0.3, 0, Math.PI * 2); g.fill();
    return c.toDataURL("image/jpeg", 0.85);
  }, idx);
  const file = path.join(dir, `photo-${idx}.jpg`);
  fs.writeFileSync(file, Buffer.from(dataUrl.split(",")[1], "base64"));
  await p.close();
  return file;
}

// A synthetic "letter" image — AI_MOCK ignores actual content and returns
// canned recognised:true fields, so this only needs to pass the client's
// own image/* type check.
async function makeLetterImage(browser, dir) {
  const p = await browser.newPage({ viewport: { width: 800, height: 1100 } });
  const dataUrl = await p.evaluate(() => {
    const c = document.createElement("canvas"); c.width = 800; c.height = 1100;
    const g = c.getContext("2d");
    g.fillStyle = "#ffffff"; g.fillRect(0, 0, 800, 1100);
    g.fillStyle = "#111"; g.font = "20px sans-serif";
    g.fillText("Letter of Instruction (synthetic, for E2E test)", 40, 60);
    return c.toDataURL("image/png");
  });
  const file = path.join(dir, "letter.png");
  fs.writeFileSync(file, Buffer.from(dataUrl.split(",")[1], "base64"));
  await p.close();
  return file;
}

async function fresh() {
  const ctx = await browser.newContext({
    viewport: { width: 412, height: 915 }, hasTouch: true, permissions: ["camera", "microphone"], acceptDownloads: true,
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push("pageerror: " + String(e)));
  page.on("console", (m) => { if (m.type() === "error" && !/ERR_CERT_AUTHORITY_INVALID|fonts\.g/.test(m.text())) errors.push(m.text()); });
  page.errors = errors;
  await page.goto(BASE + "/", { waitUntil: "networkidle" });
  await page.waitForTimeout(300);
  return { ctx, page };
}
const w = (page, ms = 300) => page.waitForTimeout(ms);
const errs = (page) => page.errors.splice(0);

try {
  const { ctx, page } = await fresh();
  const photoDir = fs.mkdtempSync(path.join(S, "photos-"));
  const photo = await makePhoto(browser, 0, photoDir);
  const letter = await makeLetterImage(browser, photoDir);

  // --- create a case, set agency to TLB ------------------------------------
  await page.getByRole("button", { name: /new inspection/i }).click(); await w(page);
  await page.locator('input[placeholder="23 High Street"]').fill("9 Disrepair Drive");
  await page.locator('input[placeholder="Postcode (optional)"]').fill("SE1 9ZZ");
  await page.getByRole("button", { name: /^Next/ }).click(); await w(page);
  await page.getByText("Kitchen", { exact: true }).first().click(); await w(page, 100);
  await page.getByRole("button", { name: /Start inspection/ }).click(); await w(page, 500);
  const e0 = errs(page);
  rec("D1 case created", e0.length ? "FAIL" : "PASS", e0.join(" | "));

  // --- import from letter (mock mode: recognised:true, canned fields) ------
  await page.getByText("Overview", { exact: true }).first().click(); await w(page);
  const importBtn = page.getByRole("button", { name: /Import from letter/i });
  const importVisible = await importBtn.isVisible().catch(() => false);
  if (importVisible) {
    const fileInputs = page.locator('input[type="file"]');
    const count = await fileInputs.count();
    let done = false;
    for (let i = 0; i < count && !done; i++) {
      const accept = await fileInputs.nth(i).getAttribute("accept");
      if (accept && accept.includes("application/pdf")) { await fileInputs.nth(i).setInputFiles(letter); done = true; }
    }
    await w(page, 900);
    const modalVisible = await page.getByText(/Imported from your letter/i).isVisible().catch(() => false);
    let claimantPrefilled = false;
    if (modalVisible) {
      claimantPrefilled = await page.locator('input[placeholder*="Claimant"]').inputValue().then((v) => v.includes("MOCK")).catch(() => false);
      await page.getByRole("button", { name: /^Save$/ }).click(); await w(page, 400);
    }
    const e1 = errs(page);
    rec("D2 import from letter: pre-fills Case Details from a mock-recognised letter", modalVisible && claimantPrefilled && !e1.length ? "PASS" : "FAIL", `modalVisible=${modalVisible} claimantPrefilled=${claimantPrefilled} console=${e1.join(" | ")}`);
  } else {
    rec("D2 import from letter", "FAIL", "button not visible — is AI_MOCK=1 set on the server? (button only shows when aiConfig().enabled)");
  }

  // --- fill remaining Case Details (agency = TLB) by hand -------------------
  await page.getByRole("button", { name: /Edit case details/i }).click(); await w(page);
  await page.getByText("TLB", { exact: true }).click(); await w(page, 100);
  const defendantInput = page.locator('input[placeholder*="London Borough"]');
  if (await defendantInput.count()) await defendantInput.fill("E2E Test Landlord Ltd");
  await page.getByRole("button", { name: /^Save$/ }).click(); await w(page, 400);
  const agencyShown = await page.getByText("TLB", { exact: true }).first().isVisible().catch(() => false);
  const e2 = errs(page);
  rec("D3 case details: agency set to TLB, persists on Overview", agencyShown && !e2.length ? "PASS" : "FAIL", `agencyShown=${agencyShown} console=${e2.join(" | ")}`);

  // --- raise an issue FIRST (it becomes activeIssueId), then shoot into it --
  // (photos added before an issue exists land in the room's unorganised
  // "General" bucket, not the issue — order matters here)
  await page.getByText("Rooms", { exact: true }).first().click(); await w(page);
  await page.getByText("Kitchen", { exact: false }).first().click(); await w(page);
  await page.locator(".ss-ichip.add").click(); await w(page, 200);
  await page.locator("input").last().fill("Ceiling mould");
  await page.keyboard.press("Enter"); await w(page, 300);
  await page.locator('input[type="file"][accept="image/*"]').first().setInputFiles(photo); await w(page, 700);
  const e3 = errs(page);
  rec("D4 room: issue raised, photo shot into it", e3.length ? "FAIL" : "PASS", e3.join(" | "));

  // --- findings: draft (mock) then approve ----------------------------------
  // NB the draft button's accessible name is "Draft findings (N issue(s))",
  // which is a substring of the neighbouring InfoTip's aria-label ("What
  // this does: What Draft findings does") — anchor the pattern or `.first()`
  // silently clicks the info icon instead of running anything.
  await page.locator(".ss-back").first().click(); await w(page, 300);
  await page.getByText("Findings", { exact: true }).first().click(); await w(page, 400);
  const draftBtn = page.getByRole("button", { name: /^Draft findings \(|^Re-draft all issues$/ }).first();
  const draftable = await draftBtn.isVisible().catch(() => false);
  if (draftable) {
    await draftBtn.click();
    await page.waitForTimeout(4000); // mock is fast but the pipeline has several stages
  }
  // The mock finding is deliberately flagged (low confidence, unpriced — a
  // real mock, not a rubber stamp); approve its own card, same as a
  // surveyor would for anything needing attention.
  const approveBtn = page.getByRole("button", { name: /^Approve$/ }).first();
  let approved = false;
  if (await approveBtn.isVisible().catch(() => false) && !(await approveBtn.isDisabled().catch(() => true))) {
    await approveBtn.click(); await w(page, 400);
    approved = await page.getByText(/^Approved$/).first().isVisible().catch(() => false);
  }
  const e4 = errs(page);
  rec("D5 findings: draft (mock AI) and approve a flagged finding", draftable && approved ? "PASS" : "FAIL", `draftable=${draftable} approved=${approved} console=${e4.join(" | ")}`);

  // --- export: MLA/TLB button reflects agency and stays correctly gated ----
  // isReportable() (shared/findingRules.js) explicitly excludes mock
  // findings (`!f.mock`) so mock output can never reach a real export, even
  // through this UI path — AI_MOCK=1 can never produce an approved,
  // reportable finding by design, so the button must stay disabled here.
  // The export-writing logic itself (fillMlaTemplate/fillTlbTemplate) is
  // proven separately: test/xlsmOrdering.test.js round-trips the real
  // templates, and this session verified the rendered output via
  // LibreOffice directly — this check instead confirms the mock-safety
  // guard actually holds end-to-end through the live approval UI, not just
  // in the export function's own code.
  await page.getByText("Export", { exact: true }).first().click(); await w(page, 400);
  const exportBtn = page.getByRole("button", { name: /TLB report|MLA report/i }).first();
  const btnText = await exportBtn.textContent().catch(() => "");
  const isTlbLabelled = /TLB report/i.test(btnText || "");
  const stillDisabled = await exportBtn.isDisabled().catch(() => false);
  const e5 = errs(page);
  rec("D6 export: TLB-labelled (agency-correct); stays disabled for a mock (unapproved-for-export) finding", isTlbLabelled && stillDisabled && !e5.length ? "PASS" : "FAIL", `btnText="${btnText}" stillDisabled=${stillDisabled} console=${e5.join(" | ")}`);

  await ctx.close();
} catch (e) { rec("D-fatal", "FAIL", e.stack || e.message); }

await browser.close();
const pass = results.filter((r) => r.status === "PASS").length;
const fail = results.filter((r) => r.status === "FAIL").length;
console.log(`\n==== SUMMARY ====\nPASS ${pass} · FAIL ${fail}`);
process.exit(fail ? 1 : 0);
