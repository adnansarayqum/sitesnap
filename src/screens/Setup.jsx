import { useState } from "react";
import {
  ArrowRight, Briefcase, Check, Minus, Pencil, Plus, ScanLine, X,
} from "lucide-react";
import { ReorderableList } from "../components/shared.jsx";
import { QRScanner } from "../components/QRScanner.jsx";
import { PRESETS } from "../lib/presets.js";
import { pad, uid } from "../lib/util.js";
import { AppHeader, Button, InlineAlert, StickyActionBar } from "../ui/index.js";

/* ---------------- setup ---------------- */
// Two presentations sharing one set of state and logic: guided (one
// question per screen — Property, Rooms, Start — the default for a
// first-timer) and classic (the original single scrolling form, faster
// once someone knows the drill). Whichever a surveyor last used is
// remembered per device.

const MODE_KEY = "sitesnap:setupMode";
function loadMode() {
  try { return localStorage.getItem(MODE_KEY) === "classic" ? "classic" : "guided"; } catch { return "guided"; }
}
function saveMode(m) { try { localStorage.setItem(MODE_KEY, m); } catch { /* per-device convenience only */ } }

export function SetupScreen({ onBack, onStart }) {
  const [mode, setMode] = useState(loadMode);
  const [address, setAddress] = useState("");
  const [postcode, setPostcode] = useState("");
  const [items, setItems] = useState([]); // {id, base, custom?, customLabel?}
  const [customName, setCustomName] = useState("");
  const [addingCustom, setAddingCustom] = useState(false);
  const [caseOpen, setCaseOpen] = useState(false);
  const [filter, setFilter] = useState("");
  const [ref, setRef] = useState("");
  const [client, setClient] = useState("");
  const [occupier, setOccupier] = useState("");
  const [solicitor, setSolicitor] = useState("");
  const [scanning, setScanning] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [editingValue, setEditingValue] = useState("");
  const [step, setStep] = useState(1);

  function switchMode(next) { saveMode(next); setMode(next); }

  const countOf = (base) => items.filter((i) => i.base === base).length;

  function inc(base) { setItems((p) => [...p, { id: uid("room"), base }]); }
  function dec(base) {
    setItems((p) => {
      const idx = p.map((i) => i.base).lastIndexOf(base);
      if (idx === -1) return p;
      const n = [...p]; n.splice(idx, 1); return n;
    });
  }
  function toggle(base) { countOf(base) ? dec(base) : inc(base); }

  function addCustom() {
    const name = customName.trim();
    if (!name) return;
    setItems((p) => [...p, { id: uid("room"), base: name, custom: true }]);
    setCustomName("");
    setAddingCustom(false);
  }

  function removeItem(id) {
    setItems((p) => p.filter((i) => i.id !== id));
    if (editingId === id) setEditingId(null);
  }
  function startRename(item) { setEditingId(item.id); setEditingValue(item.name); }
  function commitRename() {
    const id = editingId;
    if (id) setItems((p) => p.map((i) => (i.id === id ? { ...i, customLabel: editingValue.trim() || undefined } : i)));
    setEditingId(null);
  }

  // display names: a renamed item keeps its own label; everything else is
  // numbered in walk order among same-preset duplicates
  const named = (() => {
    const totals = {};
    items.forEach((i) => { if (!i.customLabel) totals[i.base] = (totals[i.base] || 0) + 1; });
    const seen = {};
    return items.map((i) => {
      if (i.customLabel) return { ...i, name: i.customLabel };
      seen[i.base] = (seen[i.base] || 0) + 1;
      return { ...i, name: totals[i.base] > 1 ? `${i.base} ${seen[i.base]}` : i.base };
    });
  })();

  const canStart = address.trim().length > 0 && items.length > 0;
  function start() {
    onStart(address.trim(), postcode.trim(), named, {
      ref: ref.trim(), client: client.trim(),
      occupier: occupier.trim(), solicitor: solicitor.trim(),
    });
  }

  function handleAddressScanned(scannedText) {
    setAddress(scannedText);
    setScanning(false);
  }

  const chip = (p) => {
    const c = countOf(p.base);
    return (
      <div key={p.base} className={`ss-chip ${c ? "on" : ""}`}>
        <button className="ss-chip-main" onClick={() => (p.steppable ? (c ? null : inc(p.base)) : toggle(p.base))}>
          {p.base}{c > 1 ? ` ×${c}` : ""}
        </button>
        {p.steppable ? (
          c > 0 ? (
            <span className="ss-stepper">
              <button onClick={() => dec(p.base)} aria-label={`Remove ${p.base}`}><Minus size={14} /></button>
              <button onClick={() => inc(p.base)} aria-label={`Add ${p.base}`}><Plus size={14} /></button>
            </span>
          ) : null
        ) : c > 0 ? (
          <Check size={15} className="ss-chip-check" />
        ) : null}
      </div>
    );
  };

  const propertyFields = (
    <>
      <div className="ss-scan-row">
        <input
          className="ss-input" autoFocus placeholder="23 High Street"
          value={address} onChange={(e) => setAddress(e.target.value)}
        />
        <button className="ss-scan-btn" onClick={() => setScanning(true)} title="Scan an address from a letter or document">
          <ScanLine size={16} /> Scan
        </button>
      </div>
      <input className="ss-input" placeholder="Postcode (optional)" style={{ marginTop: 8 }} value={postcode} onChange={(e) => setPostcode(e.target.value.toUpperCase())} />

      <input className="ss-input" style={{ marginTop: 8 }} placeholder="Your reference (optional)" value={ref} onChange={(e) => setRef(e.target.value)} />
      <input className="ss-input" style={{ marginTop: 8 }} placeholder="Client (optional)" value={client} onChange={(e) => setClient(e.target.value)} />

      <button className="ss-case-toggle" onClick={() => setCaseOpen((o) => !o)}>
        <Briefcase size={13} />
        {caseOpen ? "Hide more details" : "Occupier or instructing solicitor?"}
      </button>
      {caseOpen && (
        <div className="ss-case">
          <input className="ss-input" placeholder="Occupier / tenant" value={occupier} onChange={(e) => setOccupier(e.target.value)} />
          <input className="ss-input" placeholder="Instructing solicitor" value={solicitor} onChange={(e) => setSolicitor(e.target.value)} />
        </div>
      )}
    </>
  );

  const roomsPicker = (
    <>
      <input
        className="ss-input ss-filter" placeholder="Filter areas…"
        value={filter} onChange={(e) => setFilter(e.target.value)}
      />
      {/* A plain alphabetical grid, filter or no filter — category headings
          were tried once and reported as slower to scan on site. */}
      <div className="ss-chip-grid">
        {PRESETS.filter((p) => p.base.toLowerCase().includes(filter.trim().toLowerCase()))
          .sort((a, b) => a.base.localeCompare(b.base)).map(chip)}
      </div>
      {addingCustom ? (
        <div className="ss-inline-add">
          <input
            className="ss-input" autoFocus placeholder="e.g. Utility Room"
            value={customName} onChange={(e) => setCustomName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && addCustom()}
          />
          <Button variant="primary" size="sq" onClick={addCustom}><Check size={18} /></Button>
        </div>
      ) : (
        <button className="ss-dashed" onClick={() => setAddingCustom(true)}>
          <Plus size={15} /> Add custom area
        </button>
      )}
    </>
  );

  // the rooms picked so far — drag to set the walk order, tap the pencil to
  // rename one, or remove it; this is also where "Bedroom 2" becomes
  // "Box room" without starting over
  const addedRooms = named.length > 0 && (
    <>
      <div className="ss-section-label" style={{ marginTop: 20 }}>
        Added rooms <span className="ss-hint">— drag to reorder; this sets the folder numbering</span>
      </div>
      <ReorderableList
        items={named}
        onReorder={(next) => setItems(next.map(({ id, base, custom, customLabel }) => ({ id, base, custom, customLabel })))}
        renderRow={(item, index) => (
          <>
            <div className="ss-row-main">
              <span className="ss-index">{pad(index + 1)}</span>
              {editingId === item.id ? (
                <input
                  className="ss-input ss-room-rename" autoFocus value={editingValue}
                  onChange={(e) => setEditingValue(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") commitRename(); if (e.key === "Escape") setEditingId(null); }}
                  onBlur={commitRename}
                />
              ) : (
                <span className="ss-row-name">{item.name}</span>
              )}
            </div>
            <span className="ss-row-right">
              {editingId !== item.id && (
                <button className="ss-icon-btn" onClick={() => startRename(item)} aria-label={`Rename ${item.name}`}><Pencil size={14} /></button>
              )}
              <button className="ss-icon-btn" onClick={() => removeItem(item.id)} aria-label={`Remove ${item.name}`}><X size={14} /></button>
            </span>
          </>
        )}
      />
    </>
  );

  if (mode === "classic") {
    return (
      <div className="ss-col">
        {scanning && <QRScanner onClose={() => setScanning(false)} onAddressScanned={handleAddressScanned} />}
        <AppHeader title="New inspection" eyebrow="Set up once, then just shoot" onBack={onBack} />
        <div className="ss-scroll">
          <div className="ss-section-label">Property</div>
          {propertyFields}

          <div className="ss-section-label" style={{ marginTop: 20 }}>
            Rooms &amp; areas <span className="ss-hint">— tap to add; use +/− for bedrooms, bathrooms &amp; extra claim items</span>
          </div>
          {roomsPicker}
          {addedRooms}

          <button className="ss-link" style={{ margin: "16px auto 0" }} onClick={() => switchMode("guided")}>
            Prefer step-by-step guidance?
          </button>
          <div style={{ height: 12 }} />
        </div>

        <StickyActionBar split>
          <span className="ss-count-note">{items.length} area{items.length === 1 ? "" : "s"}</span>
          <Button variant="primary" disabled={!canStart}
            title={!address.trim() ? "Enter the property address first" : items.length === 0 ? "Pick at least one room or area" : undefined}
            onClick={start}>
            Start inspection <ArrowRight size={17} strokeWidth={2.4} />
          </Button>
        </StickyActionBar>
      </div>
    );
  }

  // ---- guided: Property → Rooms, with Rooms' own footer starting the case ----
  // A third "Ready to start?" step used to sit here — a pure review with
  // nothing left to confirm that Property and Rooms hadn't already
  // collected. Folded into Rooms' own primary action instead of asking for
  // a tap that collects no new data.
  const STEP_LABEL = { 1: "Step 1 of 2 · Property", 2: "Step 2 of 2 · Rooms" };
  const canNext = address.trim().length > 0;

  return (
    <div className="ss-col">
      {scanning && <QRScanner onClose={() => setScanning(false)} onAddressScanned={handleAddressScanned} />}
      <AppHeader title="New inspection" eyebrow={STEP_LABEL[step]} onBack={() => (step > 1 ? setStep(step - 1) : onBack())} />
      <div className="ss-wiz-progress">
        {[1, 2].map((n) => <div key={n} className={`ss-wiz-seg ${n <= step ? "on" : ""}`} />)}
      </div>

      <div className="ss-scroll">
        {step === 1 && (
          <div className="ss-wiz-step">
            <h1 className="ss-wiz-title">Which property?</h1>
            {propertyFields}
            <p className="ss-fineprint" style={{ margin: "6px 2px 0" }}>The address names the folder your photos file into.</p>
            <button className="ss-link" style={{ marginTop: 14 }} onClick={() => switchMode("classic")}>Prefer everything on one screen?</button>
          </div>
        )}

        {step === 2 && (
          <div className="ss-wiz-step">
            <h1 className="ss-wiz-title">Which rooms and areas?</h1>
            <p className="ss-wiz-lede">Tap to add. Use +/− where there's more than one.</p>
            {roomsPicker}
            {addedRooms}
          </div>
        )}
        <div style={{ height: 12 }} />
      </div>

      <StickyActionBar className="ss-wiz-footer">
        <span style={{ flex: 1 }} />
        {step === 1 ? (
          <Button variant="primary" disabled={!canNext} onClick={() => setStep(2)}>
            Next <ArrowRight size={17} strokeWidth={2.4} />
          </Button>
        ) : (
          <Button variant="primary" disabled={!canStart}
            title={items.length === 0 ? "Pick at least one room or area" : undefined}
            onClick={start}>
            Start inspection <ArrowRight size={17} strokeWidth={2.4} />
          </Button>
        )}
      </StickyActionBar>
    </div>
  );
}
