// A small rounded count or state marker. `tone` maps onto the existing
// pill classes: neutral (default) or "done".
const cx = (...parts) => parts.filter(Boolean).join(" ");

export function StatusPill({ tone, className, children, ...rest }) {
  return <span className={cx("ss-pill", tone, className)} {...rest}>{children}</span>;
}
