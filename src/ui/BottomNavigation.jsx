// Top-level navigation: Home / Cases / Settings. Hidden during an
// inspection by the screens themselves (the walkthrough and room screens
// never render it), which is what keeps an active inspection focused.
import { FolderTree, Home as HomeIcon, Settings as SettingsIcon } from "lucide-react";

const TABS = [
  ["home", "Home", HomeIcon],
  ["cases", "Cases", FolderTree],
  ["settings", "Settings", SettingsIcon],
];

export function BottomNavigation({ active, onChange }) {
  return (
    <div className="ss-tabbar">
      {TABS.map(([key, label, Icon]) => (
        <button key={key} className={`ss-tabbar-item ${active === key ? "on" : ""}`} onClick={() => onChange(key)}>
          <Icon size={19} strokeWidth={active === key ? 2.2 : 1.8} />
          <span>{label}</span>
        </button>
      ))}
    </div>
  );
}
