import { useEffect, useState } from "react";

export function AccessGate({ children }) {
  const [state, setState] = useState({ checking: true, required: false, authenticated: false });
  const [passphrase, setPassphrase] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch("/api/session", { cache: "no-store" })
      .then(async (response) => response.ok ? response.json() : Promise.reject(new Error("session unavailable")))
      .then((session) => setState({ checking: false, ...session }))
      // The local app and IndexedDB remain usable when the network is down.
      .catch(() => setState({ checking: false, required: false, authenticated: false }));
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
      setState({ checking: false, required: true, authenticated: true });
    } catch (err) { setError(err.message || "SiteSnap could not be unlocked."); }
    finally { setBusy(false); }
  }

  if (state.checking) return <div style={styles.page}>Opening SiteSnap…</div>;
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
