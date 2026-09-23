import { useEffect, useState } from "react";

const ACTIVATED = "sitesnap:device-activated-v1";
const wasActivated = () => { try { return localStorage.getItem(ACTIVATED) === "yes"; } catch { return false; } };
const markActivated = () => { try { localStorage.setItem(ACTIVATED, "yes"); } catch { /* private storage may be unavailable */ } };

export function AccessGate({ children }) {
  const [state, setState] = useState({ checking: true, required: false, authenticated: false });
  const [passphrase, setPassphrase] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch("/api/session", { cache: "no-store" })
      .then(async (response) => {
        const json = /json/i.test(response.headers.get("content-type") || "");
        // Static-only hosts deliberately have no API. A real HTTP response
        // that is absent/non-JSON is distinguishable from being offline.
        if (response.status === 404 || (response.ok && !json)) return { required: false, authenticated: false, static: true };
        if (!response.ok) throw new Error("session unavailable");
        return response.json();
      })
      .then((session) => {
        // A successful server check proves this installation reached the
        // intended origin. Thereafter its local IndexedDB remains usable in
        // the field when connectivity disappears.
        if (!session.required || session.authenticated) markActivated();
        setState({ checking: false, offline: false, ...session });
      })
      .catch(() => setState({ checking: false, required: !wasActivated(), authenticated: false, offline: true }));
  }, []);

  async function unlock(event) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ passphrase }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(response.status === 429 ? "Too many attempts. Wait 15 minutes and try again." : body.error === "bad_origin" ? "Open SiteSnap from its deployed URL and try again." : "That access key is not correct.");
      }
      setPassphrase("");
      markActivated();
      setState({ checking: false, required: true, authenticated: true });
    } catch (err) { setError(err.message || "SiteSnap could not be unlocked."); }
    finally { setBusy(false); }
  }

  if (state.checking) return <div style={styles.page}>Opening SiteSnap…</div>;
  if (state.offline && state.required) return (
    <main style={styles.page}><section style={styles.card}>
      <h1 style={styles.title}>Connect to activate SiteSnap</h1>
      <p style={styles.copy}>This device has not been unlocked before. Connect to the internet, reopen SiteSnap, and enter the private access key once.</p>
    </section></main>
  );
  if (!state.required || state.authenticated) return children;
  return (
    <main style={styles.page}>
      <form onSubmit={unlock} style={styles.card}>
        <h1 style={styles.title}>Unlock SiteSnap</h1>
        <p style={styles.copy}>Enter the private deployment access key. Once unlocked, the installed app continues to work offline.</p>
        <label style={styles.label} htmlFor="sitesnap-access-key">Access key</label>
        <input id="sitesnap-access-key" type="password" autoComplete="current-password" value={passphrase} onChange={(event) => setPassphrase(event.target.value)} required autoFocus style={styles.input} />
        {error && <p role="alert" style={styles.error}>{error}</p>}
        <button type="submit" disabled={busy} style={styles.button}>{busy ? "Unlocking…" : "Unlock"}</button>
      </form>
    </main>
  );
}

const styles = {
  page: { minHeight: "100dvh", display: "grid", placeItems: "center", padding: 24, background: "#f6f6f3", color: "#14201b", fontFamily: "system-ui, sans-serif" },
  card: { width: "min(100%, 390px)", display: "grid", gap: 14, padding: 28, borderRadius: 18, background: "white", boxShadow: "0 12px 40px rgba(20,32,27,.12)" },
  title: { margin: 0, fontSize: 25 }, copy: { margin: 0, color: "#5e6b64", lineHeight: 1.5 }, label: { fontWeight: 700 },
  input: { minHeight: 48, border: "1px solid #9ba69f", borderRadius: 10, padding: "0 12px", fontSize: 17 },
  button: { minHeight: 48, border: 0, borderRadius: 999, background: "#10352a", color: "white", fontSize: 16, fontWeight: 750 },
  error: { margin: 0, color: "#a12727", lineHeight: 1.4 },
};
