// Adversarial end-to-end pass over SiteSnap in accounts mode (Postgres):
// sign-in codes read from the server log, firm creation, invites accepted on
// a second "phone", the shared register, roles, removal, sign-out, and API
// abuse from a non-admin. Run against a server on BASE with its stdout in LOG.
import { chromium } from "playwright-core";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const BASE = process.env.BASE || "http://localhost:3001";
const LOG = process.env.LOG;
if (!LOG) { console.error("Set LOG to the accounts-mode server's stdout file (sign-in codes are read from it)."); process.exit(2); }
const S = process.env.E2E_TMP || fs.mkdtempSync(path.join(os.tmpdir(), "sitesnap-e2e-"));
let PHOTOS = [];
const results = [];
const rec = (id, status, detail = "") => { results.push({ id, status, detail }); console.log(`${status.padEnd(4)} ${id}${detail ? " — " + detail : ""}`); };
const w = (page, ms = 300) => page.waitForTimeout(ms);
const run = Date.now().toString(36);
const OWNER = `owner-${run}@e2e.test`, MEMBER = `member-${run}@e2e.test`;

function lastCodeFor(email) {
  const log = fs.readFileSync(LOG, "utf8");
  const re = new RegExp(`\\[email → ${email.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\] (\\d{3}) (\\d{3}) is your SiteSnap sign-in code`, "g");
  let m, last = null; while ((m = re.exec(log))) last = m[1] + m[2];
  return last;
}

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || "/opt/pw-browsers/chromium" });

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

async function phone() {
  const ctx = await browser.newContext({ viewport: { width: 412, height: 915 }, acceptDownloads: true });
  const page = await ctx.newPage();
  page.errors = [];
  page.on("pageerror", (e) => page.errors.push("pageerror: " + String(e)));
  page.on("console", (m) => { if (m.type() === "error" && !/ERR_CONNECTION_RESET|fonts\.g|401|403|429/.test(m.text())) page.errors.push(m.text()); });
  return { ctx, page };
}
async function signIn(page, email, { expectWrongFirst = false } = {}) {
  await page.waitForSelector("#ss-email", { timeout: 10000 });
  await page.fill("#ss-email", email);
  await page.getByRole("button", { name: /Email me a code/ }).click();
  await page.waitForSelector(".ss-code-input", { timeout: 10000 }); await w(page, 400);
  const lede = await page.locator(".ss-lede").innerText();
  if (expectWrongFirst) {
    await page.locator(".ss-code-input").fill("000000");
    await page.getByRole("button", { name: /^Sign in$/ }).click(); await w(page, 600);
    const err = await page.locator(".ss-error").innerText().catch(() => "");
    rec("A1b wrong code is rejected with a message", /wrong|incorrect|isn't right|didn't match|try again/i.test(err) ? "PASS" : "FAIL", `"${err}"`);
  }
  const code = lastCodeFor(email);
  if (!code) throw new Error("no code in log for " + email);
  await page.locator(".ss-code-input").fill(code);
  await page.getByRole("button", { name: /^Sign in$/ }).click(); await w(page, 800);
  return lede;
}
async function newCase(page, address, rooms = ["Kitchen"]) {
  await page.getByRole("button", { name: /new inspection|different inspection/i }).first().click(); await w(page);
  await page.locator('input[placeholder="23 High Street"]').fill(address);
  await page.getByRole("button", { name: /^Next/ }).click(); await w(page);
  for (const r of rooms) { await page.getByText(r, { exact: true }).first().click(); await w(page, 80); }
  await page.getByRole("button", { name: /^Next/ }).click(); await w(page);
  await page.getByRole("button", { name: /^Next/ }).click(); await w(page);
  await page.getByRole("button", { name: /Start inspection/ }).click(); await w(page, 500);
}
const api = (page, path, init) => page.evaluate(async ({ path, init }) => { const r = await fetch(path, init); let body = null; try { body = await r.json(); } catch { /* not json */ } return { status: r.status, body }; }, { path, init });

