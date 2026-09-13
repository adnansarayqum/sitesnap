// A short bottom notice with one action — the "Photo deleted — Undo" pattern.
export function Toast({ action, children }) {
  return (
    <div className="ss-toast">
      <span>{children}</span>
      {action && <button onClick={action.onClick}>{action.icon || null} {action.label}</button>}
    </div>
  );
}
