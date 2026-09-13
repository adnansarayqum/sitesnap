// A fixed top banner for something the surveyor must see now (storage
// failing, a device out of space). Dismissable.
import { AlertTriangle, X } from "lucide-react";

export function Banner({ icon, onDismiss, children }) {
  return (
    <div className="ss-alert">
      {icon === undefined ? <AlertTriangle size={16} /> : icon}
      <span>{children}</span>
      {onDismiss && <button onClick={onDismiss} aria-label="Dismiss"><X size={15} /></button>}
    </div>
  );
}