// ---------------------------------------------------------------- A1 gate + sign-in + firm
let owner;
try {
  owner = await phone();
  await owner.page.goto(BASE + "/", { waitUntil: "networkidle" }); await w(owner.page, 400);
  const gated = await owner.page.locator("#ss-email").count();
  const lede = await signIn(owner.page, OWNER, { expectWrongFirst: true });
  const orgScreen = await owner.page.getByRole("button", { name: /Create firm/ }).count();
  const createBtn = owner.page.getByRole("button", { name: /Create firm/ });
  await owner.page.locator('input[placeholder="Firm name"]').fill("E");
  const tooShort = await createBtn.isDisabled();
  await owner.page.locator('input[placeholder="Firm name"]').fill("E2E Surveyors");
  await createBtn.click(); await w(owner.page, 1000);
  const home = await owner.page.locator("body").innerText();
  rec("A1 gate → code sign-in → firm creation", gated === 1 && /server log/.test(lede) && orgScreen === 1 && tooShort && /e2e surveyors/i.test(home) ? "PASS" : "FAIL", `gated=${gated} logNote=${/server log/.test(lede)} orgScreen=${orgScreen} shortNameBlocked=${tooShort} homeHasFirm=${/e2e surveyors/i.test(home)}`);
} catch (e) { rec("A1", "FAIL", e.message); }

// ---------------------------------------------------------------- A2 session survives reload; account card
try {
  const { page } = owner;
  await page.reload({ waitUntil: "networkidle" }); await w(page, 600);
  const stillIn = (await page.locator("#ss-email").count()) === 0;
  await page.locator(".ss-tabbar-item", { hasText: "Settings" }).click(); await w(page, 600);
  const settings = await page.locator("body").innerText();
  await page.locator('input[placeholder="Your name"]').fill("Olivia Owner");
  await page.getByRole("button", { name: "Save" }).first().click(); await w(page, 800);
  const me = await api(page, "/api/me");
  rec("A2 session persists across reload; account card; rename self", stillIn && settings.includes(OWNER) && /owner/i.test(settings) && me.body && me.body.user && me.body.user.name === "Olivia Owner" ? "PASS" : "FAIL", `stillSignedIn=${stillIn} showsEmail=${settings.includes(OWNER)} name=${me.body && me.body.user && me.body.user.name}`);
} catch (e) { rec("A2", "FAIL", e.message); }

// ---------------------------------------------------------------- A3 case gets a server number, syncs to the register
let ownerCaseId = null;
try {
  const { page } = owner;
  await page.locator(".ss-tabbar-item", { hasText: "Home" }).click(); await w(page, 400);
  await newCase(page, "21 Register Road", ["Kitchen", "Bathroom"]);
  await page.getByText("Rooms", { exact: true }).first().click(); await w(page);
  await page.getByText("Kitchen", { exact: false }).first().click(); await w(page);
  await page.locator('input[type="file"]').first().setInputFiles([PHOTOS[0], PHOTOS[1]]); await w(page, 800);
  await page.locator(".ss-caption").first().fill("Mould above hob");
  await page.locator(".ss-back").first().click(); await w(page, 4000); // debounce + push
  const eyebrow = await page.locator(".ss-eyebrow-sm").first().innerText();
  await page.getByText("Overview", { exact: true }).first().click(); await w(page, 500);
  const sync = await page.locator(".ss-sync").innerText().catch(() => "(no sync row)");
  const reg = await api(page, "/api/cases?status=all");
  const c = reg.body && reg.body.cases && reg.body.cases[0];
  ownerCaseId = c && c.id;
  rec("A3 case numbered by the server and present in the register with thumbs", /case no\. 1/i.test(eyebrow) && /firm register/i.test(sync) && c && c.photos === 2 && c.case_no === 1 ? "PASS" : "FAIL", `eyebrow="${eyebrow}" sync="${sync}" register=${JSON.stringify(c && { case_no: c.case_no, photos: c.photos, status: c.status })}`);
} catch (e) { rec("A3", "FAIL", e.message); }

