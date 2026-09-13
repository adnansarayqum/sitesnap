// One button. `variant` picks the look, `size` the footprint; everything
// else (onClick, disabled, aria-*, title, style, type) passes straight
// through to the <button>. Renders the stylesheet's existing classes, so a
// swap from a raw <button className="ss-btn ss-btn-primary"> changes
// nothing on screen.
//
//   variant: primary | secondary | ghost | danger | danger-ghost | live
//   size:    big (full width, tall) | sq (compact, square corners) | square
const cx = (...parts) => parts.filter(Boolean).join(" ");

export function Button({ variant = "primary", size, className, children, ...rest }) {
  return (
    <button className={cx("ss-btn", `ss-btn-${variant}`, size && `ss-btn-${size}`, className)} {...rest}>
      {children}
    </button>
  );
}
