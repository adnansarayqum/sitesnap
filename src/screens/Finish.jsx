import { useEffect, useState } from "react";
import {
  AlertTriangle, CircleCheck, Clock, CloudUpload, Download, ExternalLink, FileText, FolderTree, ImagePlus, Loader2, MapPin, StickyNote, Trash2, X,
} from "lucide-react";
import JSZip from "jszip";
import {
  loadWebhook, saveWebhook, loadWebhookKey, saveWebhookKey, loadMsClientId, loadGoogleClientId,
} from "../storage.js";
import { loadGoogleDrive, loadMsGraph } from "../cloud/lazy.js";
import { linkedAccount } from "../cloud/service.js";
import { extFor } from "../components/VoiceMemo.jsx";
import { canShareFiles, dataUrlToFile } from "../lib/image.js";
import { pad, safeFileName } from "../lib/util.js";
import { ReportView } from "./Report.jsx";
import { approvedByRoom, findingsFiles, fromLegacyDraft } from "../findings.js";
import { Coach } from "../components/Hints.jsx";

// the ID photo files beside the inspection metadata, never in a room folder
export const idPhotoName = (inspection) => `ID ${safeFileName(inspection.postcode || inspection.address || "photo")}.jpg`;

export function describeHttp(status) {
  if (status === 401 || status === 403) return "The upload link rejected the access key.";
  if (status === 404 || status === 410) return "The upload link no longer exists, or its scenario is switched off.";
  if (status === 413) return "A photo was too large for the upload link to accept.";
  if (status === 429) return "The upload service is rate-limiting — it may be out of monthly operations.";
  if (status >= 500) return `The upload service returned an error (${status}).`;
  return `The upload link refused the request (${status}).`;
}

// The AI drafting step (docs/cloud-workflow.md) can reply to the notes POST
// with its structured findings instead of a plain status string. Anything
// that doesn't parse as that shape is left alone — most workflows still
// just reply "Accepted" or "filed", and that's fine.
export function parseDraftFindings(body) {
  if (!body) return null;
  let json;
  try { json = JSON.parse(body); } catch { return null; }
  if (!json || !Array.isArray(json.rooms)) return null;
  const ok = json.rooms.every((r) => r && typeof r.room_name === "string" && Array.isArray(r.findings));
  return ok ? json : null;
}

/* ---------------- finish / export ---------------- */

