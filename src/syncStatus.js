// One answer to "is my work safe, and is it going where it should?" —
// derived from the stores that already exist, never a fifth one:
//   saveStatus  App.jsx      "saving" | "saved"     the phone's own copy
//   sync        sync.js      the firm register (accounts mode; null in local mode)
//   filing      filing.js    background photo filing to OneDrive / Drive
//   online      the browser's connectivity flag
// The AI retry loop (aiRetry.js) has no shared state to read, so requests
// waiting on signal are not counted here.
//
// Returns { state, label, detail, waiting }:
//   state   saved | syncing | offline | failed
//   label   the compact line ("Saved", "Syncing…", "Offline · 14 waiting", "Sync failed")
//   detail  the same as one full line, for screens with room for it
//   waiting photos queued for filing

const plural = (n, w) => `${n} ${w}${n === 1 ? "" : "s"}`;
const providerName = (p) => (p === "ms" ? "OneDrive" : p === "google" ? "Google Drive" : "the cloud");

export function deriveSyncStatus({ saveStatus, sync, filing, online = true, now = Date.now(), ago } = {}) {
  const waiting = filing && filing.pending > 0 ? filing.pending : 0;
  const offlineLabel = waiting ? `Offline · ${waiting} waiting` : "Offline";
  const offlineDetail = waiting
    ? `Saved on this phone. ${plural(waiting, "photo")} file${waiting === 1 ? "s" : ""} to ${providerName(filing.provider)} when you're back on signal.`
    : "Saved on this phone. You're offline — keep working normally.";

  if (saveStatus === "saving") return { state: "syncing", label: "Saving…", detail: "Saving…", waiting };
  if (!online || (sync && sync.status === "offline")) return { state: "offline", label: offlineLabel, detail: offlineDetail, waiting };
  if ((filing && filing.busy) || (sync && sync.status === "syncing")) {
    const detail = filing && filing.busy && waiting
      ? `Filing ${plural(waiting, "photo")} to ${providerName(filing.provider)}…`
      : sync && sync.status === "syncing" ? "Updating the firm register…" : "Syncing…";
    return { state: "syncing", label: "Syncing…", detail, waiting };
  }
  if (filing && filing.failed > 0) {
    return { state: "failed", label: "Sync failed", detail: `Sync failed · ${plural(filing.failed, "photo")} couldn't be filed to ${providerName(filing.provider)}${filing.lastError ? ` — ${filing.lastError}` : ""}. They are safe on this phone.`, waiting };
  }
  if (sync && sync.status === "error") {
    return { state: "failed", label: "Sync failed", detail: `Sync failed · saved on this phone, register not updated${sync.error ? `: ${sync.error}` : ""}`, waiting };
  }
  if (sync && sync.status === "synced") {
    return { state: "saved", label: "Saved", detail: `Saved · in the firm register${sync.at ? `, updated ${ago ? ago(sync.at, now) : "just now"}` : ""}`, waiting };
  }
  if (sync && sync.status === "idle") return { state: "saved", label: "Saved", detail: "Saved on this phone · not in the firm register yet", waiting };
  return { state: "saved", label: "Saved", detail: "Saved on this phone", waiting };
}
