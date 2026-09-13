// The sticky top bar: back (or the brand tick), an eyebrow line, a title,
// and an optional action on the right. Same markup and classes as the
// TopBar it replaces, so nothing moves.
import { ChevronLeft } from "lucide-react";

export function AppHeader({ title, eyebrow, onBack, right }) {
  return (
    <div className="ss-topbar">
      {onBack ? (
        <button className="ss-back" onClick={onBack} aria-label="Back"><ChevronLeft size={21} /></button>
      ) : (
        <span className="ss-tick" />
      )}
      <div className="ss-topbar-text">
        <div className="ss-eyebrow-sm">{eyebrow}</div>
        <div className="ss-title">{title}</div>
      </div>
      {right || null}
    </div>
  );
}
