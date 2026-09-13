// A row of exclusive options (Good / Fair / Poor). Each option becomes a
// button carrying its lower-cased value as a class plus "on" when
// selected; the caller decides what a second tap on the selected option
// means (the condition pickers clear it). `bare` renders the buttons
// without a wrapper for callers that already own the row.
const cx = (...parts) => parts.filter(Boolean).join(" ");

export function SegmentedControl({ options, value, onChange, className, itemClass, titleFor, bare }) {
  const items = options.map((o) => (
    <button key={o} className={cx(itemClass, String(o).toLowerCase(), value === o && "on")} title={titleFor ? titleFor(o) : undefined} onClick={() => onChange(o)}>
      {o}
    </button>
  ));
  return bare ? <>{items}</> : <div className={className}>{items}</div>;
}
