import { useState, useRef, useEffect } from "react";
import { Camera, Loader2, Mail, ArrowRight } from "lucide-react";
import { requestCode, verifyCode, oauthSignIn } from "../auth.js";

/* ---------------- sign in ---------------- */
// No passwords: a six-digit code by email, or Microsoft / Google. The
// Microsoft and Google routes also connect the person's OneDrive / Drive
// in the same step, so a surveyor on 365 is fully set up in one tap.

export function SignInScreen({ config, invite, inviteToken, onSignedIn }) {
  const [step, setStep] = useState("email"); // email | code
  const [email, setEmail] = useState(invite ? invite.email : "");
  const [code, setCode] = useState(""); // digits only — the boxes below are its display
  const [codeFocused, setCodeFocused] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [delivery, setDelivery] = useState(null);
  const codeRef = useRef(null);

  useEffect(() => { if (invite && invite.email && !email) setEmail(invite.email); }, [invite]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (step === "code" && codeRef.current) codeRef.current.focus(); }, [step]);

  async function sendCode(e) {
    if (e) e.preventDefault();
    setBusy(true); setError(null);
    try {
      const r = await requestCode(email.trim());
      setDelivery(r.delivery);
      setCode("");
      setStep("code");
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }

  async function verify(e) {
    if (e) e.preventDefault();
    setBusy(true); setError(null);
    try {
      await verifyCode(email.trim(), code, inviteToken);
      onSignedIn();
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }

  async function oauth(provider) {
    setBusy(true); setError(null);
    // opened inside the tap so Safari doesn't block it — see auth.js
    const win = window.open("about:blank", "_blank");
    try {
      const r = await oauthSignIn(provider, win);
      if (r === null && !win) return; // this tab is navigating to the sign-in
      onSignedIn();
    } catch (err) {
      try { win && win.close(); } catch { /* already gone */ }
      setError(err.message);
    } finally { setBusy(false); }
  }

  return (
    <div className="ss-col">
      <div className="ss-home-hero ss-signin">
        <div className="ss-mark"><Camera size={20} strokeWidth={2.4} /></div>
        <div className="ss-eyebrow">SiteSnap</div>
        <h1 className="ss-h1">{step === "email" ? "Sign in" : "Check your email"}</h1>

        {invite && step === "email" && (
          <div className="ss-invite-banner">
            You've been invited to join <b>{invite.org_name}</b>{invite.role === "admin" ? " as an admin" : ""}.
            Sign in with <b>{invite.email}</b> to accept.
          </div>
        )}

        {step === "email" ? (
          <>
            <form onSubmit={sendCode}>
              <label className="ss-section-label" htmlFor="ss-email">Work email</label>
              <input
                id="ss-email" className="ss-input" type="email" inputMode="email" autoComplete="email"
                autoCapitalize="none" placeholder="you@firm.co.uk" value={email}
                onChange={(e) => setEmail(e.target.value)} required
              />
              <button className="ss-btn ss-btn-primary ss-btn-big" style={{ marginTop: 10 }} disabled={busy || !email.trim()}>
                {busy ? <Loader2 size={18} className="ss-spin" /> : <Mail size={18} />} Email me a code
              </button>
            </form>
            {(config.onedrive || config.google) && (
              <>
                <div className="ss-signin-oauth">
                  <span>Or continue with</span>
                  {config.onedrive && <button type="button" className="ss-link" disabled={busy} onClick={() => oauth("onedrive")}>Microsoft</button>}
                  {config.onedrive && config.google && <span className="ss-signin-dot">·</span>}
                  {config.google && <button type="button" className="ss-link" disabled={busy} onClick={() => oauth("google")}>Google</button>}
                </div>
                <p className="ss-fineprint" style={{ margin: "6px 2px 0" }}>
                  Microsoft or Google also connects your OneDrive or Drive.
                </p>
              </>
            )}
          </>
        ) : (
          <form onSubmit={verify}>
            <p className="ss-lede" style={{ marginBottom: 14 }}>
              We've sent a 6-digit code to <b>{email}</b>. It works for 10 minutes.
              {delivery === "log" && " This deployment has no email set up yet — the code is in the server log."}
            </p>
            <div className="ss-code-boxes" onClick={() => codeRef.current && codeRef.current.focus()}>
              {Array.from({ length: 6 }, (_, i) => (
                <div key={i} className={`ss-code-box ${i < code.length ? "filled" : ""} ${codeFocused && i === code.length ? "active" : ""}`}>
                  {code[i] || ""}
                </div>
              ))}
              <input
                ref={codeRef} className="ss-code-input" inputMode="numeric" autoComplete="one-time-code"
                value={code} maxLength={6} aria-label="Sign-in code"
                onFocus={() => setCodeFocused(true)} onBlur={() => setCodeFocused(false)}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
              />
            </div>
            <button className="ss-btn ss-btn-primary ss-btn-big" style={{ marginTop: 14 }} disabled={busy || code.length !== 6}>
              {busy ? <Loader2 size={18} className="ss-spin" /> : <ArrowRight size={18} />} Sign in
            </button>
            <div className="ss-signin-links">
              <button type="button" className="ss-link" onClick={() => { setStep("email"); setError(null); }}>Use a different email</button>
              <button type="button" className="ss-link" disabled={busy} onClick={sendCode}>Send a new code</button>
            </div>
          </form>
        )}

        {error && <p className="ss-fineprint ss-error" role="alert">{error}</p>}
      </div>
      <div className="ss-footer">
        <p className="ss-fineprint" style={{ margin: 0, textAlign: "center" }}>
          No passwords to remember. Your photos stay on this phone and in your own cloud drive.
        </p>
      </div>
    </div>
  );
}
