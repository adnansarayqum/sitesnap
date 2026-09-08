import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.jsx";
import { Sentry } from "./sentry.js";

function CrashFallback() {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 16, height: "100dvh", padding: 24, textAlign: "center" }}>
      <p style={{ fontSize: 17 }}>Something went wrong. Your photos and notes are safe on this phone.</p>
      <button className="ss-btn ss-btn-primary" onClick={() => window.location.reload()}>Reload</button>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <Sentry.ErrorBoundary fallback={<CrashFallback />}>
      <App />
    </Sentry.ErrorBoundary>
  </React.StrictMode>
);

// Offline shell — photos already persist in IndexedDB; this keeps the app
// itself loadable with no signal. Dev servers are skipped.
if ("serviceWorker" in navigator && location.protocol === "https:") {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  });
}