// ---------------------------------------------------------------- A4 invite a colleague; they accept on a second phone
let member, inviteLink = null;
try {
  const { page } = owner;
  await page.locator(".ss-back").first().click(); await w(page, 400);
  await page.locator(".ss-tabbar-item", { hasText: "Settings" }).click(); await w(page, 800);
  await page.locator('input[placeholder="their@email.co.uk"]').fill(MEMBER);
  await page.getByRole("button", { name: "Send invite" }).click(); await w(page, 1200);
  inviteLink = await page.getByLabel("Invitation link").inputValue();
  const pending = await page.locator(".ss-team-pending").count();
  member = await phone();
  await member.page.goto(inviteLink.replace(/^https?:\/\/[^/]+/, BASE), { waitUntil: "networkidle" }); await w(member.page, 800);
  const banner = await member.page.locator(".ss-invite-banner").innerText().catch(() => "");
  const prefilled = await member.page.locator("#ss-email").inputValue();
  await signIn(member.page, MEMBER);
  await w(member.page, 1200);
  const memberHome = await member.page.locator("body").innerText();
  const joined = /e2e surveyors/i.test(memberHome) && !(await member.page.getByRole("button", { name: /Create firm/ }).count());
  rec("A4 invite link → banner + prefilled email → sign in → auto-joins the firm", /^https?:\/\//.test(inviteLink) && pending === 1 && /e2e surveyors/i.test(banner) && prefilled === MEMBER && joined ? "PASS" : "FAIL", `link=${!!inviteLink} pending=${pending} banner="${banner.slice(0, 60)}" prefilled=${prefilled === MEMBER} joined=${joined}`);
} catch (e) { rec("A4", "FAIL", e.message); }

// ---------------------------------------------------------------- A5 the register is shared; remote case is read-only and complete
try {
  const { page } = member;
  await page.locator(".ss-tabbar-item", { hasText: "Cases" }).click(); await w(page, 1500);
  const cases = await page.locator("body").innerText();
  const elsewhere = /elsewhere in the firm/i.test(cases) && /21 Register Road/.test(cases);
  await page.getByText("21 Register Road", { exact: false }).first().click(); await w(page, 1200);
  const remote = await page.locator("body").innerText();
  const thumbs = await page.locator(".ss-remote-thumb img").count();
  const thumbOk = thumbs ? (await page.evaluate(async () => { const img = document.querySelector(".ss-remote-thumb img"); const r = await fetch(img.src); return r.status; })) : null;
  rec("A5 colleague sees the case in the register; remote view has rooms, caption, thumbnails", elsewhere && /by olivia owner/i.test(remote) && /Mould above hob/.test(remote) && thumbs === 2 && thumbOk === 200 ? "PASS" : "FAIL", `elsewhere=${elsewhere} by=${/by olivia owner/i.test(remote)} caption=${/Mould above hob/.test(remote)} thumbs=${thumbs} thumbFetch=${thumbOk}`);
  if (page.errors.length) rec("A5 console", "NOTE", page.errors.splice(0).join(" | ").slice(0, 300));
} catch (e) { rec("A5", "FAIL", e.message); }

// ---------------------------------------------------------------- A6 surveyor tries admin + cross-user actions
try {
  const { page } = member;
  const inv = await api(page, "/api/org/invites", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: "x@y.z", role: "admin" }) });
  const members = await api(page, "/api/org/members");
  const audit = await api(page, "/api/org/audit");
  const rename = await api(page, "/api/org", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "Hacked" }) });
  const delOther = await api(page, `/api/cases/${encodeURIComponent(ownerCaseId)}`, { method: "DELETE" });
  const putOther = await api(page, `/api/cases/${encodeURIComponent(ownerCaseId)}`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ address: "Overwritten by colleague", status: "open", doc: { rooms: [] }, photos: [] }) });
  const after = await api(page, `/api/cases/${encodeURIComponent(ownerCaseId)}`);
  const stillOwners = after.body && after.body.case && after.body.case.address === "21 Register Road";
  rec("A6 surveyor blocked from admin endpoints", inv.status === 403 && rename.status === 403 && audit.status === 403 && members.status === 200 ? "PASS" : "FAIL", `invite=${inv.status} rename=${rename.status} audit=${audit.status} members(list)=${members.status}`);
  rec("A6b surveyor cannot delete or overwrite a colleague's case", delOther.status >= 400 && putOther.status >= 400 && stillOwners ? "PASS" : "FAIL", `delete=${delOther.status} overwrite=${putOther.status} addressAfter="${after.body && after.body.case && after.body.case.address}" exists=${after.status}`);
} catch (e) { rec("A6", "FAIL", e.message); }

