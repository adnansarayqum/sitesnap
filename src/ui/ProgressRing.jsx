// A determinate ring with its count in the middle — rooms covered out of
// rooms, on the Home hero and the case overview. `tone="dark"` sits it on
// a pine surface (gold arc), the default on a light card (pine arc).
export function ProgressRing({ done, total, size = 72, stroke = 7, label = "rooms", tone }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const frac = total > 0 ? Math.max(0, Math.min(1, done / total)) : 0;
  return (
    <div className={`ss-ring${tone === "dark" ? " dark" : ""}`} style={{ width: size, height: size }}
      role="img" aria-label={`${done} of ${total} ${label}`}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
        <circle className="ss-ring-track" cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={stroke} />
        {/* a zero-length round-capped dash still paints a dot, so no arc at 0 */}
        {frac > 0 && <circle className="ss-ring-arc" cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={stroke}
          strokeLinecap="round" strokeDasharray={`${frac * c} ${c}`} transform={`rotate(-90 ${size / 2} ${size / 2})`} />}
      </svg>
      <div className="ss-ring-mid">
        <b>{done}/{total}</b>
        <span>{label}</span>
      </div>
    </div>
  );
}
