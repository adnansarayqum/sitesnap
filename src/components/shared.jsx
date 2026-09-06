import { useEffect, useRef, useState } from "react";
import {
  ChevronLeft, GripVertical,
} from "lucide-react";

/* ---------------- shared bits ---------------- */

export function TopBar({ title, eyebrow, onBack, right }) {
  return (
    <div className="ss-topbar">
      {onBack ? (
        <button className="ss-back" onClick={onBack} aria-label="Back"><ChevronLeft size={21} /></button>
      ) : (
        <span className="ss-tick" />
      )}
      <div className="ss-topbar-text">
        <div className="ss-eyebrow-sm">{eyebrow}</div>
        <div className="ss-title">{title}</div>
      </div>
      {right || null}
    </div>
  );
}

export function ReorderableList({ items, onReorder, renderRow, onRowTap }) {
  const rowRefs = useRef({});
  const [order, setOrder] = useState(items.map((i) => i.id));
  const [dragId, setDragId] = useState(null);
  const [dragOffset, setDragOffset] = useState(0);
  const dragInfo = useRef({ startY: 0, rowHeight: 0 });

  useEffect(() => {
    setOrder(items.map((i) => i.id));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items.map((i) => i.id).join(",")]);

  const byId = Object.fromEntries(items.map((i) => [i.id, i]));

  const down = (id) => (e) => {
    e.preventDefault();
    const row = rowRefs.current[id];
    dragInfo.current.startY = e.clientY;
    dragInfo.current.rowHeight = row ? row.getBoundingClientRect().height + 8 : 60;
    setDragId(id);
    setDragOffset(0);
  };

  useEffect(() => {
    if (!dragId) return;
    const move = (e) => {
      const dy = e.clientY - dragInfo.current.startY;
      setDragOffset(dy);
      const steps = Math.round(dy / dragInfo.current.rowHeight);
      setOrder((prev) => {
        const idx = prev.indexOf(dragId);
        let t = Math.max(0, Math.min(prev.length - 1, idx + steps));
        if (t === idx) return prev;
        const next = [...prev];
        next.splice(idx, 1);
        next.splice(t, 0, dragId);
        dragInfo.current.startY = e.clientY;
        return next;
      });
    };
    const up = () => {
      setDragId(null);
      setDragOffset(0);
      setOrder((final) => { onReorder(final.map((id) => byId[id]).filter(Boolean)); return final; });
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dragId]);

  return (
    <div className="ss-list">
      {order.map((id) => {
        const item = byId[id];
        if (!item) return null;
        const index = order.indexOf(id);
        const dragging = dragId === id;
        return (
          <div key={id}
            ref={(el) => (rowRefs.current[id] = el)}
            className={`ss-row ${dragging ? "dragging" : ""}`}
            style={{ transform: dragging ? `translateY(${dragOffset}px)` : "none" }}>
            <button className="ss-grip" onPointerDown={down(id)} aria-label="Drag to reorder">
              <GripVertical size={18} />
            </button>
            {onRowTap ? (
              <button className="ss-row-tap" onClick={() => onRowTap(item)}>{renderRow(item, index)}</button>
            ) : (
              <div className="ss-row-tap">{renderRow(item, index)}</div>
            )}
          </div>
        );
      })}
    </div>
  );
}