// ---------------------------------------------------------------- A6c the AI routes: evidence ownership, approval authority, idempotent replay
// (needs AI_MOCK=1 on the server; with drafting off every call answers 501 and the scenario reports NOTE)
try {
  const { page } = owner;
  const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
  const cfg = await api(page, "/api/ai/config");
  if (!(cfg.body && cfg.body.enabled)) rec("A6c AI routes", "NOTE", "drafting is off on this server (no AI_MOCK / key) — ownership checks not exercised");
  else {
    const full = await api(page, `/api/cases/${encodeURIComponent(ownerCaseId)}`);
    const doc = full.body.case.doc;
    const room = doc.rooms[0];
    const photoIds = full.body.case.photos.map((p) => p.id);
    const json = (body) => ({ method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const draftPath = (issueId) => `/api/ai/cases/${encodeURIComponent(ownerCaseId)}/rooms/${encodeURIComponent(room.id)}/issues/${encodeURIComponent(issueId)}/draft`;
    const issue = { id: "iss_e2e_mould1", title: "Ceiling mould", description: "Mould to ceiling above hob", descriptionSource: "human_typed", humanSuspectedCause: "condensation", confirmedBySurveyor: true, createdBy: "surveyor", status: "open", evidence: photoIds.map((id) => ({ id, kind: "photo", source: "capture_session" })) };
    const body = (over = {}) => ({ requestId: "77777777-7777-4777-8777-777777777777", snapshot: "fp-e2e", issue, room: { name: room.name, note: "", condition: "Poor" }, photos: photoIds.map((id, i) => ({ id, no: i + 1, caption: "", dataUrl: PNG, linkSource: "capture_session" })), memos: [], ...over });
    // the register does not know this issue yet → refused
    const unknownIssue = await api(page, draftPath(issue.id), json(body()));
    // put the issue into the register's copy of the room (the phone's sync does this)
    const doc2 = { ...doc, rooms: doc.rooms.map((r) => (r.id === room.id ? { ...r, issues: [issue], modelVersion: 2 } : r)) };
    await api(page, `/api/cases/${encodeURIComponent(ownerCaseId)}`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ address: full.body.case.address, status: "open", doc: doc2, photos: full.body.case.photos.map((p) => ({ id: p.id, roomId: p.room_id, no: p.no, caption: p.caption })) }) });
    // a photograph that is not in this case → refused
    const foreign = await api(page, draftPath(issue.id), json(body({ photos: [{ id: "ph_not_mine", no: 9, dataUrl: PNG, linkSource: "capture_session" }] })));
    // a colleague drafting on the owner's case → refused
    const colleague = await api(member.page, draftPath(issue.id), json(body()));
    // the owner, correctly → a finding and a run
    const ok = await api(page, draftPath(issue.id), json(body()));
    const replay = await api(page, draftPath(issue.id), json(body()));
    const fid = ok.body && ok.body.finding && ok.body.finding.id;
    const put = (who, b) => api(who, `/api/ai/findings/${encodeURIComponent(fid)}`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(b) });
    const colleagueApprove = fid ? await put(member.page, { status: "approved", snapshot: "fp-e2e" }) : { status: 0 };
    const staleApprove = fid ? await put(page, { status: "approved", snapshot: "fp-other" }) : { status: 0 };
    const edited = fid ? await put(page, { status: "edited", reviewed: { defect: "my wording" } }) : { status: 0 };
    const approve = fid ? await put(page, { status: "approved", snapshot: "fp-e2e" }) : { status: 0 };
    const listed = await api(page, `/api/ai/cases/${encodeURIComponent(ownerCaseId)}/findings?approved=1`);
    const run = ok.body && ok.body.run ? await api(page, `/api/ai/cases/${encodeURIComponent(ownerCaseId)}/runs/${ok.body.run.id}`) : { status: 0 };
    rec("A6c draft refused for an unknown issue, a foreign photo, and a colleague", unknownIssue.status === 403 && foreign.status === 403 && colleague.status === 403 ? "PASS" : "FAIL", `unknownIssue=${unknownIssue.status}/${unknownIssue.body && unknownIssue.body.error} foreign=${foreign.status}/${foreign.body && foreign.body.error} colleague=${colleague.status}/${colleague.body && colleague.body.error}`);
    rec("A6d owner drafts; a retry with the same request id is replayed, not re-run", ok.status === 200 && ok.body.finding.status === "draft" && replay.status === 200 && replay.body.replayed === true ? "PASS" : "FAIL", `draft=${ok.status} gate=${ok.body && ok.body.finding && ok.body.finding.gate.status} replayed=${replay.body && replay.body.replayed}`);
    rec("A6e approval: colleague 403, stale snapshot 409, edit ≠ approve, owner approves, only approved listed, run record retrievable",
      colleagueApprove.status === 403 && staleApprove.status === 409 && edited.status === 200 && approve.status === 200 && listed.body && listed.body.findings.length === 1 && listed.body.findings[0].status === "approved" && run.status === 200 && run.body.run.pipeline && run.body.run.pipeline.prompts ? "PASS" : "FAIL",
      `colleague=${colleagueApprove.status} stale=${staleApprove.status}/${staleApprove.body && staleApprove.body.error} edited=${edited.status} approve=${approve.status} listedApproved=${listed.body && listed.body.findings.length} run=${run.status}`);
  }
} catch (e) { rec("A6c", "FAIL", e.message); }