export function FinishScreen({ inspection, rooms, photoCache, totalPhotos, filesForRoom, filesForUpload, fullPhoto, audioCache, onUploadResult, onExportResult, onFindings, onSaveAll, onDone, filing, onFiled }) {
  const [note, setNote] = useState(null);
  const [direct, setDirect] = useState({ ms: null, google: false }); // account name / connected flags
  const [directUpload, setDirectUpload] = useState(null); // { provider, statuses, running, sent, total }
  const [directError, setDirectError] = useState(null);

  useEffect(() => {
    (async () => {
      // a link made through the cloud-link service needs no library loaded
      // and no silent re-request — it just is connected
      const msLink = await linkedAccount("onedrive");
      const msId = await loadMsClientId();
      const acc = msLink ? { username: msLink.account || "OneDrive" } : (msId ? await (await loadMsGraph()).msAccount(msId) : null);
      // A silent (no-popup) request picks the Google connection back up if
      // the browser still has a live session — never worth attempting if
      // Google was never configured for this device at all.
      const googleLink = await linkedAccount("google");
      const googleId = await loadGoogleClientId();
      const googleOn = googleLink ? true : (googleId ? await (await loadGoogleDrive()).trySilentGoogleReconnect(googleId) : false);
      setDirect({ ms: acc ? acc.username : null, google: googleOn });
    })();
  }, []);
  const [reportCache, setReportCache] = useState(null); // full-size copies, only while the report is open
  const [reportBusy, setReportBusy] = useState(false);

  async function openReport() {
    if (reportBusy) return;
    setReportBusy(true);
    try {
      const ids = rooms.flatMap((r) => r.photoIds);
      const entries = await Promise.all(ids.map(async (id) => [id, await fullPhoto(id)]));
      const cache = {};
      entries.forEach(([id, p]) => { if (p) cache[id] = p; });
      setReportCache(cache);
      setReportOpen(true);
      onExportResult && onExportResult({ at: Date.now(), kind: "report" });
    } finally {
      setReportBusy(false);
    }
  }
  function closeReport() {
    setReportOpen(false);
    setReportCache(null);
  }
  const [zipBusy, setZipBusy] = useState(false);
  const [hookUrl, setHookUrl] = useState("");
  const [hookKey, setHookKey] = useState("");
  const [upload, setUpload] = useState(null); // { statuses, running, doneAll, sent, total }
  const [reportOpen, setReportOpen] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);
  const [acceptLoss, setAcceptLoss] = useState(false);
  const [uploadError, setUploadError] = useState(null);
  const populated = rooms.filter((r) => r.photoIds.length > 0);

  useEffect(() => {
    loadWebhook().then((u) => setHookUrl(u || ""));
    loadWebhookKey().then((k) => setHookKey(k || ""));
  }, []);

  function flash(msg, ms = 3500) {
    setNote(msg);
    setTimeout(() => setNote(null), ms);
  }

  function safeName(s) {
    return s.replace(/[\\/:*?"<>|]/g, "-").trim();
  }

  // The structured record of the inspection — what the ZIP, the drive upload
  // and a CRM receiver all get as _Inspection/inspection.json, so the notes,
  // ratings and captions travel with the photos rather than living only in
  // the filenames.
  function inspectionNotes() {
    return {
      inspectionId: inspection.id, address: inspection.address, postcode: inspection.postcode || "",
      reference: inspection.ref || "", client: inspection.client || "", occupier: inspection.occupier || "",
      solicitor: inspection.solicitor || "", inspectedAt: new Date(inspection.startedAt).toISOString(), totalPhotos,
      rooms: rooms.map((r, i) => ({
        order: i + 1, folder: `${pad(i + 1)}. ${r.name}`, room: r.name, condition: r.condition || "",
        note: (r.note || "").trim(), hypothesis: (r.hypothesis || "").trim(), photos: r.photoIds.length, voiceNotes: (r.memos || []).length,
        photoNumbers: r.photoIds.map((id) => photoCache[id] && photoCache[id].no).filter(Boolean),
        captions: r.photoIds.map((id) => photoCache[id]).filter(Boolean).map((p) => ({ no: p.no || null, caption: p.caption || "" })),
      })),
    };
  }
  const notesJsonFile = () => new File([JSON.stringify(inspectionNotes(), null, 2)], "inspection.json", { type: "application/json" });

  async function handleSaveAll() {
    const res = await onSaveAll();
    if (res.ok) { onExportResult && onExportResult({ at: Date.now(), kind: "photos" }); flash("All photos saved to your Photos app"); }
    else if (res.reason === "unsupported") flash("Bulk save needs the phone share sheet — on desktop use the ZIP export");
    else if (res.reason !== "cancelled") flash("Couldn't save — try again");
  }

  async function exportZip() {
    if (zipBusy) return;
    setZipBusy(true);
    try {
      const zip = new JSZip();
      const rootName = safeName(`${inspection.address}${inspection.postcode ? " " + inspection.postcode : ""}`) || "Inspection";
      const root = zip.folder(rootName);
      for (const [i, room] of rooms.entries()) {
        if (!room.photoIds.length) continue;
        const folder = root.folder(`${pad(i + 1)}. ${safeName(room.name)}`);
        (await filesForRoom(room)).forEach((f) => folder.file(f.name, f));
      }
      // the notes record, any approved findings, and the ID photo — all in
      // _Inspection/ beside the rooms, never inside one: the same layout the
      // drive upload produces, so a ZIP dropped into OneDrive is indistinguishable
      const meta = root.folder("_Inspection");
      meta.file("inspection.json", notesJsonFile());
      findingsFiles(inspection.findings, rooms).forEach((f) => meta.file(f.name, f));
      if (inspection.idPhotoId) {
        const p = await fullPhoto(inspection.idPhotoId);
        if (p && p.dataUrl) meta.file(idPhotoName(inspection), dataUrlToFile(p.dataUrl, idPhotoName(inspection)));
      }
      const blob = await zip.generateAsync({ type: "blob" });
      const fileName = `${rootName}.zip`;
      const zipFile = new File([blob], fileName, { type: "application/zip" });
      if (canShareFiles() && navigator.canShare({ files: [zipFile] })) {
        try {
          await navigator.share({ files: [zipFile], title: fileName });
          onExportResult && onExportResult({ at: Date.now(), kind: "zip" });
          flash("ZIP shared — folder structure is inside");
          setZipBusy(false);
          return;
        } catch (e) {
          if (e && e.name === "AbortError") { setZipBusy(false); return; }
        }
      }
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
      onExportResult && onExportResult({ at: Date.now(), kind: "zip" });
      flash("ZIP downloaded — folder structure is inside");
    } catch (e) {
      console.error(e);
      flash("ZIP export failed — try again");
    }
    setZipBusy(false);
  }

  // One POST per item, each tagged with `kind` so the cloud workflow can route
  // it: photos are filed, voice notes are transcribed, and the single notes
  // payload is what the AI drafting step reads.
  // A 2xx only proves the workflow accepted the upload for processing — with
  // Make's default reply ("Accepted") the file may still fail to reach the
  // drive afterwards. A workflow that answers after it has filed the item
  // returns something else, and that is the only response we treat as proof.
  async function postToHook(url, key, fd) {
    const headers = key ? { "x-make-apikey": key } : undefined;
    let reason = "The upload didn't go through.";
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const res = await fetch(url, { method: "POST", body: fd, headers });
        if (res.ok) {
          let body = "";
          try { body = (await res.text()).trim(); } catch { /* opaque body */ }
          const queuedOnly = body === "" || body.toLowerCase() === "accepted";
          return { ok: true, confirmed: !queuedOnly, body };
        }
        reason = describeHttp(res.status);
        // don't retry a rejection the server will just repeat
        if (res.status >= 400 && res.status < 500 && res.status !== 408 && res.status !== 429) {
          return { ok: false, confirmed: false, reason };
        }
      } catch (e) {
        reason = navigator.onLine === false
          ? "No internet connection."
          : "Couldn't reach the upload link — the connection dropped or the address is wrong.";
      }
    }
    return { ok: false, confirmed: false, reason };
  }

  // A workflow that transcribes audio can hand the words straight back in its
  // response instead of them living only as a stray file in OneDrive. Treat
  // anything that isn't one of the two known status replies as a transcript.
  function looksLikeTranscript(body) {
    if (!body) return false;
    const s = body.trim().toLowerCase();
    return s !== "" && s !== "accepted" && s !== "filed";
  }

  function baseFields(fd) {
    fd.append("address", inspection.address);
    fd.append("postcode", inspection.postcode || "");
    fd.append("inspectionId", inspection.id);
    return fd;
  }

  async function uploadViaWebhook() {
    try {
      await runUpload();
    } catch (e) {
      // never let an unexpected fault take the screen down mid-inspection
      console.error(e);
      setUpload((s) => s && ({ ...s, running: false }));
      setUploadError("Something went wrong during the upload. Nothing has been deleted — your photos are still on this phone.");
    }
  }

  async function runUpload() {
    const url = hookUrl.trim();
    if (!url) { flash("Set a cloud upload link in Settings first"); return; }
    if (upload && upload.running) return;
    saveWebhook(url);
    const key = hookKey.trim();
    saveWebhookKey(key);
    const statuses = {};
    populated.forEach((r) => { statuses[r.id] = "queued"; });
    const memoCount = rooms.reduce((s, r) => s + (r.memos || []).length, 0);
    const total = populated.reduce((s, r) => s + r.photoIds.length, 0) + memoCount + 1;
    setUpload({ statuses, running: true, doneAll: false, sent: 0, total });
    let anyFailed = false;
    let allConfirmed = true;
    let failReason = null;
    for (const room of populated) {
      const idx = rooms.indexOf(room);
      setUpload((s) => s && ({ ...s, statuses: { ...s.statuses, [room.id]: "uploading" } }));
      let ok = true;
      const files = await filesForUpload(room);
      for (const f of files) {
        const fd = baseFields(new FormData());
        fd.append("kind", "photo");
        fd.append("folder", `${pad(idx + 1)}. ${room.name}`);
        // the bare name matches the SOURCE column in the report workbook
        fd.append("room", room.name);
        fd.append("filename", f.name);
        fd.append("condition", room.condition || "");
        fd.append("note", room.note || "");
        fd.append("file", f, f.name);
        const r = await postToHook(url, key, fd);
        if (!r.ok) { ok = false; failReason = failReason || r.reason; break; }
        if (!r.confirmed) allConfirmed = false;
        setUpload((s) => s && ({ ...s, sent: s.sent + 1 }));
      }
      if (!ok) anyFailed = true;
      setUpload((s) => s && ({ ...s, statuses: { ...s.statuses, [room.id]: ok ? "done" : "failed" } }));
    }

    // voice notes — each one goes up for transcription. If the workflow
    // hands the transcript straight back in its response, fold it into that
    // room's note now, before the notes payload below is built — otherwise
    // the AI drafting step never sees anything the surveyor only said aloud.
    const transcriptsByRoom = {};
    for (const room of rooms) {
      const idx = rooms.indexOf(room);
      for (const m of room.memos || []) {
        const blob = audioCache.current[m.id];
        if (!blob) continue;
        const name = `${safeName(room.name).replace(/\s+/g, "_")}_note_${extFor(m.type)}`;
        const fd = baseFields(new FormData());
        fd.append("kind", "audio");
        fd.append("folder", `${pad(idx + 1)}. ${room.name}`);
        fd.append("room", room.name);
        fd.append("filename", `${name}.${extFor(m.type)}`);
        fd.append("seconds", String(m.secs || 0));
        fd.append("file", blob, `${name}.${extFor(m.type)}`);
        const r = await postToHook(url, key, fd);
        if (!r.ok) { anyFailed = true; failReason = failReason || r.reason; }
        else {
          if (!r.confirmed) allConfirmed = false;
          if (looksLikeTranscript(r.body)) {
            transcriptsByRoom[room.id] = [transcriptsByRoom[room.id], r.body.trim()].filter(Boolean).join(" ");
          }
          setUpload((s) => s && ({ ...s, sent: s.sent + 1 }));
        }
      }
    }

    // one structured payload for the whole inspection — this is what the AI
    // drafting step reads, so it runs once per property rather than per photo
    const payload = {
      inspectionId: inspection.id,
      address: inspection.address,
      postcode: inspection.postcode || "",
      reference: inspection.ref || "",
      client: inspection.client || "",
      occupier: inspection.occupier || "",
      solicitor: inspection.solicitor || "",
      inspectedAt: new Date(inspection.startedAt).toISOString(),
      totalPhotos,
      rooms: rooms.map((r, i) => ({
        order: i + 1,
        folder: `${pad(i + 1)}. ${r.name}`,
        room: r.name,
        condition: r.condition || "",
        note: [r.note && r.note.trim(), transcriptsByRoom[r.id]].filter(Boolean).join(" "),
        photos: r.photoIds.length,
        voiceNotes: (r.memos || []).length,
        // photo numbers so findings can cite them without matching by hand
        photoNumbers: r.photoIds.map((id) => photoCache[id] && photoCache[id].no).filter(Boolean),
      })),
      // what the surveyor approved in the Findings tab — the workbook can
      // take these straight into the schedule
      findings: approvedByRoom(inspection.findings, rooms),
    };
    if (inspection.idPhotoId) {
      const p = await fullPhoto(inspection.idPhotoId);
      if (p && p.dataUrl) {
        const ifd = baseFields(new FormData());
        ifd.append("kind", "photo");
        ifd.append("folder", "_Inspection");
        ifd.append("room", "ID");
        ifd.append("filename", idPhotoName(inspection));
        ifd.append("file", dataUrlToFile(p.dataUrl, idPhotoName(inspection)), idPhotoName(inspection));
        const r = await postToHook(url, key, ifd);
        if (!r.ok) { anyFailed = true; failReason = failReason || r.reason; }
      }
    }
    const nfd = baseFields(new FormData());
    nfd.append("kind", "notes");
    // a folder so this still files sensibly against a workflow that has no
    // routing yet and builds its path from address/folder/filename
    nfd.append("folder", "_Inspection");
    nfd.append("filename", "inspection.json");
    nfd.append("notes", JSON.stringify(payload));
    nfd.append("file", new File([JSON.stringify(payload, null, 2)], "inspection.json", { type: "application/json" }), "inspection.json");
    const nres = await postToHook(url, key, nfd);
    if (!nres.ok) { anyFailed = true; failReason = failReason || nres.reason; }
    else {
      if (!nres.confirmed) allConfirmed = false;
      setUpload((s) => s && ({ ...s, sent: s.sent + 1 }));
      // if the AI drafting step is wired up on the cloud side, it can hand
      // its findings straight back in this response instead of only living
      // as a file in the drive — same trick the audio route uses for
      // transcripts. Nothing changes here if that step doesn't exist yet.
      // ...but SiteSnap's own drafting step (the Findings tab) takes precedence:
      // a workflow reply never overwrites findings the surveyor is reviewing.
      const drafted = parseDraftFindings(nres.body);
      const own = inspection.findings && inspection.findings.items && inspection.findings.items.length;
      if (drafted && onFindings && !own) { const lifted = fromLegacyDraft(drafted, rooms); if (lifted) onFindings(lifted); }
    }

    setUpload((s) => s && ({ ...s, running: false, doneAll: !anyFailed }));
    setUpload((s) => s && ({ ...s, confirmed: !anyFailed && allConfirmed }));
    if (onUploadResult) onUploadResult({ at: Date.now(), ok: !anyFailed, confirmed: !anyFailed && allConfirmed, total });
    if (anyFailed) setUploadError(failReason || "The upload didn't go through.");
    else flash(allConfirmed ? "Everything filed in the cloud" : "Everything sent — your workflow will file it");
  }

  // Writes straight into the surveyor's own OneDrive or Drive with the same
  // /Inspections/<address>/<folder>/<file> layout Make produces, so a job
  // filed this way sits next to ones filed through a webhook without anyone
  // having to know which route each one took.
  // photos already filed in the background (filing.js) aren't sent twice
  const isFiled = (id, provider) => { const p = photoCache[id]; return !!(p && p.filed && p.filed.provider === provider); };
  const filedCount = (provider) => rooms.reduce((n, r) => n + r.photoIds.filter((id) => isFiled(id, provider)).length, 0);

  async function uploadDirect(provider) {
    if (directUpload && directUpload.running) return;
    setDirectError(null);
    const statuses = {};
    populated.forEach((r) => { statuses[r.id] = "queued"; });
    const memoCount = rooms.reduce((s, r) => s + (r.memos || []).length, 0);
    const toSend = (room) => room.photoIds.filter((id) => !isFiled(id, provider));
    const extraFiles = findingsFiles(inspection.findings, rooms);
    const total = populated.reduce((s, r) => s + toSend(r).length, 0) + memoCount + 1 + extraFiles.length + (inspection.idPhotoId ? 1 : 0);
    setDirectUpload({ provider, statuses, running: true, sent: 0, total });

    const put = provider === "ms"
      ? async (segments, filename, file) => {
          const { uploadToOneDrive } = await loadMsGraph();
          return uploadToOneDrive(await loadMsClientId(), [...segments, filename], file.name ? file : new File([file], filename, { type: file.type }));
        }
      : async (segments, filename, file) => {
          const { uploadToGoogleDrive } = await loadGoogleDrive();
          return uploadToGoogleDrive(await loadGoogleClientId(), segments, filename, file);
        };

    let failed = false, failReason = null;
    try {
      for (const room of populated) {
        const idx = rooms.indexOf(room);
        setDirectUpload((s) => s && ({ ...s, statuses: { ...s.statuses, [room.id]: "uploading" } }));
        const folder = `${pad(idx + 1)}. ${room.name}`;
        const ids = toSend(room);
        const files = ids.length ? await filesForUpload({ ...room, photoIds: ids }) : [];
        for (const f of files) {
          await put(["Inspections", inspection.address, folder], f.name, f);
          setDirectUpload((s) => s && ({ ...s, sent: s.sent + 1 }));
        }
        if (ids.length && onFiled) onFiled(ids, provider);
        setDirectUpload((s) => s && ({ ...s, statuses: { ...s.statuses, [room.id]: "done" } }));
      }
      for (const room of rooms) {
        const idx = rooms.indexOf(room);
        const folder = `${pad(idx + 1)}. ${room.name}`;
        for (const m of room.memos || []) {
          const blob = audioCache.current[m.id];
          if (!blob) continue;
          const name = `${safeName(room.name).replace(/\s+/g, "_")}_note.${extFor(m.type)}`;
          await put(["Inspections", inspection.address, folder], name, blob);
          setDirectUpload((s) => s && ({ ...s, sent: s.sent + 1 }));
        }
      }
      const notesFile = notesJsonFile();
      await put(["Inspections", inspection.address, "_Inspection"], "inspection.json", notesFile);
      setDirectUpload((s) => s && ({ ...s, sent: s.sent + 1 }));
      for (const f of extraFiles) {
        await put(["Inspections", inspection.address, "_Inspection"], f.name, f);
        setDirectUpload((s) => s && ({ ...s, sent: s.sent + 1 }));
      }
      if (inspection.idPhotoId) {
        const p = await fullPhoto(inspection.idPhotoId);
        if (p && p.dataUrl) {
          await put(["Inspections", inspection.address, "_Inspection"], idPhotoName(inspection), dataUrlToFile(p.dataUrl, idPhotoName(inspection)));
          setDirectUpload((s) => s && ({ ...s, sent: s.sent + 1 }));
        }
      }
      setDirectUpload((s) => s && ({ ...s, running: false }));
      if (onUploadResult) onUploadResult({ at: Date.now(), ok: true, confirmed: true, total, direct: provider });
      flash(`Filed directly to ${provider === "ms" ? "OneDrive" : "Google Drive"}`);
    } catch (e) {
      failed = true;
      failReason = (e && e.message) || "The upload didn't go through.";
      setDirectUpload((s) => s && ({ ...s, running: false }));
      setDirectError(failReason);
    }
    if (failed) setUploadError(`Direct upload to ${provider === "ms" ? "OneDrive" : "Google Drive"} stopped partway: ${failReason} Nothing has been lost — your photos are still on this phone.`);
    return !failed;
  }

  // One cloud action. Files to the connected drive and — when an admin has
  // set a CRM/ERP link in Settings — posts the structured export there too,
  // so there's no second button to remember. With only a CRM link and no
  // drive, the same button sends there directly.
  const provider = direct.ms ? "ms" : direct.google ? "google" : null;
  const providerName = provider === "ms" ? "OneDrive" : "Google Drive";
  const hasHook = !!hookUrl.trim();
  const cloudTarget = !!(provider || hasHook);
  const cloudBusy = !!((directUpload && directUpload.running) || (upload && upload.running));
  const pct = (s) => (s && s.total ? Math.round((s.sent / s.total) * 100) : 0);
  const cloudPct = directUpload && directUpload.running ? pct(directUpload) : upload && upload.running ? pct(upload) : 0;
  const cloudLabel = !provider
    ? (upload && upload.running ? `Sending ${upload.sent} of ${upload.total}…` : "Send to your CRM")
    : directUpload && directUpload.running
      ? `Filing to ${providerName} ${directUpload.sent} of ${directUpload.total}…`
      : upload && upload.running
        ? `Sending to your CRM ${upload.sent} of ${upload.total}…`
        : filedCount(provider) >= totalPhotos && totalPhotos > 0
          ? `All photos filed — send notes to ${providerName}`
          : filedCount(provider) > 0
            ? `Upload the rest to ${providerName} (${totalPhotos - filedCount(provider)} of ${totalPhotos})`
            : `Upload directly to ${providerName}`;
  // Surveyors browsing OneDrive look in the drive root and find nothing —
  // the files are under Apps › <app name> › Inspections (the AppFolder
  // scope, by design). Resolve that folder's real name and, once the first
  // photo has landed, the case folder itself, so the tab can name and link
  // the exact place.
  const [appRoot, setAppRoot] = useState(null);     // { name, webUrl }
  const [caseFolder, setCaseFolder] = useState(null); // { name, webUrl } once it exists
  const msFiled = direct.ms ? filedCount("ms") : 0;
  useEffect(() => {
    if (!direct.ms) return;
    let stale = false;
    (async () => {
      try {
        const { oneDriveFolder } = await loadMsGraph();
        const id = await loadMsClientId();
        const root = await oneDriveFolder(id);
        if (!stale) setAppRoot(root);
        if (msFiled > 0) {
          try { const f = await oneDriveFolder(id, ["Inspections", inspection.address]); if (!stale) setCaseFolder(f); }
          catch { /* not there yet — the app-root link still gets them close */ }
        }
      } catch { /* the text still says where to look */ }
    })();
    return () => { stale = true; };
  }, [direct.ms, inspection.address, msFiled]);
  const driveUrl = (caseFolder && caseFolder.webUrl) || (appRoot && appRoot.webUrl) || null;

  async function sendToCloud() {
    if (cloudBusy) return;
    if (provider) {
      const ok = await uploadDirect(provider);
      if (ok && hasHook) await uploadViaWebhook();
    } else if (hasHook) {
      await uploadViaWebhook();
    }
  }

  return (
    <>
      <div className="ss-scroll">
        <Coach id="export" title="Getting it off the phone">
          One tap files everything to <b>OneDrive</b>. <b>Report</b> makes the PDF; <b>ZIP</b> mirrors the folder structure below. Export as often as you like.
        </Coach>
        <div className="ss-summary">
          <MapPin size={15} />
          <div>
            <div className="ss-summary-title">{inspection.address}{inspection.postcode ? `, ${inspection.postcode}` : ""}</div>
            <div className="ss-summary-sub">{totalPhotos} photo{totalPhotos === 1 ? "" : "s"} · {populated.length} of {rooms.length} rooms</div>
          </div>
        </div>

        <div className="ss-section-label">Folder structure</div>
        <div className="ss-tree">
          <div className="ss-tree-root"><FolderTree size={14} /> {inspection.address}</div>
          {rooms.map((room, i) => {
            const st = (upload && upload.statuses[room.id]) || (directUpload && directUpload.statuses[room.id]) || null;
            return (
              <div key={room.id} className={`ss-tree-row ${room.photoIds.length === 0 ? "dim" : ""}`}>
                <span className={`ss-tree-dot ${st || ""}`}>
                  {st === "uploading" && <Loader2 size={11} className="ss-spin" />}
                  {st === "done" && <CircleCheck size={12} />}
                  {st === "failed" && <X size={12} />}
                  {st === "queued" && <Clock size={11} />}
                </span>
                <span className="ss-tree-name">
                  {pad(i + 1)}. {room.name}
                  {room.condition && <span className={`ss-cbadge ${room.condition.toLowerCase()}`}>{room.condition}</span>}
                  {room.note && room.note.trim() ? <StickyNote size={11} className="ss-note-flag" /> : null}
                </span>
                <span className="ss-tree-right">
                  {st === "queued" && <span className="ss-queued">queued</span>}
                  {room.photoIds.length} photo{room.photoIds.length === 1 ? "" : "s"}
                </span>
              </div>
            );
          })}
        </div>

        {inspection.lastUpload && (!upload || !upload.running) && (
          <div className={`ss-lastup ${inspection.lastUpload.ok ? "ok" : "bad"}`}>
            {inspection.lastUpload.ok ? <CircleCheck size={14} /> : <X size={14} />}
            {inspection.lastUpload.ok
              ? (inspection.lastUpload.confirmed ? "Filed in the cloud" : "Sent to the cloud")
              : "Last upload didn't finish"}
            {" · "}
            {new Date(inspection.lastUpload.at).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
          </div>
        )}

        <div className="ss-section-label" style={{ marginTop: 18 }}>Export</div>
        {cloudTarget && (
          <>
            <button className="ss-btn ss-btn-primary ss-btn-big" onClick={sendToCloud} disabled={cloudBusy || totalPhotos === 0}
              title={totalPhotos === 0 ? "Take at least one photo first" : undefined}>
              <CloudUpload size={19} /> {cloudLabel}
            </button>
            {cloudBusy && <div className="ss-upbar"><div style={{ width: `${cloudPct}%` }} /></div>}
          </>
        )}
        <div className="ss-export-row">
          <button className={`ss-btn ${cloudTarget ? "ss-btn-ghost" : "ss-btn-primary"}`} onClick={openReport} disabled={totalPhotos === 0 || reportBusy}
            title={totalPhotos === 0 ? "Take at least one photo first" : undefined}>
            <FileText size={18} /> Report (PDF)
          </button>
          <button className="ss-btn ss-btn-ghost" onClick={exportZip} disabled={zipBusy || totalPhotos === 0}
            title={totalPhotos === 0 ? "Take at least one photo first" : undefined}>
            <Download size={18} /> {zipBusy ? "Building ZIP…" : "Export ZIP"}
          </button>
        </div>
        <button className="ss-btn ss-btn-ghost ss-btn-big" style={{ marginTop: 8 }} onClick={handleSaveAll} disabled={totalPhotos === 0}
          title={totalPhotos === 0 ? "Take at least one photo first" : undefined}>
          <ImagePlus size={19} /> Save all to Photos app
        </button>
        {directError && <p className="ss-fineprint" style={{ color: "var(--red)" }}>{directError}</p>}
        {filing && filing.provider && totalPhotos > 0 && (
          <p className="ss-fineprint ss-filing-note" style={{ textAlign: "center" }}>
            {filing.pending > 0
              ? `Filing ${filing.pending} photo${filing.pending === 1 ? "" : "s"} to ${filing.provider === "ms" ? "OneDrive" : "Google Drive"} in the background…`
              : `${filedCount(filing.provider)} of ${totalPhotos} photo${totalPhotos === 1 ? "" : "s"} filed to ${filing.provider === "ms" ? "OneDrive" : "Google Drive"} as taken.`}
          </p>
        )}
        {direct.ms && (
          <p className="ss-fineprint ss-drive-where">
            In OneDrive under <b>Apps › {appRoot ? appRoot.name : "SiteSnap"} › Inspections › {inspection.address}</b>
            {driveUrl && (
              <> · <a href={driveUrl} target="_blank" rel="noopener noreferrer">Open in OneDrive <ExternalLink size={11} /></a></>
            )}
          </p>
        )}
        {!cloudTarget && (
          <p className="ss-fineprint" style={{ textAlign: "center" }}>No cloud link yet — connect OneDrive in Settings to file photos as you shoot.</p>
        )}

        {inspection.draftFindings && (
          <p className="ss-fineprint" style={{ textAlign: "center" }}>Draft findings are ready — see the Findings tab.</p>
        )}

        {note && <div className="ss-note" style={{ marginTop: 10 }}>{note}</div>}
        <p className="ss-fineprint">
          Nothing leaves this phone until you close the inspection below. The
          ZIP mirrors the folder structure above.
        </p>
      </div>

      <div className="ss-footer">
        <button className="ss-btn ss-btn-ghost" onClick={() => setConfirmClose(true)}>Close inspection & start fresh</button>
      </div>

      {confirmClose && (() => {
        const filed = !!(inspection.lastUpload && inspection.lastUpload.confirmed);
        const exported = !!inspection.lastExport;
        const safe = filed || exported;
        return (
          <div className="ss-modal-back" onClick={() => { setConfirmClose(false); setAcceptLoss(false); }}>
            <div className="ss-modal" onClick={(e) => e.stopPropagation()}>
              <div className="ss-modal-icon"><AlertTriangle size={22} /></div>
              <div className="ss-modal-title">
                {safe ? "Close this inspection?" : "This isn't saved anywhere yet"}
              </div>
              {safe ? (
                <p>
                  All {totalPhotos} photo{totalPhotos === 1 ? "" : "s"} and notes will be removed
                  from this device. {filed
                    ? "They are confirmed filed in the cloud."
                    : "You exported them, so keep that copy safe."}
                </p>
              ) : (
                <>
                  <p>
                    {totalPhotos === 1 ? "This photo has" : `These ${totalPhotos} photos have`} not been
                    exported, and the cloud upload {inspection.lastUpload ? "was only accepted, never confirmed as filed" : "hasn't run"}.
                    Closing now deletes the only copy, and you can't reshoot a property you have left.
                  </p>
                  <label className="ss-accept">
                    <input type="checkbox" checked={acceptLoss} onChange={(e) => setAcceptLoss(e.target.checked)} />
                    <span>I have the photos somewhere else, or I don't need them.</span>
                  </label>
                </>
              )}
              <button className="ss-btn ss-btn-danger" disabled={!safe && !acceptLoss} onClick={onDone}>
                <Trash2 size={16} /> Delete &amp; close
              </button>
              <button className="ss-btn ss-btn-ghost" style={{ marginTop: 8 }}
                onClick={() => { setConfirmClose(false); setAcceptLoss(false); }}>
                {safe ? "Keep inspection" : "Go back and save it first"}
              </button>
            </div>
          </div>
        );
      })()}

      {uploadError && (
        <div className="ss-modal-back" onClick={() => setUploadError(null)}>
          <div className="ss-modal" onClick={(e) => e.stopPropagation()}>
            <div className="ss-modal-icon"><CloudUpload size={22} /></div>
            <div className="ss-modal-title">Upload didn't finish</div>
            <p>{uploadError}</p>
            <p style={{ marginBottom: 16 }}>
              <strong>Nothing has been lost.</strong> Every photo and note is still on
              this phone. Fix the connection and send again, or export a ZIP in
              the meantime.
            </p>
            <button className="ss-btn ss-btn-primary" onClick={() => { setUploadError(null); sendToCloud(); }}>
              Try again
            </button>
            <button className="ss-btn ss-btn-ghost" style={{ marginTop: 8 }} onClick={() => setUploadError(null)}>
              Close
            </button>
          </div>
        </div>
      )}

      {reportOpen && (
        <ReportView inspection={inspection} rooms={rooms} photoCache={reportCache || photoCache} onClose={closeReport} />
      )}
    </>
  );
}
