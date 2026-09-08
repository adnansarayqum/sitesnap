import { useEffect, useRef, useState } from "react";
import {
  AlertTriangle, Check, CircleCheck, Clock, CloudUpload, Download, FileText, FolderTree, ImagePlus, Link2, Loader2, MapPin, Mic, Pencil, RotateCcw, ShieldCheck, Sparkles, StickyNote, Trash2, WifiOff, X,
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
import {
  aiConfig, aiPhotoCopy, transcribeMemo, draftRoom, reviewFinding, emptyFindings, mergeRun, setFindingStatus,
  effective, isApproved, needsAttention, approvedByRoom, findingsFiles, fromLegacyDraft, AI_MAX_PHOTOS,
} from "../ai.js";
import { withOfflineRetry } from "../aiRetry.js";

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

export function FinishScreen({ inspection, rooms, photoCache, totalPhotos, filesForRoom, filesForUpload, fullPhoto, audioCache, onUploadResult, onExportResult, onFindings, onSaveAll, onDone, onSettings, filing, onFiled }) {
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
      // approved findings for the workbook, and the ID photo — both beside the
      // rooms, never inside one
      const extras = findingsFiles(inspection.findings, rooms);
      if (extras.length) { const meta = root.folder("_Inspection"); extras.forEach((f) => meta.file(f.name, f)); }
      if (inspection.idPhotoId) {
        const p = await fullPhoto(inspection.idPhotoId);
        if (p && p.dataUrl) root.file(idPhotoName(inspection), dataUrlToFile(p.dataUrl, idPhotoName(inspection)));
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
      const payload = {
        inspectionId: inspection.id, address: inspection.address, postcode: inspection.postcode || "",
        reference: inspection.ref || "", client: inspection.client || "", occupier: inspection.occupier || "",
        solicitor: inspection.solicitor || "", inspectedAt: new Date(inspection.startedAt).toISOString(), totalPhotos,
        rooms: rooms.map((r, i) => ({
          order: i + 1, folder: `${pad(i + 1)}. ${r.name}`, room: r.name, condition: r.condition || "",
          note: (r.note || "").trim(), photos: r.photoIds.length, voiceNotes: (r.memos || []).length,
          photoNumbers: r.photoIds.map((id) => photoCache[id] && photoCache[id].no).filter(Boolean),
        })),
      };
      const notesFile = new File([JSON.stringify(payload, null, 2)], "inspection.json", { type: "application/json" });
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
  }

  return (
    <>
      <div className="ss-scroll">
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
        <button className="ss-btn ss-btn-primary ss-btn-big" onClick={handleSaveAll} disabled={totalPhotos === 0}
          title={totalPhotos === 0 ? "Take at least one photo first" : undefined}>
          <ImagePlus size={19} /> Save all to Photos app
        </button>
        <button className="ss-btn ss-btn-ghost ss-btn-big" style={{ marginTop: 8 }} onClick={exportZip} disabled={zipBusy || totalPhotos === 0}
          title={totalPhotos === 0 ? "Take at least one photo first" : undefined}>
          <Download size={19} />
          {zipBusy ? "Building ZIP…" : "Export ZIP (numbered folders)"}
        </button>
        <button className="ss-btn ss-btn-ghost ss-btn-big" style={{ marginTop: 8 }} onClick={openReport} disabled={totalPhotos === 0 || reportBusy}
          title={totalPhotos === 0 ? "Take at least one photo first" : undefined}>
          <FileText size={19} /> Report (print / save PDF)
        </button>
        {hookUrl ? (
          <>
            <button className="ss-btn ss-btn-ghost ss-btn-big" style={{ marginTop: 8 }} onClick={uploadViaWebhook} disabled={(upload && upload.running) || totalPhotos === 0}
              title={totalPhotos === 0 ? "Take at least one photo first" : undefined}>
              <CloudUpload size={19} />
              {upload
                ? upload.running
                  ? `Uploading ${upload.sent} of ${upload.total}…`
                  : upload.doneAll
                    ? (upload.confirmed ? "Filed ✓ — send again" : "Sent ✓ — send again")
                    : "Retry upload"
                : "Upload to cloud (Make/n8n/Zapier)"}
            </button>
            {upload && upload.running && (
              <div className="ss-upbar"><div style={{ width: `${upload.total ? Math.round((upload.sent / upload.total) * 100) : 0}%` }} /></div>
            )}
          </>
        ) : null}

        {direct.ms && (
          <>
            <button className="ss-btn ss-btn-ghost ss-btn-big" style={{ marginTop: 8 }}
              onClick={() => uploadDirect("ms")} disabled={(directUpload && directUpload.running) || totalPhotos === 0}
              title={totalPhotos === 0 ? "Take at least one photo first" : undefined}>
              <CloudUpload size={19} />
              {directUpload && directUpload.provider === "ms" && directUpload.running
                ? `Filing to OneDrive ${directUpload.sent} of ${directUpload.total}…`
                : filedCount("ms") >= totalPhotos && totalPhotos > 0
                  ? "All photos filed — send notes to OneDrive"
                  : filedCount("ms") > 0
                    ? `Upload the rest to OneDrive (${totalPhotos - filedCount("ms")} of ${totalPhotos})`
                    : "Upload directly to OneDrive"}
            </button>
            {directUpload && directUpload.provider === "ms" && directUpload.running && (
              <div className="ss-upbar"><div style={{ width: `${directUpload.total ? Math.round((directUpload.sent / directUpload.total) * 100) : 0}%` }} /></div>
            )}
          </>
        )}
        {direct.google && (
          <>
            <button className="ss-btn ss-btn-ghost ss-btn-big" style={{ marginTop: 8 }}
              onClick={() => uploadDirect("google")} disabled={(directUpload && directUpload.running) || totalPhotos === 0}
              title={totalPhotos === 0 ? "Take at least one photo first" : undefined}>
              <CloudUpload size={19} />
              {directUpload && directUpload.provider === "google" && directUpload.running
                ? `Filing to Google Drive ${directUpload.sent} of ${directUpload.total}…`
                : filedCount("google") >= totalPhotos && totalPhotos > 0
                  ? "All photos filed — send notes to Google Drive"
                  : filedCount("google") > 0
                    ? `Upload the rest to Google Drive (${totalPhotos - filedCount("google")} of ${totalPhotos})`
                    : "Upload directly to Google Drive"}
            </button>
            {directUpload && directUpload.provider === "google" && directUpload.running && (
              <div className="ss-upbar"><div style={{ width: `${directUpload.total ? Math.round((directUpload.sent / directUpload.total) * 100) : 0}%` }} /></div>
            )}
          </>
        )}
        {directError && <p className="ss-fineprint" style={{ color: "var(--red)" }}>{directError}</p>}
        {filing && filing.provider && totalPhotos > 0 && (
          <p className="ss-fineprint ss-filing-note" style={{ textAlign: "center" }}>
            {filing.pending > 0
              ? `Filing ${filing.pending} photo${filing.pending === 1 ? "" : "s"} to ${filing.provider === "ms" ? "OneDrive" : "Google Drive"} in the background…`
              : `${filedCount(filing.provider)} of ${totalPhotos} photo${totalPhotos === 1 ? "" : "s"} filed to ${filing.provider === "ms" ? "OneDrive" : "Google Drive"} as they were taken. Captions added later are in the notes file and the report.`}
          </p>
        )}

        {!hookUrl && !direct.ms && !direct.google && (
          <p className="ss-fineprint" style={{ textAlign: "center" }}>No cloud link set up yet.</p>
        )}
        <button className="ss-hook-toggle" onClick={onSettings}>
          <Link2 size={13} /> Cloud upload settings
        </button>

        {inspection.draftFindings && (
          <p className="ss-fineprint" style={{ textAlign: "center" }}>Draft findings are ready — see the Findings tab.</p>
        )}

        {note && <div className="ss-note" style={{ marginTop: 10 }}>{note}</div>}
        <p className="ss-fineprint">
          Nothing is deleted from this device until you close the inspection
          below — export as many times as you like. The ZIP contains the exact
          numbered folder structure shown above, ready to drop into OneDrive.
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
              this phone. Fix the connection or the link and tap upload again, or
              export a ZIP in the meantime.
            </p>
            <button className="ss-btn ss-btn-primary" onClick={() => { setUploadError(null); uploadViaWebhook(); }}>
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

/* ---------------- draft findings review ---------------- */

/* ---------------- findings: the AI drafts, the surveyor decides ---------------- */

// The Findings tab of an open case. "Draft findings" sends each room that
// has something to say — a note, a stated cause, voice notes, or a Fair/Poor
// rating — to the server's drafting step (server/ai.js) together with the
// room's photographs, and shows what comes back for review. Nothing here
// files or sends anything; approving only decides what reaches the report
// and the workbook export.
const FLAG_LABEL = {
  disagreement: "Photos disagree with your read", unpriced: "Unpriced — check", scope_uncertain: "Scope uncertain",
  no_photo_evidence: "No photo shows it", legal_check: "Legal check", asbestos: "Asbestos",
};
const SCOPE_LABEL = { localised: "Localised repair", whole_element: "Whole element", multiple_elements: "Several elements", investigation_first: "Investigate first" };
const money = (n) => `£${Math.round(n).toLocaleString("en-GB")}`;

export function FindingsTab({ inspection, rooms, photoCache, fullPhoto, audioCache, onFindings, onTranscripts, onActivity }) {
  const state = inspection.findings && inspection.findings.items ? inspection.findings : emptyFindings();
  const transcripts = inspection.transcripts || {};
  const [cfg, setCfg] = useState(null);
  const [progress, setProgress] = useState(null); // { statuses: {roomId: queued|transcribing|drafting|done|failed}, running, error }
  const [editing, setEditing] = useState(null);   // { id, defect, works, costLow, costHigh }
  const [openTranscript, setOpenTranscript] = useState({});
  const abortRef = useRef(null);
  useEffect(() => { aiConfig().then(setCfg); }, []);
  useEffect(() => () => { if (abortRef.current) abortRef.current.abort(); }, []); // leaving the tab cancels any run in flight

  const eligible = (r) => !!((r.note && r.note.trim()) || (r.hypothesis && r.hypothesis.trim()) || (r.memos || []).length || r.condition === "Poor" || r.condition === "Fair");
  const candidates = rooms.filter(eligible);
  const total = state.items.filter((f) => f.status !== "rejected").length;
  const approved = state.items.filter(isApproved).length;
  const flagged = state.items.filter((f) => f.status === "draft" && needsAttention(f)).length;

  function cancelDraft() {
    if (abortRef.current) abortRef.current.abort();
  }

  async function draftAll() {
    if (progress && progress.running) return;
    if (!candidates.length) return;
    const controller = new AbortController();
    abortRef.current = controller;
    const statuses = {};
    candidates.forEach((r) => { statuses[r.id] = "queued"; });
    setProgress({ statuses, running: true, error: null });
    let working = state;
    let words = { ...transcripts };
    let drafted = 0, failed = 0, cancelled = false;
    for (const room of candidates) {
      if (controller.signal.aborted) { cancelled = true; break; }
      const order = rooms.indexOf(room) + 1;
      try {
        // voice notes first: anything not yet transcribed goes up now, and the
        // words are kept in the case so a re-draft doesn't pay for them twice
        const memos = room.memos || [];
        const pending = memos.filter((m) => !words[m.id] && audioCache.current[m.id]);
        if (pending.length && cfg && cfg.transcription) {
          setProgress((p) => p && ({ ...p, statuses: { ...p.statuses, [room.id]: "transcribing" } }));
          for (const m of pending) {
            try {
              words[m.id] = await withOfflineRetry(
                () => transcribeMemo(inspection.id, room.id, m, audioCache.current[m.id], controller.signal),
                {
                  isAlive: () => !controller.signal.aborted,
                  onQueued: () => setProgress((p) => p && ({ ...p, statuses: { ...p.statuses, [room.id]: "waiting" } })),
                },
              );
              setProgress((p) => p && ({ ...p, statuses: { ...p.statuses, [room.id]: "transcribing" } }));
            } catch (e) { if (e.name === "AbortError") throw e; words[m.id] = ""; console.error("transcribe", e); }
          }
          onTranscripts(words);
        }
        setProgress((p) => p && ({ ...p, statuses: { ...p.statuses, [room.id]: "drafting" } }));
        const photos = [];
        // cap client-side too (must match the server's MAX_PHOTOS) so the
        // exhibit numbers shown here are exactly what the model saw, not a
        // longer list silently truncated on arrival
        for (const pid of room.photoIds.slice(0, AI_MAX_PHOTOS)) {
          const p = await fullPhoto(pid);
          if (!p || !p.dataUrl) continue;
          photos.push({ id: pid, no: p.no || null, caption: p.caption || "", dataUrl: await aiPhotoCopy(p.dataUrl) });
        }
        const res = await withOfflineRetry(
          () => draftRoom({ inspection, room, order, transcripts: memos.map((m) => words[m.id]).filter(Boolean), photos, signal: controller.signal }),
          {
            isAlive: () => !controller.signal.aborted,
            onQueued: () => setProgress((p) => p && ({ ...p, statuses: { ...p.statuses, [room.id]: "waiting" } })),
          },
        );
        working = mergeRun(working, room, res);
        onFindings(working);
        drafted += res.findings.length;
        const dropped = (room.photoIds.length - AI_MAX_PHOTOS) + (res.run.droppedPhotos || 0);
        if (dropped > 0 && onActivity) onActivity(`${room.name}: only the first ${AI_MAX_PHOTOS} photos were used for drafting (${dropped} left out)`);
        setProgress((p) => p && ({ ...p, statuses: { ...p.statuses, [room.id]: "done" } }));
      } catch (e) {
        if (e.name === "AbortError") {
          cancelled = true;
          setProgress((p) => p && ({ ...p, statuses: { ...p.statuses, [room.id]: "cancelled" } }));
          break;
        }
        failed += 1;
        console.error("draft", e);
        setProgress((p) => p && ({ ...p, statuses: { ...p.statuses, [room.id]: "failed" }, error: e.message }));
      }
    }
    abortRef.current = null;
    if (onActivity) {
      if (cancelled) onActivity(`Drafting cancelled — ${drafted} finding${drafted === 1 ? "" : "s"} kept from ${candidates.length - failed} room${candidates.length - failed === 1 ? "" : "s"} drafted before stopping`);
      else onActivity(`Drafted ${drafted} finding${drafted === 1 ? "" : "s"} across ${candidates.length - failed} room${candidates.length - failed === 1 ? "" : "s"}${failed ? ` — ${failed} failed` : ""}`);
    }
    setProgress((p) => p && ({ ...p, running: false, cancelled }));
  }

  function decide(f, status, reviewed) {
    onFindings(setFindingStatus(state, f.id, status, reviewed));
    reviewFinding(f.id, status, reviewed);
    setEditing(null);
  }
  function startEdit(f) {
    const e = effective(f);
    setEditing({ id: f.id, defect: e.defect, works: e.remedial.works, costLow: e.cost.unpriced ? "" : e.cost.low, costHigh: e.cost.unpriced ? "" : e.cost.high });
  }
  function saveEdit(f) {
    const low = editing.costLow === "" ? null : Number(editing.costLow);
    const high = editing.costHigh === "" ? null : Number(editing.costHigh);
    decide(f, "edited", { defect: editing.defect.trim(), works: editing.works.trim(), costLow: Number.isFinite(low) ? low : null, costHigh: Number.isFinite(high) ? high : null, at: Date.now() });
  }
  function approveUnflagged() {
    let next = state;
    for (const f of state.items) if (f.status === "draft" && !needsAttention(f)) { next = setFindingStatus(next, f.id, "approved"); reviewFinding(f.id, "approved"); }
    onFindings(next);
  }

  const hasRuns = Object.keys(state.runs || {}).length > 0;
  const aiOff = cfg && !cfg.enabled;
  const draftLabel = hasRuns ? "Re-draft all rooms" : "Draft findings";

  const statusBar = cfg && (
    <div className="ss-ai-bar">
      <Sparkles size={15} />
      <span>
        {cfg.enabled ? <>Drafted by <b>{cfg.model}</b> against <b>{cfg.reference}</b>.</> : <>Drafting is <b>off</b> on this server — it needs an ANTHROPIC_API_KEY.</>}
        {cfg.enabled && !cfg.transcription && <> Voice notes won't be transcribed until OPENAI_API_KEY is set — typed notes still go through.</>}
      </span>
    </div>
  );

  const progressList = progress && (
    <div className="ss-draft-rooms">
      {candidates.map((r) => {
        const st = progress.statuses[r.id] || "queued";
        return (
          <div key={r.id} className="ss-draft-room">
            <span>{r.name}</span>
            <span className={`st ${st}`}>
              {(st === "drafting" || st === "transcribing") && <Loader2 size={12} className="ss-spin" />}
              {st === "waiting" && <WifiOff size={12} />}
              {st === "done" && <Check size={12} />}
              {(st === "failed" || st === "cancelled") && <X size={12} />}
              {st === "queued" ? "queued" : st === "transcribing" ? "transcribing" : st === "drafting" ? "reading photos" : st === "waiting" ? "no signal — will retry" : st}
            </span>
          </div>
        );
      })}
      {progress.error && <div className="ss-gaps"><AlertTriangle size={13} /> {progress.error}</div>}
    </div>
  );

  if (!hasRuns && !(progress && progress.running)) {
    return (
      <>
        <div className="ss-scroll">
          {statusBar}
          {progressList}
          <div className="ss-empty">
            <ShieldCheck size={22} />
            <p>
              No draft findings yet.<br />
              {candidates.length
                ? <>{candidates.length} room{candidates.length === 1 ? " has" : "s have"} notes, voice notes or a rating to work from. Drafting reads the photos too.</>
                : <>Add a note, a voice note, your read on the cause, or rate a room Fair or Poor, and it can be drafted.</>}
            </p>
          </div>
        </div>
        <div className="ss-footer">
          {progress && progress.running ? (
            <button className="ss-btn ss-btn-danger-ghost ss-btn-big" onClick={cancelDraft}><X size={18} /> Cancel</button>
          ) : (
            <button className="ss-btn ss-btn-primary ss-btn-big" onClick={draftAll} disabled={!candidates.length || aiOff || !cfg}
              title={aiOff ? "Set ANTHROPIC_API_KEY on the server" : undefined}>
              <Sparkles size={18} /> {draftLabel}
            </button>
          )}
        </div>
      </>
    );
  }

  return (
    <>
      <div className="ss-scroll">
        {statusBar}
        {progress && progress.running && progressList}
        <div className="ss-findings-banner">
          <ShieldCheck size={16} />
          <span>Drafts, not findings. Read every flag; approve what stands, edit what needs your wording, reject what's wrong. Only approved items reach the report and the workbook.</span>
        </div>

        {rooms.map((room) => {
          const run = state.runs[room.id];
          const items = state.items.filter((f) => f.roomId === room.id);
          if (!run && !items.length) return null;
          const memoText = (room.memos || []).map((m) => transcripts[m.id]).filter(Boolean);
          return (
            <div key={room.id} className="ss-room-run">
              <div className="ss-room-run-head">
                <h3>{room.name}</h3>
                {run && <span className="ss-room-run-meta">{run.model === "mock" ? "mock draft" : run.model}{run.servedByFallback ? " · fallback" : ""} · {new Date(run.at).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}</span>}
              </div>
              {run && run.room_summary && <p className="ss-room-summary">{run.room_summary}</p>}
              {memoText.length > 0 && (
                <>
                  <button className="ss-transcript-toggle" onClick={() => setOpenTranscript((o) => ({ ...o, [room.id]: !o[room.id] }))}>
                    <Mic size={12} /> {openTranscript[room.id] ? "Hide" : "Show"} voice note transcript{memoText.length === 1 ? "" : "s"}
                  </button>
                  {openTranscript[room.id] && <div className="ss-transcript">{memoText.join("\n\n")}</div>}
                </>
              )}
              {run && run.evidence_gaps && run.evidence_gaps.length > 0 && (
                <div className="ss-gaps">What would settle the open questions:<ul>{run.evidence_gaps.map((g, i) => <li key={i}>{g}</li>)}</ul></div>
              )}
              {items.length === 0 && <p className="ss-empty-note">Nothing to report for this room from what was recorded.</p>}

              {items.map((raw) => {
                const f = effective(raw);
                const a = f.assessment || {};
                const flagKind = a.agreement === "disagree" ? "disagree" : a.agreement === "uncertain" ? "uncertain" : a.agreement === "agree" && f.surveyor_hypothesis ? "agree" : null;
                const otherFlags = (f.review_flags || []).filter((x) => x !== "disagreement");
                const isEditing = editing && editing.id === f.id;
                return (
                  <div key={f.id} className={`ss-finding-card ${f.status}`}>
                    <div className="ss-finding-head">
                      <span className="ss-finding-title">{f.title}</span>
                      <span className={`ss-finding-status ${f.status}`}>{f.status}</span>
                    </div>
                    <div className="ss-chips">
                      <span className={`ss-pill-conf ${f.confidence === "high" ? "ok" : "warn"}`}>{f.confidence} confidence</span>
                      {otherFlags.map((x) => <span key={x} className="ss-chip warn"><AlertTriangle size={11} /> {FLAG_LABEL[x] || x}</span>)}
                      {(f.photo_refs || []).length > 0 && <span className="ss-chip">Photos {f.photo_refs.join(", ")}</span>}
                    </div>

                    {flagKind && (
                      <div className={`ss-flag ${flagKind}`}>
                        {flagKind === "agree" ? <Check size={16} /> : <AlertTriangle size={16} />}
                        <div>
                          <b>{flagKind === "disagree" ? "The photos point elsewhere" : flagKind === "uncertain" ? "Could go either way" : "Photos support your read"}</b>
                          <div className="kv">
                            <span>Your read</span><span>{f.surveyor_hypothesis || "—"}</span>
                            <span>Photos suggest</span><span>{a.likely_cause}</span>
                          </div>
                          {flagKind !== "agree" && a.reasoning && <p>{a.reasoning}</p>}
                          {(a.alternative_causes || []).length > 0 && <p>Also open: {a.alternative_causes.join("; ")}.</p>}
                        </div>
                      </div>
                    )}

                    {isEditing ? (
                      <div className="ss-edit-form">
                        <label>Defect</label>
                        <textarea rows={4} value={editing.defect} onChange={(e) => setEditing({ ...editing, defect: e.target.value })} />
                        <label>Remedial works</label>
                        <textarea rows={4} value={editing.works} onChange={(e) => setEditing({ ...editing, works: e.target.value })} />
                        <label>Cost range (£)</label>
                        <div className="row">
                          <input type="number" inputMode="numeric" placeholder="low" value={editing.costLow} onChange={(e) => setEditing({ ...editing, costLow: e.target.value })} />
                          <input type="number" inputMode="numeric" placeholder="high" value={editing.costHigh} onChange={(e) => setEditing({ ...editing, costHigh: e.target.value })} />
                        </div>
                        <div className="ss-finding-actions">
                          <button className="ss-btn ss-btn-primary" onClick={() => saveEdit(raw)}><Check size={15} /> Save &amp; approve</button>
                          <button className="ss-btn ss-btn-ghost" onClick={() => setEditing(null)}>Cancel</button>
                        </div>
                      </div>
                    ) : (
                      <>
                        <div className="ss-finding-label">Defect</div>
                        <p className="ss-finding-text">{f.defect}</p>
                        {!flagKind && a.likely_cause && (
                          <>
                            <div className="ss-finding-label">Cause</div>
                            <p className="ss-finding-text">{a.likely_cause}</p>
                          </>
                        )}
                        <div className="ss-finding-label">Legislation</div>
                        {f.legislation.length || f.hhsrs_hazard ? (
                          <div className="ss-chips">
                            {f.legislation.map((l) => <span key={l} className="ss-chip leg"><ShieldCheck size={11} /> {l}</span>)}
                            {f.hhsrs_hazard && <span className="ss-chip leg">{f.hhsrs_hazard}</span>}
                          </div>
                        ) : <span className="ss-finding-leg-empty">Not clearly supported — left blank</span>}
                        <div className="ss-finding-label">Remedial works</div>
                        <div className="ss-scope"><FolderTree size={12} /> {SCOPE_LABEL[f.remedial.scope] || f.remedial.scope}</div>
                        <p className="ss-finding-text">{f.remedial.works}</p>
                        {f.remedial.scope_rationale && <p className="ss-scope-why">{f.remedial.scope_rationale}</p>}
                        {(f.remedial.conditions || []).length > 0 && <div className="ss-chips">{f.remedial.conditions.map((c) => <span key={c} className="ss-chip warn">{c}</span>)}</div>}
                        <div className="ss-finding-label">Estimated cost</div>
                        {f.cost.unpriced
                          ? <div className="ss-cost unpriced">Unpriced — {f.cost.basis || "no price book row fits"}</div>
                          : <><div className="ss-cost">{money(f.cost.low)} – {money(f.cost.high)}</div><p className="ss-cost-basis">{f.cost.basis}{(f.cost.price_book_refs || []).length ? ` · ${f.cost.price_book_refs.join(", ")}` : ""}</p></>}
                        <div className="ss-finding-actions">
                          {f.status === "draft" && <button className="ss-btn ss-btn-primary" onClick={() => decide(raw, "approved")}><Check size={15} /> Approve</button>}
                          {f.status !== "rejected" && <button className="ss-btn ss-btn-ghost" onClick={() => startEdit(raw)}><Pencil size={14} /> Edit</button>}
                          {f.status === "draft" && <button className="ss-btn ss-btn-danger-ghost" onClick={() => decide(raw, "rejected")}><X size={15} /> Reject</button>}
                          {f.status !== "draft" && <button className="ss-btn ss-btn-ghost" onClick={() => decide(raw, "draft", f.status === "edited" ? raw.reviewed : null)}><RotateCcw size={14} /> Back to draft</button>}
                        </div>
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          );
        })}
        <div style={{ height: 12 }} />
      </div>
      <div className="ss-footer">
        <div style={{ textAlign: "center", fontSize: 12.5, fontWeight: 700, color: "var(--muted)", marginBottom: 8 }}>
          {approved} of {total} approved{flagged ? ` · ${flagged} flagged for you` : ""}
        </div>
        <div className="ss-finding-actions" style={{ marginTop: 0 }}>
          <button className="ss-btn ss-btn-primary" onClick={approveUnflagged} disabled={!state.items.some((f) => f.status === "draft" && !needsAttention(f))}>
            <Check size={16} /> Approve unflagged
          </button>
          {progress && progress.running ? (
            <button className="ss-btn ss-btn-danger-ghost" onClick={cancelDraft}><X size={15} /> Cancel</button>
          ) : (
            <button className="ss-btn ss-btn-ghost" onClick={draftAll} disabled={aiOff || !candidates.length}>
              <Sparkles size={15} /> {draftLabel}
            </button>
          )}
        </div>
      </div>
    </>
  );
}
