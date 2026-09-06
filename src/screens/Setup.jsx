import { useState } from "react";
import {
  ArrowRight, Briefcase, Check, Minus, Plus,
} from "lucide-react";
import { ReorderableList, TopBar } from "../components/shared.jsx";
import { PRESETS, PRESET_GROUPS } from "../lib/presets.js";
import { pad, uid } from "../lib/util.js";

/* ---------------- setup ---------------- */
// Two presentations sharing one set of state and logic: guided (one
// question per screen, the default for a first-timer) and classic (the
// original single scrolling form, faster once someone knows the drill).
// Whichever a surveyor last used is remembered per device.

const MODE_KEY = "sitesnap:setupMode";
function loadMode() {
  try { return localStorage.getItem(MODE_KEY) === "classic" ? "classic" : "guided"; } catch { return "guided"; }
}
function saveMode(m) { try { localStorage.setItem(MODE_KEY, m); } catch { /* per-device convenience only */ } }

export function SetupScreen({ onBack, onStart }) {
  const [mode, setMode] = useState(loadMode);
  const [address, setAddress] = useState("");
  const [postcode, setPostcode] = useState("");
  const [items, setItems] = useState([]); // {id, base, custom?}
  const [customName, setCustomName] = useState("");
  const [addingCustom, setAddingCustom] = useState(false);
  const [caseOpen, setCaseOpen] = useState(false);
  const [filter, setFilter] = useState("");
  const [ref, setRef] = useState("");
  const [client, setClient] = useState("");
  const [occupier, setOccupier] = useState("");
  const [solicitor, setSolicitor] = useState("");
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

  // display names: number duplicates in walk order
  const named = (() => {
    const totals = {};
    items.forEach((i) => { totals[i.base] = (totals[i.base] || 0) + 1; });
    const seen = {};
    return items.map((i) => {
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

  const roomsField = (
    <>
      <input
        className="ss-input ss-filter" placeholder="Filter areas…"
        value={filter} onChange={(e) => setFilter(e.target.value)}
      />
      {filter.trim() ? (
        <div className="ss-chip-grid">
          {PRESETS.filter((p) => p.base.toLowerCase().includes(filter.trim().toLowerCase()))
            .sort((a, b) => a.base.localeCompare(b.base)).map(chip)}
        </div>
      ) : (
        PRESET_GROUPS.map((g) => (
          <div key={g.group} style={{ marginTop: 14 }}>
            <div className="ss-section-label">{g.group}</div>
            <div className="ss-chip-grid">{g.items.map(chip)}</div>
          </div>
        ))
      )}
      {addingCustom ? (
        <div className="ss-inline-add">
          <input
            className="ss-input" autoFocus placeholder="e.g. Utility Room"
            value={customName} onChange={(e) => setCustomName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && addCustom()}
          />
          <button className="ss-btn ss-btn-primary ss-btn-sq" onClick={addCustom}><Check size={18} /></button>
        </div>
      ) : (
        <button className="ss-dashed" onClick={() => setAddingCustom(true)}>
          <Plus size={15} /> Add custom area
        </button>
      )}
    </>
  );

  if (mode === "classic") {
    return (
      <div className="ss-col">
        <TopBar title="New inspection" eyebrow="Set up once, then just shoot" onBack={onBack} />
        <div className="ss-scroll">
          <div className="ss-section-label">Property</div>
          <input className="ss-input" autoFocus placeholder="23 High Street" value={address} onChange={(e) => setAddress(e.target.value)} />
          <input className="ss-input" placeholder="Postcode (optional)" style={{ marginTop: 8 }} value={postcode} onChange={(e) => setPostcode(e.target.value.toUpperCase())} />

          <button className="ss-case-toggle" onClick={() => setCaseOpen((o) => !o)}>
            <Briefcase size={13} />
            {caseOpen ? "Hide case details" : "Add case details (optional)"}
          </button>
          {caseOpen && (
            <div className="ss-case">
              <input className="ss-input" placeholder="Your reference" value={ref} onChange={(e) => setRef(e.target.value)} />
              <input className="ss-input" placeholder="Client" value={client} onChange={(e) => setClient(e.target.value)} />
              <input className="ss-input" placeholder="Occupier / tenant" value={occupier} onChange={(e) => setOccupier(e.target.value)} />
              <input className="ss-input" placeholder="Instructing solicitor" value={solicitor} onChange={(e) => setSolicitor(e.target.value)} />
              <p className="ss-fineprint" style={{ margin: "4px 2px 0" }}>
                Carried into the report, the ZIP and the cloud upload, so they don't have to be typed into the spreadsheet again.
              </p>
            </div>
          )}

          <div className="ss-section-label" style={{ marginTop: 20 }}>
            Rooms &amp; areas <span className="ss-hint">— tap to add; use +/− for bedrooms, bathrooms &amp; extra claim items</span>
          </div>
          {roomsField}

          {named.length > 0 && (
            <>
              <div className="ss-section-label" style={{ marginTop: 20 }}>
                Walk order <span className="ss-hint">— drag to match your route; sets folder numbering</span>
              </div>
              <ReorderableList
                items={named}
                onReorder={(next) => setItems(next.map(({ id, base, custom }) => ({ id, base, custom })))}
                renderRow={(item, index) => (
                  <div className="ss-row-main">
                    <span className="ss-index">{pad(index + 1)}</span>
                    <span className="ss-row-name">{item.name}</span>
                  </div>
                )}
              />
            </>
          )}
          <button className="ss-link" style={{ margin: "16px auto 0" }} onClick={() => switchMode("guided")}>
            Prefer step-by-step guidance?
          </button>
          <div style={{ height: 12 }} />
        </div>

        <div className="ss-footer ss-footer-split">
          <span className="ss-count-note">{items.length} area{items.length === 1 ? "" : "s"}</span>
          <button className="ss-btn ss-btn-primary" disabled={!canStart}
            title={!address.trim() ? "Enter the property address first" : items.length === 0 ? "Pick at least one room or area" : undefined}
            onClick={start}>
            Start inspection <ArrowRight size={17} strokeWidth={2.4} />
          </button>
        </div>
      </div>
    );
  }

  // ---- guided: one question per screen ----
  const STEP_LABEL = { 1: "Step 1 of 4 · Property", 2: "Step 2 of 4 · Rooms", 3: "Step 3 of 4 · Details", 4: "Step 4 of 4 · Walk order" };
  const canNext = step === 1 ? address.trim().length > 0 : step === 2 ? items.length > 0 : true;
  const areaCount = items.length;

  return (
    <div className="ss-col">
      <TopBar title="New inspection" eyebrow={STEP_LABEL[step]} onBack={() => (step > 1 ? setStep(step - 1) : onBack())} />
      <div className="ss-wiz-progress">
        {[1, 2, 3, 4].map((n) => <div key={n} className={`ss-wiz-seg ${n <= step ? "on" : ""}`} />)}
      </div>

      <div className="ss-scroll">
        {step === 1 && (
          <div className="ss-wiz-step">
            <h1 className="ss-wiz-title">Which property?</h1>
            <input className="ss-input" autoFocus placeholder="23 High Street" value={address} onChange={(e) => setAddress(e.target.value)} />
            <input className="ss-input" placeholder="Postcode (optional)" value={postcode} onChange={(e) => setPostcode(e.target.value.toUpperCase())} />
            <p className="ss-fineprint" style={{ margin: "6px 2px 0" }}>The address names the folder your photos file into.</p>
            <button className="ss-link" style={{ marginTop: 14 }} onClick={() => switchMode("classic")}>Prefer everything on one screen?</button>
          </div>
        )}

        {step === 2 && (
          <div className="ss-wiz-step">
            <h1 className="ss-wiz-title">Which rooms and areas?</h1>
            <p className="ss-wiz-lede">Tap to add. Use +/− where there's more than one.</p>
            {roomsField}
          </div>
        )}

        {step === 3 && (
          <div className="ss-wiz-step">
            <h1 className="ss-wiz-title">Any case details?</h1>
            <input className="ss-input" placeholder="Your reference" value={ref} onChange={(e) => setRef(e.target.value)} />
            <input className="ss-input" placeholder="Client" value={client} onChange={(e) => setClient(e.target.value)} />
            <input className="ss-input" placeholder="Occupier / tenant" value={occupier} onChange={(e) => setOccupier(e.target.value)} />
            <input className="ss-input" placeholder="Instructing solicitor" value={solicitor} onChange={(e) => setSolicitor(e.target.value)} />
            <p className="ss-fineprint" style={{ margin: "6px 2px 0" }}>Optional. Carried into the report and the cloud folder so nobody retypes them.</p>
          </div>
        )}

        {step === 4 && (
          <div className="ss-wiz-step">
            <h1 className="ss-wiz-title">In what order?</h1>
            <p className="ss-wiz-lede">Drag to match your route. This sets the folder numbering.</p>
            <ReorderableList
              items={named}
              onReorder={(next) => setItems(next.map(({ id, base, custom }) => ({ id, base, custom })))}
              renderRow={(item, index) => (
                <div className="ss-row-main">
                  <span className="ss-index">{pad(index + 1)}</span>
                  <span className="ss-row-name">{item.name}</span>
                </div>
              )}
            />
            <div className="ss-wiz-summary">
              <div className="ss-section-label" style={{ margin: 0 }}>Property</div>
              <div className="ss-wiz-summary-address">{address.trim() || "The property"}</div>
              <div className="ss-wiz-summary-sub">{postcode ? postcode + " · " : ""}{areaCount} area{areaCount === 1 ? "" : "s"}</div>
            </div>
          </div>
        )}
        <div style={{ height: 12 }} />
      </div>

      <div className="ss-footer ss-wiz-footer">
        {step === 3 && <button className="ss-link ss-wiz-skip" onClick={() => setStep(4)}>Skip</button>}
        <span style={{ flex: 1 }} />
        {step < 4 ? (
          <button className="ss-btn ss-btn-primary" disabled={!canNext} onClick={() => setStep(step + 1)}>
            Next <ArrowRight size={17} strokeWidth={2.4} />
          </button>
        ) : (
          <button className="ss-btn ss-btn-primary" disabled={!canStart} onClick={start}>
            Start inspection <ArrowRight size={17} strokeWidth={2.4} />
          </button>
        )}
      </div>
    </div>
  );
}