// ---------------------------------------------------------------- A7 member's own case appears for the owner; owner promotes then removes
try {
  await member.page.locator(".ss-back").first().click().catch(() => {}); await w(member.page, 300);
  await member.page.locator(".ss-tabbar-item", { hasText: "Home" }).click(); await w(member.page, 400);
  await newCase(member.page, "5 Colleague Close");
  await w(member.page, 3500);
  const memberEyebrow = await member.page.locator(".ss-eyebrow-sm").first().innerText();
  const { page } = owner;
  await page.locator(".ss-tabbar-item", { hasText: "Cases" }).click(); await w(page, 1500);
  const ownerCases = await page.locator("body").innerText();
  await page.locator(".ss-tabbar-item", { hasText: "Settings" }).click(); await w(page, 1000);
  const rows = await page.locator(".ss-team-row").count();
  await page.getByLabel(`Role for ${MEMBER}`).selectOption("admin"); await w(page, 1000);
  await member.page.locator(".ss-back").first().click().catch(() => {}); await w(member.page, 300);
  await member.page.reload({ waitUntil: "load", timeout: 15000 }); await w(member.page, 800);
  await member.page.locator(".ss-tabbar-item", { hasText: "Settings" }).click(); await w(member.page, 1000);
  const memberSeesTeam = await member.page.locator('input[placeholder="their@email.co.uk"]').count();
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: `Remove ${MEMBER}` }).click(); await w(page, 1200);
  const rowsAfter = await page.locator(".ss-team-row").count();
  const memberMe = await api(member.page, "/api/me");
  await member.page.reload({ waitUntil: "load", timeout: 15000 }); await w(member.page, 800);
  const memberGate = await member.page.getByRole("button", { name: /Create firm/ }).count();
  rec("A7 colleague's case numbered 2 + visible to owner; promote to admin works; removal drops them to the firm gate", /case no\. 2/i.test(memberEyebrow) && /5 Colleague Close/.test(ownerCases) && rows === 2 && memberSeesTeam === 1 && rowsAfter === 1 && memberMe.body && !memberMe.body.org && memberGate === 1 ? "PASS" : "FAIL", `memberCase="${memberEyebrow}" ownerSees=${/5 Colleague Close/.test(ownerCases)} teamRows=${rows}→${rowsAfter} memberSawTeamAfterPromotion=${memberSeesTeam} orgAfterRemoval=${JSON.stringify(memberMe.body && memberMe.body.org)} gate=${memberGate}`);
} catch (e) { rec("A7", "FAIL", e.message); }

