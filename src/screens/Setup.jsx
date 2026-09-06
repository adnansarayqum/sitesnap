import { useState } from "react";
import {
  ArrowRight, Briefcase, Check, Minus, Plus,
} from "lucide-react";
import { ReorderableList, TopBar } from "../components/shared.jsx";
import { PRESETS } from "../lib/presets.js";
import { pad, uid } from "../lib/util.js";

/* ---------------- setup (one screen) ---------------- */

export function SetupScreen({ onBack, onStart }) {
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

  return (
    <div className="ss-col">
      <TopBar title="New inspection" eyebrow="Set up once, then just shoot" onBack={onBack} />

      <div className="ss-scroll">
        <div className="ss-section-label">Property</div>
        <input
          className="ss-input" autoFocus placeholder="23 High Street"
          value={address} onChange={(e) => setAddress(e.target.value)}
        />
        <input
          className="ss-input" placeholder="Postcode (optional)" style={{ marginTop: 8 }}
          value={postcode} onChange={(e) => setPostcode(e.target.value.toUpperCase())}
        />

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
              Carried into the report, the ZIP and the cloud upload, so they don't
              have to be typed into the spreadsheet again.
            </p>
          </div>
        )}

        <div className="ss-section-label" style={{ marginTop: 20 }}>
          Rooms &amp; areas <span className="ss-hint">— tap to add; use +/− for bedrooms, bathrooms &amp; extra claim items</span>
        </div>
        <input
          className="ss-input ss-filter" placeholder="Filter areas…"
          value={filter} onChange={(e) => setFilter(e.target.value)}
        />
        <div className="ss-chip-grid">
          {PRESETS
            .filter((p) => p.base.toLowerCase().includes(filter.trim().toLowerCase()))
            .sort((a, b) => a.base.localeCompare(b.base))
            .map((p) => {
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
            })}
        </div>

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
        <div style={{ height: 12 }} />
      </div>

      <div className="ss-footer ss-footer-split">
        <span className="ss-count-note">{items.length} area{items.length === 1 ? "" : "s"}</span>
        <button className="ss-btn ss-btn-primary" disabled={!canStart}
          title={!address.trim() ? "Enter the property address first" : items.length === 0 ? "Pick at least one room or area" : undefined}
          onClick={() => onStart(address.trim(), postcode.trim(), named, {
            ref: ref.trim(), client: client.trim(),
            occupier: occupier.trim(), solicitor: solicitor.trim(),
          })}>
          Start inspection <ArrowRight size={17} strokeWidth={2.4} />
        </button>
      </div>
    </div>
  );
}
