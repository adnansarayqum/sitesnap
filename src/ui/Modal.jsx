// A centred dialog over a scrim. Tapping the scrim calls onClose; the
// panel swallows the tap. `left` aligns the body text left (forms); the
// optional icon and title render above the children.
const cx = (...parts) => parts.filter(Boolean).join(" ");

export function Modal({ onClose, icon, title, left, className, children }) {
  return (
    <div className="ss-modal-back" onClick={onClose}>
      <div className={cx("ss-modal", left && "ss-modal-left", className)} onClick={(e) => e.stopPropagation()}>
        {icon && <div className="ss-modal-icon">{icon}</div>}
        {title != null && <div className="ss-modal-title">{title}</div>}
        {children}
      </div>
    </div>
  );
}