// ---------------------------------------------------------------- A8 invite reuse, rate limit, sign-out
try {
  const { page } = owner;
  const reuse = await api(member.page, "/api/invites/accept", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token: (inviteLink.match(/[?&#]invite=([^&]+)/) || inviteLink.match(/invite\/([^/?#]+)/) || [])[1] || "x" }) });
  await page.locator(".ss-tabbar-item", { hasText: "Settings" }).click(); await w(page, 800);
  await page.getByRole("button", { name: /^Sign out$/ }).click(); await w(page, 1000);
  const gate = await page.locator("#ss-email").count();
  const me = await api(page, "/api/me");
  rec("A8 spent invite rejected; sign-out clears the session", reuse.status >= 400 && gate === 1 && me.body && !me.body.user ? "PASS" : "FAIL", `inviteReuse=${reuse.status} gate=${gate} meUser=${JSON.stringify(me.body && me.body.user)}`);
  if (owner.page.errors.length) rec("A8 console", "NOTE", owner.page.errors.splice(0).join(" | ").slice(0, 300));
} catch (e) { rec("A8", "FAIL", e.message); }

// ---------------------------------------------------------------- A9 another person on the same phone can't see the first person's cases
try {
  const { page } = owner; // signed out now, same browser profile
  await signIn(page, `second-${run}@e2e.test`);
  await page.locator('input[placeholder="Firm name"]').fill("Other Firm Ltd");
  await page.getByRole("button", { name: /Create firm/ }).click(); await w(page, 1000);
  const home = await page.locator("body").innerText();
  await page.locator(".ss-tabbar-item", { hasText: "Cases" }).click(); await w(page, 1000);
  const cases = await page.locator("body").innerText();
  const leak = /21 Register Road|5 Colleague Close/.test(home + cases);
  rec("A9 a different user on the same device sees none of the previous user's cases", !leak && /other firm ltd/i.test(home) ? "PASS" : "FAIL", `leak=${leak} firm=${/other firm ltd/i.test(home)}`);
} catch (e) { rec("A9", "FAIL", e.message); }

// ---------------------------------------------------------------- A10 sign-in code requests are rate-limited per IP (last: it locks this IP out)
try {
  const { page } = owner;
  const codes = [];
  for (let i = 0; i < 24; i++) codes.push((await api(page, "/api/auth/code", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: `flood${i}-${run}@e2e.test` }) })).status);
  const first429 = codes.indexOf(429);
  rec("A10 sign-in code requests rate-limited per IP", first429 > 0 && first429 <= 21 ? "PASS" : "FAIL", `first 429 after ${first429 < 0 ? "never" : first429} requests`);
} catch (e) { rec("A10", "FAIL", e.message); }

await browser.close();
console.log("\n==== SUMMARY ====");
for (const r of results) console.log(`${r.status.padEnd(4)} ${r.id}`);
console.log(`PASS ${results.filter((r) => r.status === "PASS").length} · FAIL ${results.filter((r) => r.status === "FAIL").length} · NOTE ${results.filter((r) => r.status === "NOTE").length}`);
fs.writeFileSync(`${S}/e2e-accounts-results.json`, JSON.stringify(results, null, 2));
