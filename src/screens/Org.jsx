import { useState } from "react";
import { Building2, Loader2, ArrowRight, Users } from "lucide-react";
import { createOrg, acceptInvite, switchOrg, clearPendingInvite } from "../auth.js";

/* ---------------- firm setup ---------------- */
// Reached once signed in but not yet in a firm: accept the invitation the
// phone carried in, pick one of the firms this person already belongs to,
// or start a new one (which makes them its owner).

export function OrgScreen({ me, invite, inviteToken, onDone, onSignOut }) {
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const orgs = (me && me.orgs) || [];

  async function run(fn) {
    setBusy(true); setError(null);
    try { await fn(); onDone(); }
    catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }

  return (
    <div className="ss-col">
      <div className="ss-home-hero ss-signin">
        <div className="ss-mark"><Building2 size={20} strokeWidth={2.4} /></div>
        <div className="ss-eyebrow">Signed in as {me.user.email}</div>
        <h1 className="ss-h1">Your firm</h1>

        {invite && inviteToken && (
          <div className="ss-org-card">
            <div className="ss-org-card-title"><Users size={15} /> Join {invite.org_name}</div>
            <p className="ss-fineprint" style={{ margin: "4px 0 10px" }}>
              Invitation for {invite.email}{invite.role === "admin" ? " (admin)" : ""}.
            </p>
            <button className="ss-btn ss-btn-primary ss-btn-big" disabled={busy}
              onClick={() => run(async () => { await acceptInvite(inviteToken); clearPendingInvite(); })}>
              {busy ? <Loader2 size={18} className="ss-spin" /> : <ArrowRight size={18} />} Accept and join
            </button>
          </div>
        )}

        {orgs.length > 0 && (
          <div className="ss-org-card">
            <div className="ss-org-card-title">Firms you belong to</div>
            {orgs.map((o) => (
              <button key={o.id} className="ss-org-row" disabled={busy} onClick={() => run(() => switchOrg(o.id))}>
                <span>{o.name}</span><span className="ss-role-pill">{o.role}</span>
              </button>
            ))}
          </div>
        )}

        <div className="ss-org-card">
          <div className="ss-org-card-title">Start a new firm</div>
          <p className="ss-fineprint" style={{ margin: "4px 0 10px" }}>
            You'll be its owner and can invite surveyors and admins from Settings.
          </p>
          <input className="ss-input" placeholder="Firm name" value={name} onChange={(e) => setName(e.target.value)} />
          <button className="ss-btn ss-btn-primary ss-btn-big" style={{ marginTop: 10 }} disabled={busy || name.trim().length < 2}
            onClick={() => run(() => createOrg(name.trim()))}>
            {busy ? <Loader2 size={18} className="ss-spin" /> : <ArrowRight size={18} />} Create firm
          </button>
        </div>

        {error && <p className="ss-fineprint ss-error" role="alert">{error}</p>}
      </div>
      <div className="ss-footer" style={{ textAlign: "center" }}>
        <button className="ss-link" onClick={onSignOut}>Sign out</button>
      </div>
    </div>
  );
}
