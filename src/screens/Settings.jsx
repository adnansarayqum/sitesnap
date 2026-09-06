import { useEffect, useState } from "react";
import {
  Aperture, Check, CircleCheck, CloudUpload, FileText, HardDrive, KeyRound, Loader2, Moon, Sun,
} from "lucide-react";
import {
  loadWebhook, saveWebhook, loadWebhookKey, saveWebhookKey, storageEstimate, loadMsClientId, saveMsClientId, loadGoogleClientId, saveGoogleClientId, hasBuiltInMsClientId, hasBuiltInGoogleClientId,
} from "../storage.js";
import { loadGoogleDrive, loadMsGraph } from "../cloud/lazy.js";
import { cloudServiceConfig, linkedAccount, beginLink, unlink } from "../cloud/service.js";
import { updateName, switchOrg } from "../auth.js";
import { TabBar } from "./Home.jsx";
import { TeamSettings } from "./Team.jsx";

/* ---------------- account (accounts mode) ---------------- */

function AccountCard({ me, onSignOut, onChanged, flash }) {
  const [name, setName] = useState(me.user.name || "");
  const [busy, setBusy] = useState(false);
  const isAdmin = me.org && ["owner", "admin"].includes(me.org.role);
  return (
    <>
      <div className="ss-section-label" style={{ marginTop: 4 }}>Account</div>
      <div className="ss-storage-card">
        <div className="ss-key-row">
          <input className="ss-input" placeholder="Your name" value={name} onChange={(e) => setName(e.target.value)} aria-label="Your name" />
          <button className="ss-btn ss-btn-primary" disabled={busy || name.trim() === (me.user.name || "")}
            onClick={async () => { setBusy(true); try { await updateName(name.trim()); onChanged(); flash("Name saved"); } finally { setBusy(false); } }}>Save</button>
        </div>
        <div className="ss-account-row" style={{ marginTop: 6 }}><span className="ss-muted">Signed in as</span><span style={{ fontWeight: 700 }}>{me.user.email}</span></div>
        {me.org && (
          <div className="ss-account-row">
            <span className="ss-muted">Firm</span>
            {me.orgs && me.orgs.length > 1 ? (
              <select className="ss-role-select" value={me.org.id} aria-label="Firm"
                onChange={async (e) => { await switchOrg(e.target.value); onChanged(); }}>
                {me.orgs.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
              </select>
            ) : (
              <span style={{ fontWeight: 700 }}>{me.org.name} <span className="ss-role-pill" style={{ marginLeft: 6 }}>{me.org.role}</span></span>
            )}
          </div>
        )}
        <button className="ss-btn ss-btn-ghost" style={{ marginTop: 10 }} onClick={onSignOut}>Sign out</button>
        <p className="ss-fineprint" style={{ margin: "8px 2px 0" }}>
          Signing out keeps this phone's photos where they are; they're shown again when you sign back in.
        </p>
      </div>
      {isAdmin && <TeamSettings me={me} onChanged={onChanged} flash={flash} />}
    </>
  );
}

/* ---------------- settings ---------------- */

export function CloudProviderCard({ label, icon, connected, connecting, account, clientId, onClientId, onConnect, onDisconnect, error, portalHint, builtIn }) {
  return (
    <div className="ss-cloud-card">
      <div className="ss-cloud-head">
        <span className="ss-cloud-ic">{icon}</span>
        <span className="ss-cloud-label">{label}</span>
        {connected && <span className="ss-cloud-connected"><CircleCheck size={12} /> Connected{account ? ` — ${account}` : ""}</span>}
      </div>
      {/* builtIn: whoever runs this deployment already registered an app and
          baked its client ID in — every surveyor using it just signs in,
          with no ID to find or paste. Falls back to manual entry when
          nobody's done that (e.g. someone running their own copy). */}
      {!connected && !builtIn && (
        <>
          <input
            className="ss-input" placeholder="App (client) ID"
            value={clientId} onChange={(e) => onClientId(e.target.value)}
            autoCapitalize="none" autoComplete="off"
          />
          <p className="ss-fineprint" style={{ margin: "6px 2px 0" }}>{portalHint}</p>
        </>
      )}
      {error && <p className="ss-fineprint" style={{ color: "var(--red)", margin: "6px 2px 0" }}>{error}</p>}
      <button
        className={`ss-btn ${connected ? "ss-btn-ghost" : "ss-btn-primary"}`}
        style={{ marginTop: 10 }}
        disabled={connecting || (!connected && !builtIn && !clientId.trim())}
        onClick={connected ? onDisconnect : onConnect}
      >
        {connecting ? <Loader2 size={16} className="ss-spin" /> : connected ? "Disconnect" : `Connect ${label}`}
      </button>
    </div>
  );
}

export function SettingsScreen({ fieldMode, onToggleFieldMode, onTab, me, onSignOut, onMeChanged }) {
  const [hookUrl, setHookUrl] = useState("");
  const [hookKey, setHookKey] = useState("");
  const [savedNote, setSavedNote] = useState(null);

  const [msClientId, setMsClientId] = useState("");
  const [msAccountName, setMsAccountName] = useState(null);
  const [msBusy, setMsBusy] = useState(false);
  const [msError, setMsError] = useState(null);

  const [googleClientId, setGoogleClientId] = useState("");
  const [googleOn, setGoogleOn] = useState(false);
  const [googleAccount, setGoogleAccount] = useState(null);
  const [googleBusy, setGoogleBusy] = useState(false);
  const [googleError, setGoogleError] = useState(null);

  // which providers this deployment's cloud-link service can sign in for
  // (server/index.js) — when one can, the in-browser client-ID flow below
  // is bypassed for it entirely
  const [svc, setSvc] = useState({ onedrive: false, google: false });

  const [storage, setStorage] = useState(null);
  const [durable, setDurable] = useState(null);

  useEffect(() => {
    loadWebhook().then((u) => setHookUrl(u || ""));
    loadWebhookKey().then((k) => setHookKey(k || ""));
    cloudServiceConfig().then(setSvc);
    (async () => {
      const link = await linkedAccount("onedrive");
      const id = await loadMsClientId();
      setMsClientId(id || "");
      if (link) { setMsAccountName(link.account || "connected"); return; }
      // MSAL's cache lives in localStorage, so a returning surveyor can
      // already be signed in — only pull the library in if there's an ID
      // to check against.
      if (!id) return;
      const { msAccount } = await loadMsGraph();
      const acc = await msAccount(id);
      if (acc) setMsAccountName(acc.username);
    })();
    (async () => {
      const link = await linkedAccount("google");
      const id = await loadGoogleClientId();
      setGoogleClientId(id || "");
      if (link) { setGoogleOn(true); setGoogleAccount(link.account || null); return; }
      // Google's access token is memory-only (see cloud/googleDrive.js) and
      // doesn't survive a reload on its own — but if the browser still has a
      // live Google session, a silent (no-popup) request usually gets a new
      // one without asking the surveyor to sign in again every time.
      if (!id) return;
      const { trySilentGoogleReconnect } = await loadGoogleDrive();
      setGoogleOn(await trySilentGoogleReconnect(id));
    })();
    storageEstimate().then(setStorage);
    if (navigator.storage && navigator.storage.persisted) navigator.storage.persisted().then(setDurable);
  }, []);

  function flash(msg) { setSavedNote(msg); setTimeout(() => setSavedNote(null), 2500); }

  async function saveHook() {
    await saveWebhook(hookUrl.trim());
    await saveWebhookKey(hookKey.trim());
    flash("Cloud upload link saved");
  }

  async function connectMs() {
    setMsBusy(true); setMsError(null);
    // the sign-in window has to be opened inside the tap itself, before any
    // await, or Safari's popup blocker eats it (see cloud/service.js)
    const win = svc.onedrive ? window.open("about:blank", "_blank") : null;
    try {
      if (svc.onedrive) {
        const acct = await beginLink("onedrive", win);
        if (acct === null && !win) return; // this tab is navigating to the sign-in
        setMsAccountName(acct || "connected");
      } else {
        await saveMsClientId(msClientId.trim());
        const { connectOneDrive } = await loadMsGraph();
        const acc = await connectOneDrive(msClientId.trim());
        setMsAccountName(acc.username);
      }
      flash("OneDrive connected");
    } catch (e) {
      try { win && win.close(); } catch { /* already gone */ }
      setMsError(e && e.message ? e.message : "Couldn't connect to OneDrive.");
    } finally { setMsBusy(false); }
  }
  async function disconnectMs() {
    setMsBusy(true);
    if (await linkedAccount("onedrive")) {
      await unlink("onedrive");
    } else {
      const { disconnectOneDrive } = await loadMsGraph();
      await disconnectOneDrive(msClientId.trim());
    }
    setMsAccountName(null);
    setMsBusy(false);
  }

  async function connectGoogle() {
    setGoogleBusy(true); setGoogleError(null);
    const win = svc.google ? window.open("about:blank", "_blank") : null;
    try {
      if (svc.google) {
        const acct = await beginLink("google", win);
        if (acct === null && !win) return;
        setGoogleAccount(acct || null);
      } else {
        await saveGoogleClientId(googleClientId.trim());
        const { connectGoogleDrive } = await loadGoogleDrive();
        await connectGoogleDrive(googleClientId.trim());
      }
      setGoogleOn(true);
      flash("Google Drive connected");
    } catch (e) {
      try { win && win.close(); } catch { /* already gone */ }
      setGoogleError(e && e.message ? e.message : "Couldn't connect to Google Drive.");
    } finally { setGoogleBusy(false); }
  }
  async function disconnectGoogle() {
    if (await linkedAccount("google")) {
      await unlink("google");
    } else {
      const { disconnectGoogleDrive } = await loadGoogleDrive();
      disconnectGoogleDrive();
    }
    setGoogleOn(false);
    setGoogleAccount(null);
  }

  const serviceOn = svc.onedrive || svc.google;

  return (
    <div className="ss-col">
      <div className="ss-home-top">
        <div>
          <div className="ss-eyebrow-sm">SiteSnap</div>
          <div className="ss-title-lg">Settings</div>
        </div>
      </div>
      <div className="ss-scroll">
        {me && me.mode === "accounts" && me.user && (
          <AccountCard me={me} onSignOut={onSignOut} onChanged={onMeChanged} flash={flash} />
        )}
        <div className="ss-section-label" style={{ marginTop: me && me.mode === "accounts" ? 20 : 4 }}>Direct cloud link</div>
        <p className="ss-fineprint" style={{ margin: "0 2px 10px" }}>
          {serviceOn
            ? "Sign in once with your own Microsoft or Google account. SiteSnap keeps the connection and files straight into your OneDrive or Drive — no sign-in prompts after that."
            : "Sign in with your own Microsoft or Google account and SiteSnap writes straight into your OneDrive or Drive — no Make/n8n/Zapier scenario needed. Requires a free app registration in Azure or Google Cloud; see the setup guide in the repo's docs."}
        </p>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <CloudProviderCard
            label="OneDrive" icon={<CloudUpload size={16} />}
            connected={!!msAccountName} connecting={msBusy} account={msAccountName}
            clientId={msClientId} onClientId={setMsClientId}
            onConnect={connectMs} onDisconnect={disconnectMs} error={msError}
            builtIn={svc.onedrive || hasBuiltInMsClientId()}
            portalHint="From portal.azure.com → App registrations → New registration (SPA, redirect URI = this app's URL)."
          />
          <CloudProviderCard
            label="Google Drive" icon={<CloudUpload size={16} />}
            connected={googleOn} connecting={googleBusy} account={googleAccount}
            clientId={googleClientId} onClientId={setGoogleClientId}
            onConnect={connectGoogle} onDisconnect={disconnectGoogle} error={googleError}
            builtIn={svc.google || hasBuiltInGoogleClientId()}
            portalHint="From console.cloud.google.com → APIs & Services → Credentials → OAuth client ID (Web application)."
          />
        </div>

        <div className="ss-section-label" style={{ marginTop: 20 }}>Cloud upload via Make / n8n / Zapier</div>
        <input
          className="ss-input" placeholder="https://your-n8n.app/webhook/inspections"
          value={hookUrl} onChange={(e) => setHookUrl(e.target.value)}
          inputMode="url" autoCapitalize="none"
        />
        <div className="ss-key-row" style={{ marginTop: 8 }}>
          <KeyRound size={14} />
          <input
            className="ss-input" placeholder="Access key (optional)"
            value={hookKey} onChange={(e) => setHookKey(e.target.value)}
            autoCapitalize="none" autoComplete="off"
          />
        </div>
        <p className="ss-fineprint" style={{ margin: "8px 2px 0" }}>
          Photos, voice notes and a site-notes file are POSTed with the address
          and folder name, and your workflow files them into OneDrive or
          Google Drive. Set an access key here and in your webhook so only
          this phone can upload.
        </p>
        <button className="ss-btn ss-btn-primary" style={{ marginTop: 10 }} onClick={saveHook}>Save link</button>

        <div className="ss-section-label" style={{ marginTop: 20 }}>Display</div>
        <div className="ss-settings-row">
          <span className="ss-settings-ic">{fieldMode ? <Moon size={17} /> : <Sun size={17} />}</span>
          <div style={{ flex: 1 }}>
            <div className="ss-settings-title">Field mode</div>
            <div className="ss-settings-sub">High-contrast dark theme for bright daylight</div>
          </div>
          <button
            className={`ss-toggle ${fieldMode ? "on" : ""}`}
            role="switch" aria-checked={fieldMode} onClick={onToggleFieldMode}
          ><span /></button>
        </div>

        <div className="ss-section-label" style={{ marginTop: 20 }}>Camera</div>
        <CameraCheck />

        <div className="ss-section-label" style={{ marginTop: 20 }}>Storage on this phone</div>
        <div className="ss-storage-card">
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <HardDrive size={15} color={durable ? "var(--pine)" : "var(--amber)"} />
            <span style={{ fontWeight: 700, fontSize: 13 }}>
              {durable === null ? "Checking storage…" : durable ? "Durable storage granted" : "Durable storage not granted yet"}
            </span>
          </div>
          {storage && storage.quota ? (
            <>
              <div className="ss-progress" style={{ marginTop: 10 }}>
                <div style={{ width: `${Math.min(100, Math.round((storage.usage / storage.quota) * 100))}%` }} />
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", marginTop: 6, fontSize: 12, fontWeight: 600, color: "var(--muted)" }}>
                <span>{Math.round(storage.usage / 1048576)} MB used</span>
                <span>{storage.freeMB} MB free</span>
              </div>
            </>
          ) : (
            <p className="ss-fineprint" style={{ margin: "8px 2px 0" }}>This browser doesn't report storage usage.</p>
          )}
        </div>

        <div className="ss-section-label" style={{ marginTop: 20 }}>About</div>
        <div className="ss-storage-card" style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <span style={{ fontWeight: 700, fontSize: 13 }}>SiteSnap</span>
          <span style={{ fontSize: 12, fontWeight: 600, color: "var(--muted)" }}>Version 2.1.0</span>
        </div>

        {savedNote && <div className="ss-note" style={{ marginTop: 10 }}>{savedNote}</div>}
        <div style={{ height: 16 }} />
      </div>
      <TabBar active="settings" onChange={onTab} />
    </div>
  );
}

/* ---------------- camera diagnostics ---------------- */
// What the browser on *this* phone actually exposes: which lens it opens,
// whether a zoom range is offered and how far it goes, and every camera
// it can see. Which of those is missing decides whether a wide shot can
// ever come from the in-page feed or has to borrow the phone's camera app.
export function CameraCheck() {
  const [report, setReport] = useState(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  async function run() {
    setBusy(true);
    const lines = [];
    let stream = null;
    try {
      const md = navigator.mediaDevices;
      if (!md || !md.getUserMedia) {
        lines.push("Live camera API not available in this browser.");
      } else {
        stream = await md.getUserMedia({ video: { facingMode: { ideal: "environment" } }, audio: false });
        const track = stream.getVideoTracks()[0];
        lines.push(`Camera in use: ${track.label || "(no label)"}`);
        const s = track.getSettings ? track.getSettings() : {};
        lines.push(`Feed: ${s.width || "?"}×${s.height || "?"}, facing ${s.facingMode || "?"}${typeof s.zoom === "number" ? `, zoom ${s.zoom}×` : ""}`);
        const c = track.getCapabilities ? track.getCapabilities() : null;
        if (c && c.zoom && typeof c.zoom.min === "number") lines.push(`Zoom range offered: ${c.zoom.min}× – ${c.zoom.max}× (step ${c.zoom.step})`);
        else lines.push("Zoom range offered: none");
        const cams = (await md.enumerateDevices()).filter((d) => d.kind === "videoinput");
        lines.push(`Cameras the browser can see (${cams.length}):`);
        cams.forEach((d, i) => lines.push(`  ${i + 1}. ${d.label || "(unnamed)"}`));
      }
    } catch (e) {
      lines.push(`Couldn't open the camera: ${(e && e.name) || e}`);
    } finally {
      if (stream) stream.getTracks().forEach((t) => t.stop());
      lines.push(`Browser: ${navigator.userAgent}`);
      setReport(lines.join("\n"));
      setBusy(false);
    }
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(report);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* clipboard blocked — the text is still on screen to screenshot */ }
  }

  return (
    <div className="ss-storage-card">
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <Aperture size={15} color="var(--pine)" />
        <span style={{ fontWeight: 700, fontSize: 13 }}>Camera check</span>
      </div>
      <p className="ss-fineprint" style={{ margin: "6px 2px 0" }}>
        Shows which lens and zoom range this phone's browser lets the live camera use — handy if wide shots look tighter than in the phone's own camera app.
      </p>
      <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
        <button className="ss-btn ss-btn-primary" style={{ flex: 1 }} onClick={run} disabled={busy}>
          {busy ? <Loader2 size={15} className="ss-spin" /> : <Aperture size={15} />} {report ? "Check again" : "Check this phone's camera"}
        </button>
        {report && (
          <button className="ss-btn ss-btn-ghost" style={{ flex: "0 0 auto" }} onClick={copy}>
            {copied ? <Check size={15} /> : <FileText size={15} />} {copied ? "Copied" : "Copy"}
          </button>
        )}
      </div>
      {report && <pre className="ss-camcheck">{report}</pre>}
    </div>
  );
}
