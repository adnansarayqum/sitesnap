// Adversarial end-to-end pass over SiteSnap in local (no-database) mode.
// Each scenario is independent-ish and records PASS / FAIL / NOTE; a failure
// never stops the run. Run against a server on BASE (default :3000).
import { chromium } from "playwright-core";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import JSZip from "jszip";

const BASE = process.env.BASE || "http://localhost:3000";
const S = process.env.E2E_TMP || fs.mkdtempSync(path.join(os.tmpdir(), "sitesnap-e2e-"));
let PHOTOS = [];
const results = [];
const rec = (id, status, detail = "") => { results.push({ id, status, detail }); console.log(`${status.padEnd(4)} ${id}${detail ? " — " + detail : ""}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// A bare `node server/index.js` is a production server whose access-key gate
// answers every AI/cloud route with 503; this suite tests the ungated
// single-user mode, and test/e2e/smoke.mjs covers the gated one.
const preflight = await fetch(BASE + "/api/session").then((r) => r.json()).catch(() => null);
if (preflight && preflight.required === false && (await fetch(BASE + "/api/ai/config")).status === 503) {
  console.error("The server under test is in production mode with no SITESNAP_ACCESS_KEY, so its API is locked. Restart it with NODE_ENV=development (see test/e2e/README.md).");
  process.exit(2);
}

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM || "/opt/pw-browsers/chromium",
  args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"],
});


// Synthetic "inspection photos" — a plaster texture with a damp patch — so
// the suite needs nothing outside the repo. Rendered once per run.
async function makePhotos(browser, dir) {
  const out = [];
  const p = await browser.newPage({ viewport: { width: 1200, height: 900 } });
  for (let idx = 0; idx < 3; idx++) {
    const dataUrl = await p.evaluate((idx) => {
      const c = document.createElement("canvas"); c.width = 1200; c.height = 900;
      const g = c.getContext("2d");
      g.fillStyle = ["#d9d3c4", "#cfc9bb", "#e2ddd0"][idx]; g.fillRect(0, 0, 1200, 900);
      for (let i = 0; i < 40000; i++) { const v = Math.random() * 40 - 20; g.fillStyle = `rgba(${v > 0 ? 255 : 0},${v > 0 ? 255 : 0},${v > 0 ? 255 : 0},${Math.abs(v) / 200})`; g.fillRect(Math.random() * 1200, Math.random() * 900, 2, 2); }
      const cx = 380 + idx * 160, cy = 300 + (idx % 2) * 120;
      const r = g.createRadialGradient(cx, cy, 20, cx, cy, 260 + idx * 40);
      r.addColorStop(0, "rgba(40,36,30,.85)"); r.addColorStop(0.5, "rgba(70,60,45,.45)"); r.addColorStop(1, "rgba(0,0,0,0)");
      g.fillStyle = r; g.beginPath(); g.ellipse(cx, cy, 320 + idx * 30, 220, 0.3, 0, Math.PI * 2); g.fill();
      for (let i = 0; i < 1400; i++) { const a = Math.random() * Math.PI * 2, d = Math.random() * 200; g.fillStyle = `rgba(20,25,20,${0.3 + Math.random() * 0.5})`; g.beginPath(); g.arc(cx + Math.cos(a) * d * 1.4, cy + Math.sin(a) * d, 1 + Math.random() * 4, 0, Math.PI * 2); g.fill(); }
      return c.toDataURL("image/jpeg", 0.85);
    }, idx);
    const file = path.join(dir, `photo-${idx}.jpg`);
    fs.writeFileSync(file, Buffer.from(dataUrl.split(",")[1], "base64"));
    out.push(file);
  }
  await p.close();
  return out;
}
PHOTOS = await makePhotos(browser, S);

async function fresh(opts = {}) {
  const ctx = await browser.newContext({
    viewport: { width: 412, height: 915 }, hasTouch: true, permissions: ["camera", "microphone"], acceptDownloads: true, ...opts,
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push("pageerror: " + String(e)));
  page.on("console", (m) => { if (m.type() === "error" && !/ERR_CONNECTION_RESET|fonts\.g|couldn't be decoded/.test(m.text())) errors.push(m.text()); });
  page.errors = errors;
  await page.goto(BASE + "/", { waitUntil: "networkidle" });
  await page.waitForTimeout(300);
  return { ctx, page };
}
const w = (page, ms = 300) => page.waitForTimeout(ms);

async function newCase(page, { address = "14 Elmfield Road", postcode = "SE13 6HH", rooms = ["Kitchen", "Bathroom"], ref = "", client = "" } = {}) {
  await page.getByRole("button", { name: /new inspection|different inspection/i }).first().click(); await w(page);
  await page.locator('input[placeholder="23 High Street"]').fill(address);
  if (postcode) await page.locator('input[placeholder="Postcode (optional)"]').fill(postcode);
  if (ref) await page.locator('input[placeholder="Your reference (optional)"]').fill(ref);
  if (client) await page.locator('input[placeholder="Client (optional)"]').fill(client);
  await page.getByRole("button", { name: /^Next/ }).click(); await w(page);
  for (const r of rooms) { await page.getByText(r, { exact: true }).first().click(); await w(page, 80); }
  await page.getByRole("button", { name: /Start inspection/ }).click(); await w(page, 500);
}
async function openRoom(page, name) {
  await page.getByText("Rooms", { exact: true }).first().click(); await w(page);
  await page.getByText(name, { exact: false }).first().click(); await w(page);
}
async function addPhotos(page, files) {
  await page.locator('input[type="file"]').first().setInputFiles(files); await w(page, 400 + files.length * 120);
}
const backToCase = async (page) => { await page.locator(".ss-back").first().click(); await w(page, 350); };
const tab = async (page, name) => { await page.getByText(name, { exact: true }).first().click(); await w(page, 350); };
const errs = (page) => page.errors.splice(0);

// ---------------------------------------------------------------- S1 setup validation
try {
  const { ctx, page } = await fresh();
  await page.getByRole("button", { name: /new inspection/i }).click(); await w(page);
  const next = page.getByRole("button", { name: /^Next/ });
  const disabledEmpty = await next.isDisabled();
  await page.locator('input[placeholder="23 High Street"]').fill("   ");
  const disabledSpaces = await next.isDisabled();
  await page.locator('input[placeholder="23 High Street"]').fill("1 Test St");
  await next.click(); await w(page);
  // step 2 (Rooms) is now the last step — its own footer is "Start inspection"
  const start = page.getByRole("button", { name: /Start inspection/ });
  const disabledNoRooms = await start.isDisabled();
  // custom area with hostile characters
  await page.getByRole("button", { name: /Add custom area/i }).click();
  await page.locator('input[placeholder="e.g. Utility Room"]').fill('Loft / Attic: "Store" 🏠');
  await page.keyboard.press("Enter"); await w(page);
  // three bedrooms via stepper
  await page.getByText("Bedroom", { exact: true }).first().click(); await w(page, 80);
  await page.getByRole("button", { name: "Add Bedroom" }).click(); await w(page, 80);
  await page.getByRole("button", { name: "Add Bedroom" }).click(); await w(page, 80);
  const rows = await page.locator(".ss-row-name").allInnerTexts();
  // back from step 2 (Rooms) returns to step 1 (Property), not out of setup
  await page.locator(".ss-back").first().click(); await w(page);
  const stillSetup = /step 1/i.test(await page.locator(".ss-eyebrow-sm").first().innerText());
  await next.click(); await w(page);
  await start.click(); await w(page, 500);
  await tab(page, "Rooms");
  const roomNames = await page.locator(".ss-row-name").allInnerTexts();
  const ok = disabledEmpty && disabledSpaces && disabledNoRooms && stillSetup && roomNames.some((n) => n === "Bedroom 3") && roomNames.some((n) => n.includes("Loft"));
  rec("S1 setup validation + hostile custom room + duplicates", ok ? "PASS" : "FAIL", `emptyDisabled=${disabledEmpty} spacesDisabled=${disabledSpaces} noRoomsDisabled=${disabledNoRooms} backStaysInWizard=${stillSetup} rooms=${JSON.stringify(roomNames)} setupRows=${rows.length}`);
  const e = errs(page); if (e.length) rec("S1 console", "FAIL", e.join(" | "));
  await ctx.close();
} catch (e) { rec("S1", "FAIL", e.message); }

// ---------------------------------------------------------------- S2 hostile address → ZIP + report
try {
  const { ctx, page } = await fresh();
  const hostile = 'Flat 2/3, "The Old <Mill>": Bakers*Lane?|' + "X".repeat(120);
  await newCase(page, { address: hostile, postcode: "sw1a 1aa", rooms: ["Kitchen"] });
  const title = await page.locator(".ss-title").first().innerText();
  await openRoom(page, "Kitchen"); await addPhotos(page, [PHOTOS[0]]);
  await page.locator(".ss-caption").first().fill('Mould / damp: "north" wall?');
  await backToCase(page); await tab(page, "Export");
  const [dl] = await Promise.all([page.waitForEvent("download", { timeout: 20000 }), page.getByRole("button", { name: /Export ZIP/ }).click()]);
  const zipPath = await dl.path();
  const zip = await JSZip.loadAsync(fs.readFileSync(zipPath));
  const names = Object.keys(zip.files);
  const badChars = names.filter((n) => /[<>:"|?*\\]/.test(n.replace(/\//g, "")));
  const hasPhoto = names.some((n) => /\.jpg$/.test(n));
  const hasNotes = names.some((n) => /inspection\.json$/.test(n));
  rec("S2 hostile address → title/ZIP filenames sanitised", badChars.length === 0 && hasPhoto && hasNotes ? "PASS" : "FAIL", `title="${title.slice(0, 40)}…" entries=${names.length} bad=${JSON.stringify(badChars)} notes=${hasNotes} dlName="${dl.suggestedFilename()}"`);
  // report
  await page.getByRole("button", { name: /Report/ }).click();
  await page.waitForSelector(".ss-report-page", { timeout: 10000 }); await w(page, 500);
  const reportText = await page.locator(".ss-report-page").innerText();
  const reportOk = /kitchen/i.test(reportText) && /mould/i.test(reportText);
  rec("S2 report renders with hostile content", reportOk ? "PASS" : "FAIL", reportOk ? "" : reportText.replace(/\s+/g, " ").slice(0, 700));
  const e = errs(page); if (e.length) rec("S2 console", "FAIL", e.join(" | "));
  await ctx.close();
} catch (e) { rec("S2", "FAIL", e.message); }

// ---------------------------------------------------------------- S3 photo burst, numbering, delete/undo
try {
  const { ctx, page } = await fresh();
  await newCase(page, { rooms: ["Kitchen"] });
  await openRoom(page, "Kitchen");
  const burst = Array.from({ length: 20 }, (_, i) => PHOTOS[i % 3]);
  await addPhotos(page, burst);
  await w(page, 1500);
  const nos = (await page.locator(".ss-cell-no").allInnerTexts()).map(Number).sort((a, b) => a - b);
  const unique = new Set(nos).size === nos.length;
  const okBurst = nos.length === 20 && unique && nos[0] === 1 && nos[19] === 20;
  rec("S3a 20-photo burst → 20 unique exhibit numbers 1..20", okBurst ? "PASS" : "FAIL", `count=${nos.length} unique=${unique} first=${nos[0]} last=${nos[nos.length - 1]}`);
  // delete newest via lightbox, undo, count restored
  await page.locator(".ss-cell").first().click(); await w(page);
  await page.getByRole("button", { name: /Delete photo/ }).click(); await w(page, 400);
  const after = await page.locator(".ss-cell").count();
  const undo = page.getByRole("button", { name: /Undo/ });
  const undoShown = await undo.count();
  if (undoShown) await undo.click();
  await w(page, 400);
  const restored = await page.locator(".ss-cell").count();
  rec("S3b delete → undo restores", after === 19 && restored === 20 ? "PASS" : "FAIL", `afterDelete=${after} undoShown=${!!undoShown} restored=${restored}`);
  // delete, let the undo window lapse, reload → 19 persist
  await page.locator(".ss-cell").first().click(); await w(page);
  await page.getByRole("button", { name: /Delete photo/ }).click(); await w(page, 5600);
  await page.reload({ waitUntil: "networkidle" }); await w(page, 500);
  await page.getByRole("button", { name: /Open case file/i }).click(); await w(page, 500);
  await openRoom(page, "Kitchen");
  const persisted = await page.locator(".ss-cell").count();
  const nos2 = (await page.locator(".ss-cell-no").allInnerTexts()).map(Number);
  // next photo should get 21, not reuse a number
  await addPhotos(page, [PHOTOS[0]]);
  const nos3 = (await page.locator(".ss-cell-no").allInnerTexts()).map(Number);
  rec("S3c delete persists across reload; numbering never reuses", persisted === 19 && Math.max(...nos3) === 21 ? "PASS" : "FAIL", `persisted=${persisted} max after add=${Math.max(...nos3)} (had ${Math.max(...nos2)})`);
  const e = errs(page); if (e.length) rec("S3 console", "FAIL", e.join(" | "));
  await ctx.close();
} catch (e) { rec("S3", "FAIL", e.message); }

// ---------------------------------------------------------------- S4 corrupt + huge files
try {
  const { ctx, page } = await fresh();
  await newCase(page, { rooms: ["Kitchen"] });
  await openRoom(page, "Kitchen");
  fs.writeFileSync(`${S}/notanimage.jpg`, "this is not a jpeg at all, just text pretending");
  await addPhotos(page, [`${S}/notanimage.jpg`]);
  await w(page, 800);
  const alert = await page.locator(".ss-alert").innerText().catch(() => "");
  const cells = await page.locator(".ss-cell").count();
  rec("S4a corrupt file rejected with a message, nothing added", cells === 0 && /couldn't be read/i.test(alert) ? "PASS" : "FAIL", `cells=${cells} alert="${alert.slice(0, 80)}"`);
  // a 6000x4500 image
  const big = await page.evaluate(async () => {
    const c = document.createElement("canvas"); c.width = 6000; c.height = 4500;
    const g = c.getContext("2d"); g.fillStyle = "#8a7"; g.fillRect(0, 0, 6000, 4500); g.fillStyle = "#222"; g.font = "300px sans-serif"; g.fillText("BIG", 200, 600);
    return c.toDataURL("image/jpeg", 0.9);
  });
  fs.writeFileSync(`${S}/huge.jpg`, Buffer.from(big.split(",")[1], "base64"));
  const t0 = Date.now();
  await addPhotos(page, [`${S}/huge.jpg`]); await w(page, 1500);
  const cells2 = await page.locator(".ss-cell").count();
  rec("S4b 6000x4500 photo accepted and downscaled", cells2 === 1 ? "PASS" : "FAIL", `cells=${cells2} in ~${Date.now() - t0}ms, source ${(fs.statSync(`${S}/huge.jpg`).size / 1e6).toFixed(1)}MB`);
  const e = errs(page); if (e.length) rec("S4 console", "FAIL", e.join(" | "));
  await ctx.close();
} catch (e) { rec("S4", "FAIL", e.message); }

// ---------------------------------------------------------------- S5 persistence + immediate reload
try {
  const { ctx, page } = await fresh();
  await newCase(page, { address: "9 Persist Row", rooms: ["Kitchen", "Bathroom"], ref: "REF-9", client: "Acme Homes" });
  await openRoom(page, "Kitchen"); await addPhotos(page, [PHOTOS[0], PHOTOS[1]]);
  await page.getByRole("button", { name: "Poor", exact: true }).click();
  await page.locator(".ss-note-input").first().fill("Ceiling mould, extractor dead");
  await page.locator(".ss-caption").first().fill("Caption typed right before reload");
  // no wait: reload immediately — the debounce must be flushed by pagehide/focusout
  await page.reload({ waitUntil: "networkidle" }); await w(page, 500);
  await page.getByRole("button", { name: /Open case file/i }).click(); await w(page, 500);
  // resumed on the Rooms tab, where the Kitchen room was open before the reload
  const resumedOnRooms = await page.locator(".ss-case-tab.on").innerText().catch(() => "");
  await tab(page, "Overview");
  const overview = await page.locator("body").innerText();
  await openRoom(page, "Kitchen");
  const cap = await page.locator(".ss-caption").first().inputValue();
  const note = await page.locator(".ss-note-input").first().inputValue();
  const poorOn = await page.locator(".ss-cond.poor.on").count();
  const cells = await page.locator(".ss-cell").count();
  const ok = cells === 2 && poorOn === 1 && note.includes("extractor") && cap.includes("before reload") && overview.includes("REF-9") && overview.includes("Acme Homes") && /Rooms/i.test(resumedOnRooms);
  rec("S5 everything survives an immediate reload (caption/note/rating/photos/details); resumes on the same tab", ok ? "PASS" : "FAIL", `cells=${cells} poor=${poorOn} note="${note}" caption="${cap}" resumedTab="${resumedOnRooms}"`);
  const e = errs(page); if (e.length) rec("S5 console", "FAIL", e.join(" | "));
  await ctx.close();
} catch (e) { rec("S5", "FAIL", e.message); }

// ---------------------------------------------------------------- S6 rename + rooms add/reorder
try {
  const { ctx, page } = await fresh();
  await newCase(page, { address: "1 Rename Way", rooms: ["Kitchen", "Bathroom", "Living Room"] });
  await page.getByRole("button", { name: /Edit/ }).click(); await w(page);
  await page.locator('input[placeholder="Address"]').fill("   ");
  const saveDisabled = await page.getByRole("button", { name: "Save" }).isDisabled();
  await page.locator('input[placeholder="Address"]').fill("2 Renamed Close");
  await page.getByRole("button", { name: "Save" }).click(); await w(page);
  const title = await page.locator(".ss-title").first().innerText();
  await tab(page, "Rooms");
  await page.getByRole("button", { name: /Add room/ }).click();
  await page.locator('input[placeholder="Room name"]').fill("Kitchen"); await page.keyboard.press("Enter"); await w(page);
  let names = await page.locator(".ss-row-name").allInnerTexts();
  const dupAdded = names.filter((n) => n === "Kitchen").length === 2;
  // drag first row (Kitchen) to the bottom
  const grips = page.locator(".ss-grip");
  const g0 = await grips.nth(0).boundingBox(); const g3 = await grips.nth(3).boundingBox();
  await page.mouse.move(g0.x + 5, g0.y + 5); await page.mouse.down();
  for (let i = 1; i <= 12; i++) { await page.mouse.move(g0.x + 5, g0.y + 5 + ((g3.y + 20 - g0.y) * i) / 12); await w(page, 25); }
  await page.mouse.up(); await w(page, 400);
  names = await page.locator(".ss-row-name").allInnerTexts();
  await page.reload({ waitUntil: "networkidle" }); await w(page, 500);
  await page.getByRole("button", { name: /Open case file/i }).click(); await w(page, 500);
  await tab(page, "Rooms");
  const after = await page.locator(".ss-row-name").allInnerTexts();
  const reordered = names[0] !== "Kitchen" && JSON.stringify(after) === JSON.stringify(names);
  rec("S6 rename (blank blocked) + add duplicate room + drag reorder persists", saveDisabled && title === "2 Renamed Close" && dupAdded && reordered ? "PASS" : "FAIL", `blankBlocked=${saveDisabled} title="${title}" dup=${dupAdded} order=${JSON.stringify(names)} afterReload=${JSON.stringify(after)}`);
  const e = errs(page); if (e.length) rec("S6 console", "FAIL", e.join(" | "));
  await ctx.close();
} catch (e) { rec("S6", "FAIL", e.message); }

// ---------------------------------------------------------------- S7 walk: swipe bounds, rating toggle, voice memo
try {
  const { ctx, page } = await fresh();
  await newCase(page, { rooms: ["Kitchen", "Bathroom"] });
  await page.getByRole("button", { name: /Start walkthrough/i }).click(); await w(page, 500);
  async function swipe(dx) {
    const box = await page.locator(".ss-live-body").boundingBox();
    const x = box.x + box.width / 2, y = box.y + 40;
    await page.evaluate(({ x, y, dx }) => {
      const el = document.elementFromPoint(x, y);
      const t = (type, cx) => { const tt = new Touch({ identifier: 1, target: el, clientX: cx, clientY: y }); return new TouchEvent(type, { bubbles: true, cancelable: true, touches: type === "touchend" ? [] : [tt], changedTouches: [tt] }); };
      el.dispatchEvent(t("touchstart", x)); el.dispatchEvent(t("touchend", x + dx));
    }, { x, y, dx });
    await w(page, 350);
  }
  const room = () => page.locator(".ss-cap-room").innerText().then((t) => t.trim());
  await swipe(150); const a = await room();          // at start, swipe back → stays Kitchen
  await swipe(-150); const b = await room();         // → Bathroom
  await swipe(-150); const c = await room();         // at end → stays Bathroom
  await swipe(150); const d = await room();          // → Kitchen
  rec("S7a swipe respects both ends", a === "Kitchen" && b === "Bathroom" && c === "Bathroom" && d === "Kitchen" ? "PASS" : "FAIL", `${a} → ${b} → ${c} → ${d}`);
  // the condition control lives inside the camera itself now — no separate tap to open it
  await page.locator(".ss-livecam-cond button", { hasText: "Fair" }).click(); await w(page, 150);
  await page.locator(".ss-livecam-cond button", { hasText: "Fair" }).click(); await w(page, 150);
  const onCount = await page.locator(".ss-livecam-cond button.on").count();
  // voice memo with the fake microphone — filed to the room (no issue yet)
  await page.getByRole("button", { name: /Record voice note/ }).click(); await w(page, 1500);
  const recording = await page.locator(".ss-cap-recording").innerText().catch(() => "");
  await page.getByRole("button", { name: /Stop recording/ }).click(); await w(page, 800);
  const head = await page.locator(".ss-cap-roomno").innerText();
  const memos = /1 voice/.test(head) ? 1 : 0;
  rec("S7b rating toggles off; voice note records via mic", onCount === 0 && memos === 1 && /Recording — Kitchen/.test(recording) ? "PASS" : "FAIL", `ratingOn=${onCount} memos=${memos} head="${head}" recording="${recording}"`);
  // an issue raised in two taps; the next photo lands in it, not the room —
  // the shutter is always live now, no separate tap to open the camera first
  await page.getByRole("button", { name: /Add issue/ }).click(); await w(page, 150);
  await page.locator(".ss-live-iadd input").fill("Ceiling mould"); await page.keyboard.press("Enter"); await w(page, 300);
  const activeTitle = await page.locator(".ss-cap-active-title").innerText();
  await page.locator(".ss-livecam-shutter").click(); await w(page, 800);
  const activeSub = await page.locator(".ss-cap-active-sub").innerText();
  const chip = await page.locator(".ss-live-ichip.on").innerText();
  rec("S7d issue raised while shooting; photo files into the active issue", activeTitle === "Ceiling mould" && /1 photo/.test(activeSub) && /Ceiling mould/.test(chip) ? "PASS" : "FAIL", `active="${activeTitle}" sub="${activeSub}" chip="${chip}"`);
  // the add-issue panel, the note box and the reading form all share one
  // below-camera slot — opening one must close whichever of the other two
  // was already open, never stack
  await page.locator(".ss-live-ichip.add").click(); await w(page, 150);
  const issueOpen = await page.locator(".ss-cap-issuepanel").count();
  await page.locator(".ss-cap-act", { hasText: "Note" }).click(); await w(page, 150);
  const issueGoneAfterNote = await page.locator(".ss-cap-issuepanel").count();
  const noteOpen = await page.locator(".ss-live-note").count();
  // the note textarea is focused (autoFocus); blur it first so the click on
  // Reading isn't racing the blur-triggered re-render of its own panel
  await page.evaluate(() => document.activeElement && document.activeElement.blur());
  await w(page, 100);
  await page.locator(".ss-cap-act", { hasText: "Reading" }).click(); await w(page, 150);
  const noteGoneAfterReading = await page.locator(".ss-live-note").count();
  const readingOpen = await page.locator(".ss-cap-reading").count();
  rec("S7e add-issue/note/reading panels are mutually exclusive, never stacked",
    issueOpen === 1 && issueGoneAfterNote === 0 && noteOpen === 1 && noteGoneAfterReading === 0 && readingOpen === 1 ? "PASS" : "FAIL",
    `issueOpen=${issueOpen} issueGoneAfterNote=${issueGoneAfterNote === 0} noteOpen=${noteOpen} noteGoneAfterReading=${noteGoneAfterReading === 0} readingOpen=${readingOpen}`);
  await page.locator(".ss-cap-reading button[aria-label=Cancel]").click(); await w(page, 150);
  // swipe starting on the note textarea must not change room
  await page.locator(".ss-cap-act", { hasText: "Note" }).click(); await w(page, 200);
  const ta = await page.locator(".ss-live-note").boundingBox();
  await page.evaluate(({ x, y }) => {
    const el = document.elementFromPoint(x, y);
    const t = (type, cx) => { const tt = new Touch({ identifier: 1, target: el, clientX: cx, clientY: y }); return new TouchEvent(type, { bubbles: true, cancelable: true, touches: type === "touchend" ? [] : [tt], changedTouches: [tt] }); };
    el.dispatchEvent(t("touchstart", x)); el.dispatchEvent(t("touchend", x - 200));
  }, { x: ta.x + ta.width / 2, y: ta.y + ta.height / 2 });
  await w(page, 300);
  rec("S7c swipe over the note field does not change room", (await room()) === "Kitchen" ? "PASS" : "FAIL", await room());
  await page.locator(".ss-live-exit").click(); await w(page, 400);
  const e = errs(page); if (e.length) rec("S7 console", "FAIL", e.join(" | "));
  await ctx.close();
} catch (e) { rec("S7", "FAIL", e.message); }

// ---------------------------------------------------------------- S8 multiple cases, numbering, discard, search
try {
  const { ctx, page } = await fresh();
  for (const a of ["1 Alpha Street", "2 Beta Avenue", "3 Gamma Lane"]) {
    await newCase(page, { address: a, rooms: ["Kitchen"] });
    await page.locator(".ss-back").first().click(); await w(page, 400);
  }
  const homeText = await page.locator("body").innerText();
  await page.locator(".ss-tabbar-item", { hasText: "Cases" }).click(); await w(page, 400);
  const count = await page.locator(".ss-badge").first().innerText();
  await page.locator(".ss-search-input").fill("beta"); await w(page, 200);
  const shown = await page.locator(".ss-icard-address").allInnerTexts();
  await page.locator(".ss-search-input").fill("zzz"); await w(page, 200);
  const nothing = (await page.locator("body").innerText()).includes("Nothing matches");
  await page.locator(".ss-search-clear").click(); await w(page, 200);
  await page.getByRole("button", { name: "Discard 2 Beta Avenue" }).click(); await w(page);
  await page.getByRole("button", { name: /Delete inspection/ }).click(); await w(page, 500);
  const remaining = await page.locator(".ss-icard-address").allInnerTexts();
  await page.getByRole("button", { name: /new inspection|different inspection/i }).first().click(); await w(page);
  await page.locator('input[placeholder="23 High Street"]').fill("4 Delta Road");
  await page.getByRole("button", { name: /^Next/ }).click(); await w(page);
  await page.getByText("Kitchen", { exact: true }).first().click();
  await page.getByRole("button", { name: /Start inspection/ }).click(); await w(page, 500);
  const caseNo = await page.locator(".ss-eyebrow-sm").first().innerText();
  rec("S8 three cases → other cases on Home, search, discard, case numbers never reused", /other cases/i.test(homeText) && /3 Gamma Lane/.test(homeText) && /2 Beta Avenue/.test(homeText) && count === "3" && shown.length === 1 && nothing && remaining.length === 2 && /Case No\. 4/i.test(caseNo) ? "PASS" : "FAIL", `badge=${count} search=${JSON.stringify(shown)} noMatchMsg=${nothing} afterDiscard=${JSON.stringify(remaining)} newCase="${caseNo}"`);
  const e = errs(page); if (e.length) rec("S8 console", "FAIL", e.join(" | "));
  await ctx.close();
} catch (e) { rec("S8", "FAIL", e.message); }

// ---------------------------------------------------------------- S9 close inspection guard rails
try {
  const { ctx, page } = await fresh();
  await newCase(page, { address: "5 Closing Court", rooms: ["Kitchen"] });
  await openRoom(page, "Kitchen"); await addPhotos(page, [PHOTOS[0]]); await backToCase(page);
  await tab(page, "Export");
  await page.getByRole("button", { name: /Close inspection/ }).click(); await w(page);
  const modal = await page.locator(".ss-modal").innerText();
  const delBtn = page.getByRole("button", { name: /Delete & close/ });
  const guarded = await delBtn.isDisabled();
  await page.getByRole("button", { name: /Go back and save it first/ }).click(); await w(page);
  const [dl] = await Promise.all([page.waitForEvent("download", { timeout: 20000 }), page.getByRole("button", { name: /Export ZIP/ }).click()]);
  await dl.path(); await w(page, 500);
  await page.getByRole("button", { name: /Close inspection/ }).click(); await w(page);
  const modal2 = await page.locator(".ss-modal").innerText();
  const unguarded = !(await page.getByRole("button", { name: /Delete & close/ }).isDisabled());
  await page.getByRole("button", { name: /Delete & close/ }).click(); await w(page, 800);
  const home = await page.locator("body").innerText();
  await page.locator(".ss-tabbar-item", { hasText: "Cases" }).click(); await w(page, 400);
  const cases = await page.locator("body").innerText();
  const homeEmpty = !/Open case file|Continue walkthrough/.test(home);
  rec("S9 close: blocked until exported/acknowledged; archived as 'Exported only'", guarded && /isn't saved anywhere/.test(modal) && unguarded && /Close this inspection\?/.test(modal2) && homeEmpty && /Exported only/.test(cases) && /5 Closing Court/.test(cases) ? "PASS" : "FAIL", `guarded=${guarded} unguardedAfterExport=${unguarded} homeEmpty=${homeEmpty} archiveShows=${/Exported only/.test(cases)}`);
  const e = errs(page); if (e.length) rec("S9 console", "FAIL", e.join(" | "));
  await ctx.close();
} catch (e) { rec("S9", "FAIL", e.message); }

// ---------------------------------------------------------------- S10 ZIP structure, ID photo, findings tab AI-off
try {
  const { ctx, page } = await fresh();
  await newCase(page, { address: "7 Zip Terrace", rooms: ["Kitchen", "Bathroom"], ref: "Z-7" });
  // ID photo via the hidden capture="user" input (second file input on the overview)
  const inputs = page.locator('input[type="file"]');
  await inputs.last().setInputFiles(PHOTOS[2]); await w(page, 800);
  const idShown = await page.locator(".ss-idphoto img").count();
  await openRoom(page, "Bathroom"); await addPhotos(page, [PHOTOS[0]]);
  await page.locator(".ss-caption").first().fill("Sealant lifting");
  await backToCase(page); await tab(page, "Findings"); await w(page, 500);
  const findings = await page.locator("body").innerText();
  const aiOff = /AI drafting isn't switched on/.test(findings);
  await tab(page, "Export");
  const [dl] = await Promise.all([page.waitForEvent("download", { timeout: 20000 }), page.getByRole("button", { name: /Export ZIP/ }).click()]);
  const zip = await JSZip.loadAsync(fs.readFileSync(await dl.path()));
  const names = Object.keys(zip.files).filter((n) => !zip.files[n].dir);
  const bathroom = names.find((n) => /Site photos\/02\. Bathroom\/01 Bathroom - Sealant lifting\.jpg$/.test(n));
  const kitchenEmpty = !names.some((n) => /01\. Kitchen\//.test(n));
  const idFile = names.find((n) => /\/Inspection\/.*ID/i.test(n));
  const notes = names.find((n) => /inspection\.json$/.test(n));
  const json = notes ? JSON.parse(await zip.file(notes).async("string")) : null;
  rec("S10 ZIP layout: numbered folders, named photos, ID photo outside rooms, notes JSON", bathroom && idFile && notes && json && json.reference === "Z-7" && json.rooms && json.rooms.length === 2 && aiOff ? "PASS" : "FAIL", `idShown=${idShown} entries=${JSON.stringify(names)} ref=${json && json.reference} aiOffMsg=${aiOff}`);
  const e = errs(page); if (e.length) rec("S10 console", "FAIL", e.join(" | "));
  await ctx.close();
} catch (e) { rec("S10", "FAIL", e.message); }

// ---------------------------------------------------------------- S11 settings: field mode persists, camera check
try {
  const { ctx, page } = await fresh();
  await page.locator(".ss-tabbar-item", { hasText: "Settings" }).click(); await w(page, 400);
  await page.locator(".ss-toggle").first().click(); await w(page, 200);
  await page.reload({ waitUntil: "networkidle" }); await w(page, 500);
  const dark = await page.evaluate(() => document.querySelector(".ss-root").classList.contains("ss-field"));
  await page.locator(".ss-tabbar-item", { hasText: "Settings" }).click(); await w(page, 400);
  await page.locator(".ss-toggle").first().click(); await w(page, 200);
  await page.getByRole("button", { name: /Check this phone's camera/ }).click(); await w(page, 1500);
  const report = await page.locator(".ss-camcheck").innerText().catch(() => "");
  rec("S11 field mode persists across reload; camera check reports", dark && /Camera in use/.test(report) ? "PASS" : "FAIL", `fieldModeAfterReload=${dark} camReport="${report.split("\n")[0]}"`);
  const e = errs(page); if (e.length) rec("S11 console", "FAIL", e.join(" | "));
  await ctx.close();
} catch (e) { rec("S11", "FAIL", e.message); }

// ---------------------------------------------------------------- S12 CRM webhook against a real receiver
try {
  const received = [];
  const hook = http.createServer((req, res) => {
    let body = []; req.on("data", (c) => body.push(c)); req.on("end", () => {
      res.setHeader("Access-Control-Allow-Origin", "*"); res.setHeader("Access-Control-Allow-Headers", "*");
      if (req.method === "OPTIONS") { res.statusCode = 204; return res.end(); } // CORS preflight, not a delivery
      const raw = Buffer.concat(body); received.push({ ct: req.headers["content-type"], len: raw.length, kind: (raw.toString("latin1").match(/name="kind"\r\n\r\n([^\r]+)/) || [])[1], key: req.headers["x-make-apikey"] || null });
      res.end("filed");
    });
  }).listen(3100);
  const { ctx, page } = await fresh();
  await page.locator(".ss-tabbar-item", { hasText: "Settings" }).click(); await w(page, 400);
  await page.getByText("CRM / ERP export", { exact: true }).click(); await w(page, 200);
  await page.locator('input[placeholder*="your-crm"]').fill("http://localhost:3100/hook");
  await page.locator('input[placeholder="Access key (optional)"]').fill("secret-key-1");
  await page.getByRole("button", { name: "Save" }).last().click(); await w(page, 300);
  await page.locator(".ss-tabbar-item", { hasText: "Home" }).click(); await w(page, 300);
  await newCase(page, { address: "8 Hook Street", rooms: ["Kitchen"] });
  await openRoom(page, "Kitchen"); await addPhotos(page, [PHOTOS[0], PHOTOS[1]]); await backToCase(page);
  await tab(page, "Export");
  await page.getByRole("button", { name: /Send to your CRM/ }).click(); await w(page, 3000);
  const body = await page.locator("body").innerText();
  const kinds = received.map((r) => r.kind);
  const ok = received.length === 3 && kinds.filter((k) => k === "photo").length === 2 && kinds.includes("notes") && received.every((r) => r.key === "secret-key-1");
  rec("S12 CRM webhook actually delivers photos + notes with the access key", ok ? "PASS" : "FAIL", `received=${received.length} kinds=${JSON.stringify(kinds)} keys=${JSON.stringify(received.map((r) => r.key))} ui="${(body.match(/Filed in the cloud|didn't go through|Upload didn't finish|Everything (filed|sent)[^\n]*/) || [""])[0]}"`);
  const e = errs(page); if (e.length) rec("S12 console", "NOTE", e.join(" | ").slice(0, 300));
  await ctx.close(); hook.close();
} catch (e) { rec("S12", "FAIL", e.message); }

// ---------------------------------------------------------------- S13 offline: shoot, reload offline, still there
try {
  const { ctx, page } = await fresh();
  await newCase(page, { address: "6 Offline Grove", rooms: ["Kitchen"] });
  await w(page, 1500); // let the service worker install
  await ctx.setOffline(true);
  await openRoom(page, "Kitchen"); await addPhotos(page, [PHOTOS[0]]);
  await page.locator(".ss-caption").first().fill("shot with no signal");
  await backToCase(page);
  let reloadOk = true, homeOffline = "";
  try { await page.reload({ waitUntil: "load", timeout: 15000 }); await w(page, 800); homeOffline = await page.locator("body").innerText(); } catch (err) { reloadOk = false; homeOffline = err.message; }
  await ctx.setOffline(false);
  if (!reloadOk) { await page.goto(BASE + "/", { waitUntil: "networkidle" }); await w(page, 500); }
  await page.getByRole("button", { name: /Open case file/i }).click(); await w(page, 500);
  await openRoom(page, "Kitchen");
  const cells = await page.locator(".ss-cell").count();
  const cap = await page.locator(".ss-caption").first().inputValue();
  rec("S13 offline shooting survives; offline reload serves the app shell", cells === 1 && cap === "shot with no signal" && reloadOk ? "PASS" : (cells === 1 ? "NOTE" : "FAIL"), `offlineReloadOk=${reloadOk} cells=${cells} cap="${cap}" ${reloadOk ? "" : "(" + homeOffline.slice(0, 80) + ")"}`);
  const e = errs(page); if (e.length) rec("S13 console", "NOTE", e.join(" | ").slice(0, 300));
  await ctx.close();
} catch (e) { rec("S13", "FAIL", e.message); }

// ---------------------------------------------------------------- S14 two tabs on the same case
try {
  const ctx = await browser.newContext({ viewport: { width: 412, height: 915 }, acceptDownloads: true });
  const a = await ctx.newPage(); await a.goto(BASE + "/", { waitUntil: "networkidle" }); await w(a, 300);
  await newCase(a, { address: "10 Two Tabs", rooms: ["Kitchen"] });
  await openRoom(a, "Kitchen"); await addPhotos(a, [PHOTOS[0]]); await w(a, 800);
  const b = await ctx.newPage(); await b.goto(BASE + "/", { waitUntil: "networkidle" }); await w(b, 300);
  await b.getByRole("button", { name: /Open case file/i }).click(); await w(b, 500);
  await openRoom(b, "Kitchen"); await addPhotos(b, [PHOTOS[1]]); await w(b, 800);
  await addPhotos(a, [PHOTOS[2]]); await w(a, 1200);
  await a.close(); await b.close();
  const c = await ctx.newPage(); await c.goto(BASE + "/", { waitUntil: "networkidle" }); await w(c, 300);
  await c.getByRole("button", { name: /Open case file/i }).click(); await w(c, 500);
  await openRoom(c, "Kitchen");
  const cells = await c.locator(".ss-cell").count();
  rec("S14 same case open in two tabs — photos from both kept?", cells === 3 ? "PASS" : "NOTE", `expected 3, kept ${cells} (last writer wins is a known single-device limitation)`);
  await ctx.close();
} catch (e) { rec("S14", "FAIL", e.message); }

// ---------------------------------------------------------------- S15 server API abuse (local mode)
try {
  const f = (p, o = {}) => fetch(BASE + p, o).then(async (r) => ({ s: r.status, ct: r.headers.get("content-type") || "", t: (await r.text()).slice(0, 80) }));
  const r1 = await f("/api/ai/cases/x/rooms/y/caption", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ room: {}, photos: [{ id: "a", dataUrl: "data:image/jpeg;base64,AAAA" }] }) });
  const r2 = await f("/api/ai/cases/../../etc/rooms/y/draft", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
  const bigBody = JSON.stringify({ room: {}, photos: [{ id: "a", dataUrl: "x".repeat(5 * 1024 * 1024) }] });
  const r3 = await f("/api/ai/cases/c1/rooms/r1/caption", { method: "POST", headers: { "content-type": "application/json" }, body: bigBody });
  const r4 = await f("/api/cases/abc", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
  const r5 = await f("/tesseract/../server/index.js");
  const r6 = await f("/%2e%2e/server/index.js");
  const r7 = await f("/api/ai/cases/c1/rooms/r1/transcribe", { method: "POST", headers: { "content-type": "text/plain" }, body: "hi" });
  const r8 = await f("/api/me", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "x" }) });
  const isSource = (t) => /^\s*import .* from|require\(/m.test(t);
  const okAiOff = r1.s === 501, okTraversal = r2.s === 404 || r2.s === 400, okBig = r3.s === 413 || r3.s === 501, okStaticTraversal = !isSource(r5.t), okEnc = !isSource(r6.t), ok415 = r7.s === 415, okJson404 = r4.s === 404 && /json/.test(r4.ct) && r8.s === 404 && /json/.test(r8.ct);
  rec("S15 API abuse: AI-off 501, traversal, oversize body, wrong content-type 415, JSON 404s, no source leak", okAiOff && okTraversal && okBig && okStaticTraversal && okEnc && ok415 && okJson404 ? "PASS" : "FAIL", `caption(aiOff)=${r1.s} traversalId=${r2.s} 5MB=${r3.s} POST /api/cases/abc=${r4.s} ${r4.ct.split(";")[0]} static..=${r5.s}(shell) enc..=${r6.s}(shell) textToTranscribe=${r7.s} PATCH me(local)=${r8.s} ${r8.ct.split(";")[0]}`);
} catch (e) { rec("S15", "FAIL", e.message); }

// ---------------------------------------------------------------- S16 rooms/areas picker: flat, alphabetical, no category headings
// Regression guard: the picker was once grouped under headings ("Rooms",
// "Services", "Outside", "Whole property & other"), changed to a flat
// alphabetical grid after field feedback that the headings were slower to
// scan on site, then silently regrouped by a later redesign pass that
// carried the old rendering path forward without noticing. Only a human
// re-using the app caught it. This locks the fixed behaviour down so the
// next redesign fails here instead of waiting for someone to notice again.
try {
  const { ctx, page } = await fresh();
  await page.getByRole("button", { name: /new inspection/i }).click(); await w(page);
  await page.locator('input[placeholder="23 High Street"]').fill("1 Test St");
  await page.getByRole("button", { name: /^Next/ }).click(); await w(page);
  // unfiltered: what a surveyor sees the instant this step opens
  const headingsUnfiltered = await page.locator(".ss-section-label").count();
  const chipsUnfiltered = await page.locator(".ss-chip-main").allInnerTexts();
  const sortedUnfiltered = [...chipsUnfiltered].sort((a, b) => a.localeCompare(b));
  const alphaUnfiltered = JSON.stringify(chipsUnfiltered) === JSON.stringify(sortedUnfiltered);
  // filtered: typing narrows the same flat list, never reintroduces headings
  await page.locator('input[placeholder="Filter areas…"]').fill("b"); await w(page, 200);
  const headingsFiltered = await page.locator(".ss-section-label").count();
  const chipsFiltered = await page.locator(".ss-chip-main").allInnerTexts();
  const sortedFiltered = [...chipsFiltered].sort((a, b) => a.localeCompare(b));
  const alphaFiltered = chipsFiltered.length > 0 && JSON.stringify(chipsFiltered) === JSON.stringify(sortedFiltered);
  const ok = headingsUnfiltered === 0 && alphaUnfiltered && headingsFiltered === 0 && alphaFiltered;
  rec("S16 rooms/areas picker stays a flat alphabetical grid, filtered or not", ok ? "PASS" : "FAIL",
    `headingsUnfiltered=${headingsUnfiltered} alphaUnfiltered=${alphaUnfiltered} chips=${chipsUnfiltered.length} headingsFiltered=${headingsFiltered} alphaFiltered=${alphaFiltered} filteredChips=${chipsFiltered.length}`);
  const e = errs(page); if (e.length) rec("S16 console", "FAIL", e.join(" | "));
  await ctx.close();
} catch (e) { rec("S16", "FAIL", e.message); }

// ---------------------------------------------------------------- S17 hardware back button: no data loss, no stuck spinner
// Regression guard, council review 2026-09-24: the Android hardware back
// button was wired through the History API (App.jsx), and two bugs shipped
// with it. (1) The history state it pushed carried only {id} for the open
// inspection; popstate replaced the full in-memory record with that stub,
// which the debounced save then persisted over the real data in IndexedDB —
// silently wiping address, ref, findings, everything but the rooms
// themselves. (2) Two near-identical "loading" entries were pushed at
// startup, so a single back press on Home could strand the app on the
// loading spinner with no way back (the one-time init effect that clears it
// never re-runs). Both are exercised here with page.goBack() — a real
// popstate, not the screen's own on-screen back/exit control.
try {
  const { ctx, page } = await fresh();
  // (2) first back press ever, before any case exists
  await page.goBack(); await w(page, 400);
  const stillUsable = await page.getByRole("button", { name: /new inspection/i }).count();
  rec("S17a back on Home (no case open) doesn't strand the app on the loading spinner", stillUsable > 0 ? "PASS" : "FAIL", `newInspectionButtons=${stillUsable}`);

  // (1) open a case, go into Walk, shoot a photo, then press back — the
  // exact sequence the council review reproduced the corruption with
  await newCase(page, { address: "42 Backbutton Close", postcode: "BB4 2CK", ref: "REF-BACK", rooms: ["Kitchen"] });
  await page.getByRole("button", { name: /Start walkthrough/i }).click(); await w(page, 500);
  await page.locator(".ss-livecam-shutter").click(); await w(page, 800);
  await page.goBack(); await w(page, 500);
  const landedOn = await page.locator(".ss-title").first().innerText().catch(() => "");
  // Walk was started from the Overview tab, so back-to-casefile lands there too
  const landedTab = await page.locator(".ss-case-tab.on").innerText().catch(() => "");
  await page.reload({ waitUntil: "networkidle" }); await w(page, 500);
  const heroTitle = await page.locator(".ss-case-hero-title").first().innerText().catch(() => "");
  const heroSub = await page.locator(".ss-home-hero").first().innerText().catch(() => "");
  const caseNoShown = await page.locator(".ss-home-hero-eyebrow").first().innerText().catch(() => "");
  await page.getByRole("button", { name: /Open case file/i }).click(); await w(page, 500);
  const overview = await page.locator("body").innerText();
  const ok = landedOn === "42 Backbutton Close" && /Overview/i.test(landedTab)
    && heroTitle === "42 Backbutton Close" && /1 photo/.test(heroSub)
    && !/—/.test(caseNoShown)
    && overview.includes("42 Backbutton Close") && overview.includes("REF-BACK");
  rec("S17b back from Walk to CaseFile keeps the real inspection (address/caseNo/ref/photo survive a reload)", ok ? "PASS" : "FAIL",
    `landedOn="${landedOn}" landedTab="${landedTab}" heroTitle="${heroTitle}" heroSub="${heroSub}" caseNo="${caseNoShown}" hasRef=${overview.includes("REF-BACK")}`);
  const e = errs(page); if (e.length) rec("S17 console", "FAIL", e.join(" | "));
  await ctx.close();
} catch (e) { rec("S17", "FAIL", e.message); }

// ---------------------------------------------------------------- S18 report preview alone must not count as "exported"
// Regression guard, council review 2026-09-24: openReport() used to record
// the export the instant the PDF preview opened, before Print/Save was ever
// tapped, which downgraded the close-inspection guard from the
// checkbox-gated "This isn't saved anywhere yet" warning to a soft "Close
// this inspection?" — so a preview-only visit could get a case deleted with
// nothing actually saved anywhere. The marker now only records on an actual
// tap of "Print / Save PDF".
try {
  const { ctx, page } = await fresh();
  await newCase(page, { address: "9 Preview Place", rooms: ["Kitchen"] });
  await openRoom(page, "Kitchen"); await addPhotos(page, [PHOTOS[0]]); await backToCase(page);
  await tab(page, "Export");
  await page.getByRole("button", { name: /Report \(PDF\)/ }).click(); await w(page, 500);
  const reportOpenedTitle = await page.locator("h1").first().innerText().catch(() => "");
  // close the preview without printing — nothing has left the device
  await page.locator(".ss-report-bar .close").click(); await w(page, 300);
  await page.getByRole("button", { name: /Close inspection/ }).click(); await w(page);
  const modalAfterPreviewOnly = await page.locator(".ss-modal").innerText();
  const stillGuarded = await page.getByRole("button", { name: /Delete & close/ }).isDisabled();
  await page.getByRole("button", { name: /Go back and save it first/ }).click(); await w(page);

  // now actually tap Print / Save PDF — this is the real export
  await page.getByRole("button", { name: /Report \(PDF\)/ }).click(); await w(page, 500);
  await page.locator(".ss-report-bar .print").click(); await w(page, 400);
  await page.locator(".ss-report-bar .close").click(); await w(page, 300);
  await page.getByRole("button", { name: /Close inspection/ }).click(); await w(page);
  const modalAfterPrint = await page.locator(".ss-modal").innerText();
  const unguardedAfterPrint = !(await page.getByRole("button", { name: /Delete & close/ }).isDisabled());

  const ok = reportOpenedTitle.includes("9 Preview Place")
    && stillGuarded && /isn't saved anywhere/.test(modalAfterPreviewOnly)
    && unguardedAfterPrint && /Close this inspection\?/.test(modalAfterPrint);
  rec("S18 report preview alone doesn't satisfy the close-inspection safety guard; an actual Print/Save does", ok ? "PASS" : "FAIL",
    `opened=${reportOpenedTitle.includes("9 Preview Place")} guardedAfterPreview=${stillGuarded} modal1="${modalAfterPreviewOnly.slice(0, 60)}" unguardedAfterPrint=${unguardedAfterPrint} modal2="${modalAfterPrint.slice(0, 40)}"`);
  const e18 = errs(page); if (e18.length) rec("S18 console", "FAIL", e18.join(" | "));
  await ctx.close();
} catch (e) { rec("S18", "FAIL", e.message); }

// ---------------------------------------------------------------- S19 finish walkthrough -> Complete screen
// The Complete screen (src/screens/Complete.jsx) — shown once, right after
// "Finish inspection" — was never exercised by this suite (council review
// coverage-gap finding). Covers reaching it, its stats, and both of its
// exits (Review findings / Export report), plus the back arrow returning
// to the case file without re-triggering the finish flow.
try {
  const { ctx, page } = await fresh();
  await newCase(page, { address: "3 Complete Close", rooms: ["Kitchen"] });
  await page.getByRole("button", { name: /Start walkthrough/i }).click(); await w(page, 500);
  await page.locator(".ss-livecam-shutter").click(); await w(page, 800);
  await page.locator(".ss-live-nav .next").click(); await w(page, 400); // single room -> this is "Finish inspection"
  await page.locator(".ss-finish-actions").getByRole("button", { name: /Finish inspection|Finish anyway/ }).click(); await w(page, 500);

  const heading = await page.locator("h1").first().innerText().catch(() => "");
  const stats = await page.locator(".ss-stat-row").innerText().catch(() => "");
  const onComplete = /Inspection complete/.test(heading) && /1/.test(stats);
  rec("S19a finishing the walkthrough reaches the Complete screen with correct stats", onComplete ? "PASS" : "FAIL", `heading="${heading}" stats="${stats.replace(/\n/g, " ")}"`);

  // back arrow returns to the case file, not back into Walk / another finish check
  await page.locator(".ss-back").first().click(); await w(page, 400);
  const backLandedOnCaseTitle = await page.locator(".ss-title").first().innerText().catch(() => "");
  rec("S19b Complete screen's back returns to the case file", backLandedOnCaseTitle === "3 Complete Close" ? "PASS" : "FAIL", `title="${backLandedOnCaseTitle}"`);

  // reach Complete again, this time exit via "Export report"
  await page.getByText("Rooms", { exact: true }).first().click(); await w(page, 300);
  await page.getByRole("button", { name: /Continue walkthrough|Start walkthrough/i }).click(); await w(page, 500);
  await page.locator(".ss-live-nav .next").click(); await w(page, 400);
  await page.locator(".ss-finish-actions").getByRole("button", { name: /Finish inspection|Finish anyway/ }).click(); await w(page, 500);
  await page.getByRole("button", { name: /Export report/ }).click(); await w(page, 500);
  const onExportTab = await page.locator(".ss-case-tab.on").innerText().catch(() => "");
  rec("S19c Complete screen's Export report opens the case file's Export tab", /Export/i.test(onExportTab) ? "PASS" : "FAIL", `tab="${onExportTab}"`);

  const e19 = errs(page); if (e19.length) rec("S19 console", "FAIL", e19.join(" | "));
  await ctx.close();
} catch (e) { rec("S19", "FAIL", e.message); }

// ---------------------------------------------------------------- S20 redesign: checklist, Home's Continue, walk progress
try {
  const { ctx, page } = await fresh();
  await newCase(page, { address: "20 Ring Road", rooms: ["Kitchen", "Bathroom"] });
  await page.getByRole("button", { name: /Start walkthrough/i }).click(); await w(page, 500);
  await page.locator(".ss-livecam-shutter").click(); await w(page, 800);
  await page.locator(".ss-live-exit").click(); await w(page, 400);
  // case overview: the walkthrough as a checklist — Kitchen done, Bathroom up next
  const doneRows = await page.locator(".ss-ov-room.done").count();
  const nextRow = await page.locator(".ss-ov-room.next").innerText().catch(() => "");
  const ring = await page.locator(".ss-ov-progress .ss-ring").getAttribute("aria-label").catch(() => "");
  rec("S20a case overview shows rooms as a checklist with the next room called out", doneRows === 1 && /Bathroom/.test(nextRow) && /Up next/.test(nextRow) && ring === "1 of 2 rooms" ? "PASS" : "FAIL",
    `done=${doneRows} next="${nextRow.replace(/\n/g, " ")}" ring="${ring}"`);
  // Home: the case in hand, with Continue walkthrough going straight to the next room
  await backToCase(page);
  const hero = await page.locator(".ss-home-hero").innerText().catch(() => "");
  await page.getByRole("button", { name: /Continue walkthrough/i }).click(); await w(page, 700);
  const roomNow = (await page.locator(".ss-cap-room").innerText().catch(() => "")).trim();
  const segs = await page.locator(".ss-cap-segs span").count();
  const segsDone = await page.locator(".ss-cap-segs span.done").count();
  const filing = await page.locator(".ss-cap-filing").innerText().catch(() => "");
  const nextBtn = await page.locator(".ss-live-nav .next").innerText().catch(() => "");
  rec("S20b Home's Continue walkthrough lands in the next room; walk shows room progress and where photos go",
    /Next: Bathroom/.test(hero) && roomNow === "Bathroom" && segs === 2 && segsDone === 1 && /Photos go to/i.test(filing) && /Bathroom \(general\)/.test(filing) && /Finish inspection/.test(nextBtn) ? "PASS" : "FAIL",
    `hero="${hero.replace(/\n/g, " ")}" room="${roomNow}" segs=${segs}/${segsDone} filing="${filing.replace(/\n/g, " ")}" next="${nextBtn}"`);
  const e20 = errs(page); if (e20.length) rec("S20 console", "FAIL", e20.join(" | "));
  await ctx.close();
} catch (e) { rec("S20", "FAIL", e.message); }

await browser.close();
console.log("\n==== SUMMARY ====");
for (const r of results) console.log(`${r.status.padEnd(4)} ${r.id}`);
console.log(`PASS ${results.filter((r) => r.status === "PASS").length} · FAIL ${results.filter((r) => r.status === "FAIL").length} · NOTE ${results.filter((r) => r.status === "NOTE").length}`);
fs.writeFileSync(`${S}/e2e-local-results.json`, JSON.stringify(results, null, 2));
