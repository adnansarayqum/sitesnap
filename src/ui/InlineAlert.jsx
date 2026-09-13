// An inline note beside content: tone "info" (quiet, a rule on the left),
// "warn" (amber), or the default amber tip.
const cx = (...parts) => parts.filter(Boolean).join(" ");

export function InlineAlert({ tone, icon, className, children }) {
  return (
    <div className={cx("ss-tip", tone, className)}>
      {icon || null}
      <span>{children}</span>
    </div>
  );
}
