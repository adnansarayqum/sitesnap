// Nothing here yet. The full form takes an icon and body; `note` is the
// one-line variant used inside lists.
export function EmptyState({ icon, note, children }) {
  if (note) return <p className="ss-empty-note">{children}</p>;
  return (
    <div className="ss-empty">
      {icon || null}
      {children}
    </div>
  );
}
