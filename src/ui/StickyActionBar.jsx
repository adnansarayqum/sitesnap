// The bar pinned under a screen's content — the primary action lives here,
// within thumb reach. `split` lays children out side by side.
const cx = (...parts) => parts.filter(Boolean).join(" ");

export function StickyActionBar({ split, className, style, children }) {
  return <div className={cx("ss-footer", split && "ss-footer-split", className)} style={style}>{children}</div>;
}
