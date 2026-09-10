import { useEffect, useState } from "react";
import { Loader2, UserPlus, Copy, Check } from "lucide-react";
import { listMembers, listInvites, listAudit, sendInvite, cancelInvite, setMemberRole, removeMember, renameOrg } from "../auth.js";
import { relativeDay } from "./Home.jsx";

/* ---------------- team (admins) ---------------- */

const ROLE_LABEL = { owner: "Owner", admin: "Admin", surveyor: "Surveyor" };

export function TeamSettings({ me, onChanged, flash }) {
  const [members, setMembers] = useState(null);
  const [invites, setInvites] = useState([]);
  const [events, setEvents] = useState([]);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("surveyor");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [lastLink, setLastLink] = useState(null);
  const [copied, setCopied] = useState(false);
  const [orgName, setOrgName] = useState(me.org.name);
  const [pilot, setPilot] = useState(null);
  const isOwner = me.org.role === "owner";
  useEffect(() => { fetch("/api/admin/pilot", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).then(setPilot).catch(() => {}); }, []);

  async function refresh() {
    try {
      const [m, i, a] = await Promise.all([listMembers(), listInvites(), listAudit().catch(() => ({ events: [] }))]);
      setMembers(m.members); setInvites(i.invites); setEvents(a.events || []);
    } catch (e) { setError(e.message); }
  }
  useEffect(() => { refresh(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function act(fn, okMsg) {
    setBusy(true); setError(null);
    try { await fn(); if (okMsg) flash(okMsg); await refresh(); }
    catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }

  async function invite(e) {
    e.preventDefault();
    await act(async () => {
      const r = await sendInvite(email.trim(), role);
      setLastLink({ email: email.trim(), link: r.link, delivered: r.delivered });
      setEmail("");
    }, null);
  }

  async function copy(text) {
    try { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { /* shown on screen anyway */ }
  }

  return (
    <>
      {pilot && pilot.members && (
        <>
          <div className="ss-section-label" style={{ marginTop: 20 }}>Pilot — who's actually using it</div>
          <div className="ss-pilot">
            {pilot.members.map((m) => (
              <div key={m.id} className="ss-pilot-row">
                <div className="ss-pilot-who"><b>{m.name}</b><span>{ROLE_LABEL[m.role] || m.role} · joined {relativeDay(new Date(m.joined_at).getTime())}{m.last_event_at ? ` · last active ${relativeDay(new Date(m.last_event_at).getTime())}` : " · not yet active"}</span></div>
                <div className="ss-pilot-stats">
                  <span title="Cases created"><b>{m.cases}</b> case{m.cases === 1 ? "" : "s"}</span>
                  <span title="Inspections finished"><b>{m.inspections_completed}</b> finished</span>
                  <span title="Issues raised"><b>{m.issues}</b> issues</span>
                  <span title="Photos taken"><b>{m.photos}</b> photos</span>
                  <span title="Findings drafted / approved / edited / rejected"><b>{m.findings_drafted}</b>/{m.findings_approved}/{m.findings_edited}/{m.findings_rejected} findings</span>
                  <span title="Reports generated"><b>{m.reports}</b> report{m.reports === 1 ? "" : "s"}</span>
                  <span title="Weeks with real use"><b>{m.active_weeks}</b> active wk</span>
                  {m.feedback ? <span><b>{m.feedback}</b> feedback</span> : null}
                </div>
              </div>
            ))}
          </div>
          {pilot.feedback && pilot.feedback.length > 0 && (
            <>
              <div className="ss-section-label" style={{ marginTop: 16 }}>Feedback</div>
              <div className="ss-activity">
                {pilot.feedback.slice(0, 15).map((f) => (
                  <div key={f.id} className="ss-activity-row">
                    <span className="ss-activity-time">{relativeDay(new Date(f.created_at).getTime())}</span>
                    <span className="ss-activity-dot" />
                    <span className="ss-activity-text"><b>{f.kind.replace(/_/g, " ")}</b> — {f.who}{f.screen ? ` · ${f.screen}` : ""}{f.text ? `: ${f.text}` : ""}</span>
                  </div>
                ))}
              </div>
            </>
          )}
        </>
      )}
      <div className="ss-section-label" style={{ marginTop: 20 }}>Firm</div>
      <div className="ss-key-row">
        <input className="ss-input" value={orgName} onChange={(e) => setOrgName(e.target.value)} aria-label="Firm name" />
        <button className="ss-btn ss-btn-primary" disabled={busy || orgName.trim().length < 2 || orgName.trim() === me.org.name}
          onClick={() => act(async () => { await renameOrg(orgName.trim()); onChanged(); }, "Firm renamed")}>Save</button>
      </div>

      <div className="ss-section-label" style={{ marginTop: 22 }}>Invite by email</div>
      <form onSubmit={invite} style={{ display: "flex", gap: 8 }}>
        <input className="ss-input" type="email" inputMode="email" autoCapitalize="none" placeholder="their@email.co.uk"
          value={email} onChange={(e) => setEmail(e.target.value)} required />
        <button className="ss-btn ss-btn-primary ss-btn-sq" disabled={busy || !email.trim()} aria-label="Send invite">
          {busy ? <Loader2 size={15} className="ss-spin" /> : <UserPlus size={15} />}
        </button>
      </form>
      <div className="ss-key-row" style={{ marginTop: 8 }}>
        <select className="ss-role-select" value={role} onChange={(e) => setRole(e.target.value)} aria-label="Role">
          <option value="surveyor">Surveyor — shoots and files cases</option>
          <option value="admin">Admin — also manages the team</option>
        </select>
      </div>
      {lastLink && (
        <div className="ss-invite-result">
          <div style={{ fontWeight: 700, fontSize: 13 }}>
            {lastLink.delivered ? `Invitation emailed to ${lastLink.email}.` : `Invitation ready for ${lastLink.email}.`}
          </div>
          <p className="ss-fineprint" style={{ margin: "4px 0 8px" }}>
            {lastLink.delivered ? "You can also send them this link directly:" : "Email isn't set up on this deployment — send them this link (WhatsApp is fine). It works for 14 days."}
          </p>
          <div className="ss-key-row">
            <input className="ss-input" readOnly value={lastLink.link} onFocus={(e) => e.target.select()} aria-label="Invitation link" />
            <button className="ss-btn ss-btn-ghost" onClick={() => copy(lastLink.link)}>{copied ? <Check size={15} /> : <Copy size={15} />}</button>
          </div>
        </div>
      )}

      <div className="ss-section-label" style={{ marginTop: 22 }}>Team</div>
      {members === null ? (
        <div style={{ display: "flex", justifyContent: "center", padding: 10 }}><Loader2 size={18} className="ss-spin" /></div>
      ) : (
        <div>
          <div className="ss-team-head"><span>Name</span><span>Role</span><span>Active</span></div>
          {members.map((m) => {
            const self = m.id === me.user.id;
            const canEdit = !self && (isOwner || m.role !== "owner");
            return (
              <div key={m.id} className="ss-team-row">
                <div style={{ minWidth: 0 }}>
                  <div className="ss-member-name">{m.name || m.email}{self ? " (you)" : ""}</div>
                  <div className="ss-member-sub">{m.name ? m.email : ""}</div>
                </div>
                {canEdit ? (
                  <select className="ss-role-select" value={m.role} disabled={busy} aria-label={`Role for ${m.email}`}
                    onChange={(e) => act(() => setMemberRole(m.id, e.target.value), "Role updated")}>
                    {isOwner && <option value="owner">Owner</option>}
                    <option value="admin">Admin</option>
                    <option value="surveyor">Surveyor</option>
                  </select>
                ) : (
                  <span style={{ fontSize: 13, fontWeight: 700 }}>{ROLE_LABEL[m.role]}</span>
                )}
                {canEdit ? (
                  <button className="ss-team-cancel" disabled={busy} aria-label={`Remove ${m.email}`} title="Remove from the firm"
                    onClick={() => { if (window.confirm(`Remove ${m.name || m.email} from ${me.org.name}? Their cases on their own phone are untouched.`)) act(() => removeMember(m.id), "Removed"); }}>
                    Remove
                  </button>
                ) : (
                  <span className="ss-team-active">{m.last_seen_at ? relative(m.last_seen_at) : "never"}</span>
                )}
              </div>
            );
          })}
          {invites.map((i) => (
            <div key={i.id} className="ss-team-row">
              <div style={{ minWidth: 0 }}>
                <div className="ss-member-name">{i.email}</div>
                <div className="ss-member-sub">expires {relative(i.expires_at)}</div>
              </div>
              <span className="ss-team-pending">Pending</span>
              <button className="ss-team-cancel" disabled={busy} aria-label={`Cancel invitation for ${i.email}`}
                onClick={() => act(() => cancelInvite(i.id), "Invitation cancelled")}>Cancel</button>
            </div>
          ))}
        </div>
      )}
      {error && <p className="ss-fineprint ss-error" role="alert" style={{ marginTop: 8 }}>{error}</p>}

      {events.length > 0 && (
        <>
          <div className="ss-section-label" style={{ marginTop: 20 }}>Recent activity</div>
          <div className="ss-activity">
            {events.slice(0, 20).map((e, i) => (
              <div key={i} className="ss-activity-row">
                <span className="ss-activity-time">{relative(e.at)}</span>
                <span className="ss-activity-dot" />
                <span className="ss-activity-text">{describe(e)}</span>
              </div>
            ))}
          </div>
        </>
      )}
    </>
  );
}

function describe(e) {
  const who = e.who || "someone";
  const d = e.detail || {};
  switch (e.action) {
    case "org.created": return `${who} created the firm`;
    case "org.renamed": return `${who} renamed the firm to ${e.target}`;
    case "invite.sent": return `${who} invited ${e.target}${d.role ? ` as ${d.role}` : ""}`;
    case "invite.accepted": return `${e.target} joined${d.role ? ` as ${d.role}` : ""}`;
    case "member.role": return `${who} changed a member's role to ${d.role}`;
    case "member.removed": return `${who} removed a member`;
    case "case.created": return `${who} opened case${d.case_no ? ` No. ${d.case_no}` : ""}`;
    case "case.deleted": return `${who} discarded a case`;
    case "signin": return `${who} signed in with ${e.target === "google" ? "Google" : "Microsoft"}`;
    default: return `${who}: ${e.action}`;
  }
}

function relative(ts) {
  const d = (new Date(ts).getTime() - Date.now()) / 1000;
  const abs = Math.abs(d);
  const unit = abs < 3600 ? [Math.round(abs / 60), "min"] : abs < 86400 ? [Math.round(abs / 3600), "h"] : [Math.round(abs / 86400), "d"];
  return d < 0 ? `${unit[0]}${unit[1]} ago` : `in ${unit[0]}${unit[1]}`;
}
