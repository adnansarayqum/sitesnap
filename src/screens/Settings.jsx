import { useEffect, useState } from "react";
import {
  Aperture, Check, CircleCheck, CloudUpload, FileText, Link2, Loader2, Moon, Sun,
} from "lucide-react";
import {
  storageEstimate, loadMsClientId, saveMsClientId, hasBuiltInMsClientId,
  loadWebhook, saveWebhook, loadWebhookKey, saveWebhookKey,
} from "../storage.js";
import { loadMsGraph } from "../cloud/lazy.js";
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
      <div className="ss-key-row">
        <input className="ss-input" placeholder="Your name" value={name} onChange={(e) => setName(e.target.value)} aria-label="Your name" />
        <button className="ss-btn ss-btn-primary" disabled={busy || name.trim() === (me.user.name || "")}
          onClick={async () => { setBusy(true); try { await updateName(name.trim()); onChanged(); flash("Name saved"); } finally { setBusy(false); } }}>Save</button>
      </div>
      <div className="ss-ledger-row">
        <div className="ss-ledger-main"><div className="ss-ledger-title">Signed in as</div></div>
        <span className="ss-ledger-status" style={{ color: "var(--ink)", fontWeight: 700 }}>{me.user.email}</span>
      </div>
      {me.org && (
        <div className="ss-ledger-row">
          <div className="ss-ledger-main">
            <div className="ss-ledger-title">{me.org.name}</div>
            <div className="ss-ledger-sub">Firm</div>
          </div>
          {me.orgs && me.orgs.length > 1 ? (
            <select className="ss-role-select" value={me.org.id} aria-label="Firm"
              onChange={async (e) => { await switchOrg(e.target.value); onChanged(); }}>
              {me.orgs.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
            </select>
          ) : (
            <span className="ss-role-pill">{me.org.role}</span>
          )}
        </div>
      )}
      <div className="ss-ledger-row ss-no-border">
        <button className="ss-link" style={{ color: "var(--red)" }} onClick={onSignOut}>Sign out</button>
        <span className="ss-fineprint" style={{ margin: 0, textAlign: "right", flex: 1 }}>
          Photos on this phone stay put — sign back in to see them.
        </span>
      </div>
      {isAdmin && <TeamSettings me={me} onChanged={onChanged} flash={flash} />}
    </>
  );
}

/* ---------------- settings ---------------- */

export function CloudProviderCard({ label, icon, connected, connecting, account, clientId, onClientId, onConnect, onDisconnect, error, portalHint, builtIn }) {
  return (
    <div>
      <div className="ss-ledger-row">
        <span className="ss-ledger-ic">{icon}</span>
        <div className="ss-ledger-main">
          <div className="ss-ledger-title">{label}</div>
          {connected && account && <div className="ss-ledger-sub">{account}</div>}
        </div>
        {connecting ? (
          <Loader2 size={16} className="ss-spin" />
        ) : connected ? (
          <>
            <span className="ss-cloud-connected"><CircleCheck size={12} /> Connected</span>
            <button className="ss-link" onClick={onDisconnect}>Disconnect</button>
          </>
        ) : (
          <button className="ss-link" disabled={!builtIn && !clientId.trim()} onClick={onConnect}>
            Connect {label}
          </button>
        )}
      </div>
      {/* builtIn: whoever runs this deployment already registered an app and
          baked its client ID in — every surveyor using it just signs in,
          with no ID to find or paste. Falls back to manual entry when
          nobody's done that (e.g. someone running their own copy). */}
      {!connected && !builtIn && (
        <div style={{ padding: "0 0 12px" }}>
          <input
            className="ss-input" placeholder="App (client) ID"
            value={clientId} onChange={(e) => onClientId(e.target.value)}
            autoCapitalize="none" autoComplete="off"
          />
          <p className="ss-fineprint" style={{ margin: "6px 2px 0" }}>{portalHint}</p>
        </div>
      )}
      {error && <p className="ss-fineprint" style={{ color: "var(--red)", margin: "0 2px 10px" }}>{error}</p>}
    </div>
  );
}

