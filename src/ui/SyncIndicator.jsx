// The one sync indicator. Reads the browser's online flag itself (and
// re-renders when it flips); everything else arrives as props from the
// stores that already exist. Two shapes:
//   "pill"  the compact chip in a capture header — label only
//   "line"  a row with the label and a fuller detail, for overview screens
import { useEffect, useState } from "react";
import { AlertTriangle, Check, CloudOff, Loader2 } from "lucide-react";
import { deriveSyncStatus } from "../syncStatus.js";

export function useOnline() {
  const [online, setOnline] = useState(() => typeof navigator === "undefined" || navigator.onLine !== false);
  useEffect(() => {
    if (typeof window === "undefined") return undefined;
    const up = () => setOnline(true), down = () => setOnline(false);
    window.addEventListener("online", up); window.addEventListener("offline", down);
    return () => { window.removeEventListener("online", up); window.removeEventListener("offline", down); };
  }, []);
  return online;
}

const ICON = {
  saved: (size) => <Check size={size} />,
  syncing: (size) => <Loader2 size={size} className="ss-spin" />,
  offline: (size) => <CloudOff size={size} />,
  failed: (size) => <AlertTriangle size={size} />,
};
// the capture header's existing tone classes
const PILL_TONE = { saved: "ok", syncing: "busy", offline: "offline", failed: "failed" };

export function SyncIndicator({ saveStatus, filing, variant = "pill" }) {
  const online = useOnline();
  const s = deriveSyncStatus({ saveStatus, filing, online });
  if (variant === "line") {
    return (
      <div className={`ss-sync ss-sync-${s.state}`} role="status">
        {ICON[s.state](12)} {s.detail || s.label}
      </div>
    );
  }
  return (
    <span className={`ss-cap-status ${PILL_TONE[s.state]}`} role="status" title={s.detail || undefined}>
      {ICON[s.state](11)} {s.label}
    </span>
  );
}