// A firm's own CRM/case-management system, or a Make/Zapier/n8n scenario in
// front of one, can receive the same structured export the direct OneDrive/
// Google upload sends — this just lets the address be configured. Admin-
// gated in accounts mode (it's a firm-wide routing decision, not a personal
// preference) and off until someone deliberately sets an address, so it
// never adds a step for a firm that only ever wants OneDrive.
function CrmWebhookCard({ flash }) {
  const [url, setUrl] = useState("");
  const [key, setKey] = useState("");
  const [saved, setSaved] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    loadWebhook().then((u) => { setUrl(u || ""); setSaved(!!u); if (u) setOpen(true); });
    loadWebhookKey().then((k) => setKey(k || ""));
  }, []);

  async function save() {
    await saveWebhook(url.trim());
    await saveWebhookKey(key.trim());
    setSaved(!!url.trim());
    flash(url.trim() ? "CRM export link saved" : "CRM export link cleared");
  }

  return (
    <div style={{ marginTop: 24 }}>
      <button className="ss-settings-row" style={{ width: "100%", textAlign: "left" }} onClick={() => setOpen((o) => !o)}>
        <span className="ss-settings-ic"><Link2 size={17} /></span>
        <div style={{ flex: 1 }}>
          <div className="ss-settings-title">CRM / ERP export</div>
          <div className="ss-settings-sub">{saved ? "An export link is set" : "Off — send exports to your own system instead"}</div>
        </div>
      </button>
      {open && (
        <div style={{ padding: "0 0 12px" }}>
          <input
            className="ss-input" placeholder="https://your-crm-or-scenario.example.com/hook"
            value={url} onChange={(e) => setUrl(e.target.value)}
            autoCapitalize="none" autoComplete="off"
          />
          <input
            className="ss-input" style={{ marginTop: 8 }} placeholder="Access key (optional)"
            value={key} onChange={(e) => setKey(e.target.value)}
            autoCapitalize="none" autoComplete="off"
          />
          <p className="ss-fineprint" style={{ margin: "6px 2px 0" }}>
            Every export also POSTs the same photos, voice notes and structured findings JSON here — point it at your firm's CRM, or at a Make/Zapier/n8n scenario in front of one. Leave the address blank to keep exports going to OneDrive only.
          </p>
          <button className="ss-btn ss-btn-primary" style={{ marginTop: 10 }} onClick={save}>Save</button>
        </div>
      )}
    </div>
  );
}

export function SettingsScreen({ fieldMode, onToggleFieldMode, onTab, me, onSignOut, onMeChanged }) {
  const [savedNote, setSavedNote] = useState(null);
  const isAdmin = !me || me.mode !== "accounts" || (me.org && ["owner", "admin"].includes(me.org.role));

  const [msClientId, setMsClientId] = useState("");
  const [msAccountName, setMsAccountName] = useState(null);
  const [msBusy, setMsBusy] = useState(false);
  const [msError, setMsError] = useState(null);

  // whether this deployment's cloud-link service can sign in for OneDrive
  // (server/index.js) — when it can, the in-browser client-ID flow below
  // is bypassed entirely
  const [svc, setSvc] = useState({ onedrive: false, google: false });

  const [storage, setStorage] = useState(null);
  const [durable, setDurable] = useState(null);

  useEffect(() => {
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
    storageEstimate().then(setStorage);
    if (navigator.storage && navigator.storage.persisted) navigator.storage.persisted().then(setDurable);
  }, []);

  function flash(msg) { setSavedNote(msg); setTimeout(() => setSavedNote(null), 2500); }

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

  const serviceOn = svc.onedrive;

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
        <div className="ss-section-label" style={{ marginTop: me && me.mode === "accounts" ? 20 : 4 }}>Photos file to</div>
        <div>
          <CloudProviderCard
            label="OneDrive" icon={<CloudUpload size={16} />}
            connected={!!msAccountName} connecting={msBusy} account={msAccountName}
            clientId={msClientId} onClientId={setMsClientId}
            onConnect={connectMs} onDisconnect={disconnectMs} error={msError}
            builtIn={svc.onedrive || hasBuiltInMsClientId()}
            portalHint="From portal.azure.com → App registrations → New registration (SPA, redirect URI = this app's URL)."
          />
        </div>
        <p className="ss-fineprint" style={{ margin: "8px 2px 0" }}>
          {serviceOn ? "One sign-in, then photos file themselves as you shoot." : "No sign-in prompts to remember at the end of the day."}
        </p>

        <div className="ss-section-label" style={{ marginTop: 24 }}>Display</div>
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

        {isAdmin && <CrmWebhookCard flash={flash} />}

        <div className="ss-section-label" style={{ marginTop: 20 }}>This phone</div>
        <CameraCheck />
        <div className="ss-ledger-row">
          <div className="ss-ledger-main">
            <div className="ss-ledger-title">Storage</div>
            <div className="ss-ledger-sub">
              {durable === null ? "Checking…" : durable ? "Durable storage granted" : "Durable storage not granted yet"}
            </div>
          </div>
          <span className="ss-ledger-status">
            {storage && storage.quota ? `${Math.round(storage.usage / 1048576)} MB used · ${storage.freeMB} MB free` : "—"}
          </span>
        </div>
        {storage && storage.quota && (
          <div className="ss-progress" style={{ marginTop: -6, marginBottom: 14 }}>
            <div style={{ width: `${Math.min(100, Math.round((storage.usage / storage.quota) * 100))}%` }} />
          </div>
        )}

        <div className="ss-ledger-row ss-no-border" style={{ marginTop: 10, color: "var(--muted2)" }}>
          <span className="ss-ledger-title" style={{ fontWeight: 600, color: "var(--muted2)" }}>SiteSnap</span>
          <span className="ss-ledger-status">Version 2.1.0</span>
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
