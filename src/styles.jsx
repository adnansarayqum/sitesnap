/* ---------------- styles ---------------- */

export function StyleBlock() {
  return (
    <style>{`
      @import url('https://fonts.googleapis.com/css2?family=Public+Sans:wght@500;600;700;800&family=Libre+Caslon+Text:ital,wght@0,400;0,700;1,400&display=swap');

      :root {
        --paper: #F6F6F3;
        --paper-deep: #EBEBE6;
        --card: #FFFFFF;
        --ink: #14201B;
        --muted: #5E6B64;
        --muted2: #93A099;
        --line: #E2E5DF;
        --line-soft: #ECEEE9;
        --pine: #10352A;
        --pine-press: #0A2419;
        --pine-tint: #E7ECE8;
        --hivis: #E8B84B;
        --hivis-deep: #241B08;
        --red: #93321F;
        --red-tint: #F3E4E0;
        --amber: #8C6A28;
        --amber-tint: #F6EFDC;
        --topbar-bg: rgba(246,246,243,.94);
      }
      /* Field mode: a high-contrast dark theme for shooting in direct
         sunlight, where the default paper/ink pairing washes out. Every
         screen already reads off these variables, so this is the only
         place the swap happens. */
      .ss-root.ss-field {
        --paper: #12201B;
        --paper-deep: #1A2A22;
        --card: #182821;
        --ink: #F1F3EF;
        --muted: #A9B7AB;
        --muted2: #6E7E70;
        --line: #2A3A31;
        --line-soft: #223026;
        --pine: #3FAE7C;
        --pine-press: #57C293;
        --pine-tint: #17301F;
        --red-tint: #3A1E19;
        --amber-tint: #362A10;
        --topbar-bg: rgba(18,32,27,.92);
      }
      * { box-sizing: border-box; -webkit-tap-highlight-color: transparent; }
      html, body { background: var(--paper); margin: 0; }
      button { font-family: inherit; border: none; background: none; padding: 0; cursor: pointer; color: inherit; }

      .ss-root {
        min-height: 100vh; width: 100%;
        background: var(--paper); color: var(--ink);
        display: flex; justify-content: center;
        font-family: 'Public Sans', system-ui, sans-serif;
        font-size: 15px; line-height: 1.4;
        transition: background .2s ease, color .2s ease;
      }
      .ss-serif { font-family: 'Libre Caslon Text', Georgia, serif; }
      .ss-frame { width: 100%; max-width: 430px; min-height: 100vh; display: flex; flex-direction: column; position: relative; }
      .ss-col { flex: 1; display: flex; flex-direction: column; min-height: 100vh; }
      .ss-center { flex: 1; display: flex; align-items: center; justify-content: center; min-height: 100vh; }
      .ss-hidden { display: none; }
      .ss-spin { animation: ss-rot 1s linear infinite; }
      @keyframes ss-rot { to { transform: rotate(360deg); } }
      @media (prefers-reduced-motion: reduce) { .ss-spin { animation: none; } }

      /* ---- top bar ---- */
      .ss-topbar {
        position: sticky; top: 0; z-index: 20;
        background: var(--topbar-bg); backdrop-filter: blur(8px);
        border-bottom: 1px solid var(--line);
        padding: 12px 16px; display: flex; align-items: center; gap: 10px;
      }
      .ss-back { width: 34px; height: 34px; margin-left: -6px; display: flex; align-items: center; justify-content: center; border-radius: 10px; }
      .ss-back:active { background: var(--line-soft); }
      .ss-tick { width: 6px; height: 26px; background: var(--pine); border-radius: 3px; }
      .ss-topbar-text { flex: 1; min-width: 0; }
      .ss-eyebrow-sm { font-size: 11px; font-weight: 700; letter-spacing: .09em; text-transform: uppercase; color: var(--muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      .ss-title { font-size: 17px; font-weight: 700; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      .ss-badge { font-size: 12px; font-weight: 700; background: var(--ink); color: var(--paper); padding: 4px 9px; border-radius: 999px; white-space: nowrap; }
      .ss-link { display: inline-flex; align-items: center; gap: 5px; font-size: 12px; font-weight: 700; color: var(--pine); white-space: nowrap; }

      /* ---- layout ---- */
      .ss-scroll { flex: 1; overflow-y: auto; padding: 16px; }
      .ss-footer { padding: 14px 16px calc(14px + env(safe-area-inset-bottom)); border-top: 1px solid var(--line); background: var(--paper); }
      .ss-footer-split { display: flex; align-items: center; gap: 12px; }
      .ss-footer-split .ss-btn { flex: 1; }
      .ss-footer-stack { display: flex; flex-direction: column; gap: 8px; }
      .ss-count-note { font-size: 13px; color: var(--muted); font-weight: 600; white-space: nowrap; }
      .ss-section-label { font-size: 11px; font-weight: 800; letter-spacing: .09em; text-transform: uppercase; color: var(--muted); margin: 0 2px 8px; }
      .ss-hint { font-weight: 600; letter-spacing: 0; text-transform: none; }

      /* ---- buttons ---- */
      .ss-btn {
        display: flex; align-items: center; justify-content: center; gap: 8px;
        font-weight: 800; font-size: 15px; border-radius: 14px;
        padding: 14px 18px; transition: transform .06s ease;
      }
      .ss-btn:active { transform: scale(.98); }
      .ss-btn:disabled { opacity: .45; pointer-events: none; }
      .ss-btn-big { width: 100%; padding: 18px; font-size: 16px; }
      .ss-btn-primary { background: var(--pine); color: #fff; }
      .ss-btn-primary:active { background: var(--pine-press); }
      .ss-btn-ghost { width: 100%; background: var(--card); border: 1px solid var(--line); color: var(--ink); }
      .ss-btn-danger { background: var(--red); color: #fff; width: 100%; }
      .ss-btn-sq { padding: 0 16px; border-radius: 12px; }

      /* ---- home ---- */
      .ss-home-hero { flex: 1; padding: 56px 26px 20px; display: flex; flex-direction: column; position: relative; overflow: hidden; }
      .ss-home-hero-content { position: relative; z-index: 1; display: flex; flex-direction: column; }
      .ss-home-orbs { position: absolute; inset: 0; overflow: hidden; pointer-events: none; z-index: 0; }
      .ss-orb { position: absolute; border-radius: 50%; filter: blur(38px); }
      .ss-orb-a { width: 220px; height: 220px; top: -70px; right: -70px; background: radial-gradient(circle, var(--pine) 0%, transparent 72%); opacity: .28; }
      .ss-orb-b { width: 180px; height: 180px; bottom: 30px; left: -80px; background: radial-gradient(circle, var(--hivis) 0%, transparent 72%); opacity: .18; }
      .ss-mark {
        width: 44px; height: 44px; border-radius: 13px; background: linear-gradient(155deg, var(--pine), var(--pine-press));
        color: var(--hivis); display: flex; align-items: center; justify-content: center; margin-bottom: 22px;
        box-shadow: 0 10px 22px -8px rgba(16,53,42,.55);
      }
      .ss-eyebrow { font-size: 12px; font-weight: 800; letter-spacing: .12em; text-transform: uppercase; color: var(--pine); margin-bottom: 10px; }
      .ss-h1 { font-family: 'Libre Caslon Text', Georgia, serif; font-style: italic; font-size: 38px; line-height: 1.04; font-weight: 700; letter-spacing: -0.01em; margin: 0 0 14px; }
      .ss-lede { color: var(--muted); font-size: 15px; margin: 0 0 18px; max-width: 34ch; }
      .ss-home-features { display: flex; flex-wrap: wrap; gap: 7px; margin: 0 0 28px; }
      .ss-home-feature {
        display: inline-flex; align-items: center; gap: 6px; padding: 6px 11px 6px 9px;
        border-radius: 999px; background: color-mix(in srgb, var(--card) 82%, transparent);
        backdrop-filter: blur(6px); -webkit-backdrop-filter: blur(6px);
        border: 1px solid var(--line); box-shadow: 0 1px 2px rgba(16,36,29,.05);
        font-size: 12px; font-weight: 700; color: var(--ink); white-space: nowrap;
        transition: transform .15s ease, box-shadow .15s ease;
      }
      .ss-home-feature:active { transform: scale(.95); }
      .ss-home-feature svg { color: var(--pine); flex-shrink: 0; }
      .ss-home-steps-label { font-size: 11px; font-weight: 800; letter-spacing: .09em; text-transform: uppercase; color: var(--muted2); margin: 0 0 12px; }
      .ss-home-steps { display: flex; flex-direction: column; gap: 10px; font-weight: 600; font-size: 14px; }
      .ss-home-steps > div { display: flex; align-items: center; gap: 10px; }
      .ss-step-n {
        width: 24px; height: 24px; border-radius: 8px; background: var(--pine-tint); border: 1px solid var(--line);
        display: inline-flex; align-items: center; justify-content: center; font-size: 12px; font-weight: 800; color: var(--pine);
      }

      @keyframes ss-rise { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
      @keyframes ss-orb-drift-a { 0%, 100% { transform: translate(0, 0) scale(1); } 50% { transform: translate(-16px, 20px) scale(1.08); } }
      @keyframes ss-orb-drift-b { 0%, 100% { transform: translate(0, 0) scale(1); } 50% { transform: translate(18px, -16px) scale(1.06); } }
      @keyframes ss-shine { from { transform: translateX(-140%) skewX(-12deg); } to { transform: translateX(240%) skewX(-12deg); } }
      @media (prefers-reduced-motion: no-preference) {
        .ss-orb-a { animation: ss-orb-drift-a 13s ease-in-out infinite; }
        .ss-orb-b { animation: ss-orb-drift-b 16s ease-in-out infinite; }
        .ss-home-hero-content > * { animation: ss-rise .5s cubic-bezier(.16,1,.3,1) both; }
        .ss-home-hero-content > *:nth-child(1) { animation-delay: 0ms; }
        .ss-home-hero-content > *:nth-child(2) { animation-delay: 40ms; }
        .ss-home-hero-content > *:nth-child(3) { animation-delay: 80ms; }
        .ss-home-hero-content > *:nth-child(4) { animation-delay: 120ms; }
        .ss-home-hero-content > *:nth-child(5) { animation-delay: 160ms; }
        .ss-home-hero-content > *:nth-child(6) { animation-delay: 200ms; }
        .ss-home-hero-content > *:nth-child(7) { animation-delay: 240ms; }
        .ss-home-hero-content > *:nth-child(8) { animation-delay: 280ms; }
        .ss-home-feature { animation: ss-rise .4s cubic-bezier(.16,1,.3,1) both; }
        .ss-home-features .ss-home-feature:nth-child(1) { animation-delay: 170ms; }
        .ss-home-features .ss-home-feature:nth-child(2) { animation-delay: 200ms; }
        .ss-home-features .ss-home-feature:nth-child(3) { animation-delay: 230ms; }
        .ss-home-features .ss-home-feature:nth-child(4) { animation-delay: 260ms; }
        .ss-home-features .ss-home-feature:nth-child(5) { animation-delay: 290ms; }
        .ss-footer .ss-btn-primary.ss-btn-big { position: relative; overflow: hidden; }
        .ss-footer .ss-btn-primary.ss-btn-big::after {
          content: ""; position: absolute; top: 0; bottom: 0; left: 0; width: 40%;
          background: linear-gradient(100deg, transparent, rgba(255,255,255,.28), transparent);
          animation: ss-shine 1.6s ease-out .6s 1;
        }
      }

      /* ---- inputs ---- */
      .ss-input {
        width: 100%; background: var(--card); border: 1px solid var(--line);
        border-radius: 12px; padding: 14px; font-size: 16px; font-family: inherit;
        color: var(--ink); outline: none;
      }
      .ss-input:focus { border-color: var(--pine); }
      .ss-inline-add { display: flex; gap: 8px; margin-top: 10px; }
      .ss-dashed {
        width: 100%; margin-top: 10px; padding: 12px;
        border: 1.5px dashed var(--muted2); border-radius: 12px;
        color: var(--muted); font-weight: 700; font-size: 13px;
        display: flex; align-items: center; justify-content: center; gap: 6px;
      }

      /* ---- guided setup ---- */
      .ss-wiz-progress { display: flex; gap: 4px; padding: 10px 16px 0; flex-shrink: 0; }
      .ss-wiz-seg { flex: 1; height: 4px; border-radius: 999px; background: var(--line-soft); }
      .ss-wiz-seg.on { background: var(--pine); }
      .ss-wiz-step { display: flex; flex-direction: column; gap: 10px; }
      .ss-wiz-title { font-family: 'Libre Caslon Text', Georgia, serif; font-style: italic; font-size: 28px; line-height: 1.1; font-weight: 700; letter-spacing: -0.01em; margin: 4px 0 4px; }
      .ss-wiz-lede { font-size: 13px; color: var(--muted); margin: -6px 0 2px; }
      .ss-wiz-footer { display: flex; align-items: center; gap: 12px; }
      .ss-wiz-skip { padding: 8px 4px; }
      .ss-wiz-summary { margin-top: 18px; padding: 14px 16px; background: var(--card); border: 1px solid var(--line); border-radius: 14px; }
      .ss-wiz-summary-address { font-family: 'Libre Caslon Text', Georgia, serif; font-size: 18px; font-weight: 700; margin-top: 4px; }
      .ss-wiz-summary-sub { font-size: 12.5px; color: var(--muted); margin-top: 2px; }

      /* ---- room chips ---- */
      .ss-chip-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
      .ss-chip {
        display: flex; align-items: center; justify-content: space-between;
        background: var(--card); border: 1px solid var(--line); border-radius: 12px;
        padding: 4px 8px 4px 0; min-height: 46px;
      }
      .ss-chip.on { border-color: var(--pine); background: var(--pine-tint); }
      .ss-chip-main { flex: 1; text-align: left; padding: 10px 12px; font-weight: 700; font-size: 14px; }
      .ss-chip-check { color: var(--pine); margin-right: 4px; }
      .ss-stepper { display: flex; gap: 4px; }
      .ss-stepper button {
        width: 28px; height: 28px; border-radius: 8px; background: var(--card);
        border: 1px solid var(--line); display: flex; align-items: center; justify-content: center;
        color: var(--pine);
      }

      /* ---- list / ledger rows ---- */
      .ss-list { display: flex; flex-direction: column; gap: 8px; }
      .ss-row {
        display: flex; align-items: center; gap: 4px;
        background: var(--card); border: 1px solid var(--line); border-radius: 13px;
        padding: 6px 12px 6px 4px; position: relative; z-index: 1;
      }
      .ss-row.dragging { border-color: var(--pine); box-shadow: 0 8px 24px rgba(16,36,29,.16); z-index: 10; }
      .ss-grip { width: 36px; height: 40px; display: flex; align-items: center; justify-content: center; color: var(--muted2); touch-action: none; cursor: grab; }
      .ss-row-tap { flex: 1; display: flex; align-items: center; justify-content: space-between; min-width: 0; text-align: left; padding: 6px 0; }
      .ss-row-main { display: flex; align-items: center; gap: 10px; min-width: 0; }
      .ss-index { font-size: 11px; font-weight: 800; color: var(--pine); letter-spacing: .05em; width: 20px; flex-shrink: 0; }
      .ss-row-name { font-weight: 700; font-size: 15px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      .ss-row-right { display: flex; align-items: center; gap: 8px; flex-shrink: 0; margin-left: 8px; }
      .ss-thumb { width: 34px; height: 34px; border-radius: 8px; object-fit: cover; border: 1px solid var(--line); }
      .ss-thumb-empty { display: flex; align-items: center; justify-content: center; color: var(--muted2); background: var(--line-soft); }
      .ss-pill { min-width: 30px; text-align: center; font-size: 12px; font-weight: 800; padding: 4px 8px; border-radius: 999px; background: var(--line-soft); color: var(--muted); }
      .ss-pill.done { background: var(--pine); color: #fff; }

      /* ---- progress ---- */
      .ss-progress-wrap { padding: 12px 16px 0; display: flex; align-items: center; gap: 10px; font-size: 12px; font-weight: 700; color: var(--muted); }
      .ss-progress { flex: 1; height: 6px; border-radius: 999px; background: var(--line-soft); overflow: hidden; }
      .ss-progress > div { height: 100%; background: var(--pine); border-radius: 999px; transition: width .3s ease; }

      /* ---- walkthrough (LIVE) ---- */
      .ss-live { background: var(--hivis-deep); color: var(--hivis); min-height: 100vh; }
      .ss-live-top { display: flex; align-items: center; justify-content: space-between; padding: 16px; }
      .ss-live-exit { display: flex; align-items: center; gap: 6px; font-weight: 800; font-size: 14px; color: rgba(217,244,79,.75); }
      .ss-live-flag { font-size: 12px; font-weight: 900; letter-spacing: .14em; animation: ss-pulse 1.6s ease-in-out infinite; }
      @keyframes ss-pulse { 0%,100% { opacity: 1; } 50% { opacity: .45; } }
      @media (prefers-reduced-motion: reduce) { .ss-live-flag { animation: none; } }
      .ss-live-body { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; padding: 0 24px; }
      .ss-live-eyebrow { font-size: 12px; font-weight: 800; letter-spacing: .12em; text-transform: uppercase; color: rgba(217,244,79,.6); }
      .ss-live-room { font-size: 30px; font-weight: 900; margin-top: 6px; }
      .ss-tally { font-size: 108px; font-weight: 900; line-height: 1; margin-top: 10px; font-variant-numeric: tabular-nums; }
      .ss-live-sub { font-size: 13px; font-weight: 700; color: rgba(217,244,79,.6); margin-top: 4px; }
      .ss-last { margin-top: 18px; display: flex; align-items: center; gap: 12px; }
      .ss-last img { width: 58px; height: 58px; border-radius: 10px; object-fit: cover; border: 2px solid rgba(217,244,79,.4); }
      .ss-last button { display: flex; align-items: center; gap: 6px; font-size: 13px; font-weight: 800; color: #FFB4A6; }
      .ss-live-controls { padding: 16px 16px calc(18px + env(safe-area-inset-bottom)); display: flex; flex-direction: column; gap: 10px; }
      .ss-shutter {
        width: 100%; background: var(--hivis); color: var(--hivis-deep);
        border-radius: 18px; padding: 20px; font-weight: 900; font-size: 17px;
        display: flex; flex-direction: column; align-items: center; gap: 4px;
        transition: transform .06s ease;
      }
      .ss-shutter span { font-size: 11px; font-weight: 700; opacity: .7; }
      .ss-shutter:active { transform: scale(.98); }
      .ss-live-nav { display: flex; gap: 8px; }
      .ss-live-nav button {
        flex: 1; display: flex; align-items: center; justify-content: center; gap: 6px;
        border: 1.5px solid rgba(217,244,79,.35); border-radius: 13px; padding: 13px;
        font-weight: 800; font-size: 14px; color: var(--hivis);
        white-space: nowrap; overflow: hidden;
      }
      .ss-live-nav button:disabled { opacity: .3; }
      .ss-live-nav .next { background: rgba(217,244,79,.14); }

      /* ---- photo grid ---- */
      .ss-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; }
      .ss-cell { aspect-ratio: 1; border-radius: 10px; overflow: hidden; background: var(--card); border: 1px solid var(--line); }
      .ss-cell img { width: 100%; height: 100%; object-fit: cover; display: block; }
      .ss-empty { text-align: center; color: var(--muted); padding: 48px 20px; display: flex; flex-direction: column; align-items: center; gap: 10px; font-size: 14px; }
      .ss-note { text-align: center; font-size: 12.5px; font-weight: 700; color: var(--pine); padding: 8px 16px 0; }

      /* ---- lightbox ---- */
      .ss-lightbox { position: fixed; inset: 0; z-index: 40; background: rgba(10,14,11,.96); display: flex; flex-direction: column; max-width: 430px; margin: 0 auto; }
      .ss-lightbox-top { display: flex; justify-content: flex-end; padding: 14px; }
      .ss-lightbox-top button { width: 36px; height: 36px; border-radius: 999px; background: rgba(255,255,255,.12); color: #fff; display: flex; align-items: center; justify-content: center; }
      .ss-lightbox img { flex: 1; min-height: 0; width: 100%; object-fit: contain; padding: 0 10px; }
      .ss-lightbox-bottom { padding: 16px 16px calc(16px + env(safe-area-inset-bottom)); }

      /* ---- finish ---- */
      .ss-summary { display: flex; gap: 10px; align-items: flex-start; background: var(--card); border: 1px solid var(--line); border-radius: 13px; padding: 14px; margin-bottom: 16px; }
      .ss-summary svg { margin-top: 2px; color: var(--pine); flex-shrink: 0; }
      .ss-summary-title { font-family: 'Libre Caslon Text', Georgia, serif; font-weight: 700; font-size: 16px; }
      .ss-summary-sub { font-size: 13px; color: var(--muted); font-weight: 600; margin-top: 2px; }
      .ss-tree { background: var(--card); border: 1px solid var(--line); border-radius: 13px; overflow: hidden; margin-bottom: 4px; }
      .ss-tree-root { display: flex; align-items: center; gap: 8px; padding: 12px 14px; font-weight: 800; font-size: 14px; border-bottom: 1px solid var(--line); background: var(--paper-deep); }
      .ss-tree-root svg { color: var(--pine); }
      .ss-tree-row { position: relative; display: flex; align-items: center; gap: 10px; padding: 10px 14px; font-size: 14px; font-weight: 600; border-bottom: 1px solid var(--line); }
      .ss-tree-row:last-child { border-bottom: none; }
      .ss-tree-row.dim { opacity: .4; }
      .ss-tree-name { flex: 1; min-width: 0; }
      .ss-tree-dot {
        position: relative; z-index: 1; flex-shrink: 0; width: 20px; height: 20px; border-radius: 50%;
        background: var(--card); border: 1.5px solid var(--line); display: flex; align-items: center; justify-content: center; color: var(--muted2);
      }
      .ss-tree-dot.done { border-color: var(--pine); color: var(--pine); background: var(--pine-tint); }
      .ss-tree-dot.uploading { border-color: var(--amber); color: var(--amber); }
      .ss-tree-dot.failed { border-color: var(--red); color: var(--red); background: var(--red-tint); }
      .ss-tree-dot.queued { color: var(--muted2); }
      .ss-tree-row:not(:last-child) .ss-tree-dot::after {
        content: ""; position: absolute; top: 20px; left: 50%; width: 1.5px; height: 18px;
        background: var(--line); transform: translateX(-50%);
      }
      .ss-tree-right { display: flex; align-items: center; gap: 8px; font-size: 12px; color: var(--muted); font-weight: 700; flex-shrink: 0; }
      .ss-ok { color: var(--pine); }
      .ss-queued { font-size: 11px; }
      .ss-fineprint { font-size: 12.5px; color: var(--muted); line-height: 1.5; margin: 12px 2px 4px; }

      .ss-fail { color: var(--red); }
      .ss-hook-toggle { display: flex; align-items: center; gap: 6px; margin: 12px auto 0; font-size: 12.5px; font-weight: 700; color: var(--muted); padding: 6px; }
      .ss-hook { background: var(--card); border: 1px solid var(--line); border-radius: 13px; padding: 12px; margin-top: 8px; }

      /* ---- toast ---- */
      .ss-toast {
        position: fixed; bottom: calc(20px + env(safe-area-inset-bottom)); left: 50%;
        transform: translateX(-50%); z-index: 50;
        background: var(--ink); color: var(--paper);
        border-radius: 999px; padding: 10px 10px 10px 18px;
        display: flex; align-items: center; gap: 14px;
        font-size: 13px; font-weight: 700;
        box-shadow: 0 10px 30px rgba(16,36,29,.3);
      }
      .ss-toast button { display: flex; align-items: center; gap: 5px; background: rgba(255,255,255,.14); color: var(--hivis); border-radius: 999px; padding: 7px 13px; font-weight: 800; font-size: 13px; }

      /* ---- condition & notes ---- */
      .ss-cdot { width: 9px; height: 9px; border-radius: 999px; flex-shrink: 0; }
      .ss-cdot.good { background: var(--pine); }
      .ss-cdot.fair { background: var(--amber); }
      .ss-cdot.poor { background: var(--red); }
      .ss-note-flag { color: var(--muted); flex-shrink: 0; }
      .ss-cbadge { font-size: 10px; font-weight: 800; letter-spacing: .04em; text-transform: uppercase; padding: 2px 7px; border-radius: 999px; margin-left: 7px; vertical-align: 1px; }
      .ss-cbadge.good { background: var(--pine-tint); color: var(--pine); }
      .ss-cbadge.fair { background: var(--amber-tint); color: var(--amber); }
      .ss-cbadge.poor { background: var(--red-tint); color: var(--red); }
      .ss-tree-row .ss-note-flag { margin-left: 6px; vertical-align: -1px; }

      .ss-meta { background: var(--card); border: 1px solid var(--line); border-radius: 13px; padding: 12px; margin-bottom: 14px; }
      .ss-cond-row { display: flex; align-items: center; gap: 6px; }
      .ss-cond-label { font-size: 11px; font-weight: 800; letter-spacing: .08em; text-transform: uppercase; color: var(--muted); margin-right: auto; }
      .ss-cond { padding: 8px 14px; border-radius: 999px; font-weight: 800; font-size: 13px; border: 1.5px solid var(--line); color: var(--muted); background: var(--paper); }
      .ss-cond.good.on { background: var(--pine-tint); border-color: var(--pine); color: var(--pine); }
      .ss-cond.fair.on { background: var(--amber-tint); border-color: var(--amber); color: var(--amber); }
      .ss-cond.poor.on { background: var(--red-tint); border-color: var(--red); color: var(--red); }
      .ss-note-input {
        width: 100%; margin-top: 10px; background: var(--paper); border: 1px solid var(--line);
        border-radius: 10px; padding: 10px 12px; font-size: 15px; font-family: inherit;
        color: var(--ink); outline: none; resize: vertical; min-height: 44px;
      }
      .ss-note-input:focus { border-color: var(--pine); }

      .ss-live-cond { display: flex; gap: 8px; margin-top: 18px; }
      .ss-live-cond button {
        padding: 9px 18px; border-radius: 999px; font-weight: 800; font-size: 13px;
        border: 1.5px solid rgba(217,244,79,.3); color: rgba(217,244,79,.65);
      }
      .ss-live-cond button.on.good { background: var(--hivis); border-color: var(--hivis); color: var(--hivis-deep); }
      .ss-live-cond button.on.fair { background: #E8B04B; border-color: #E8B04B; color: #3A2A00; }
      .ss-live-cond button.on.poor { background: #FF8A73; border-color: #FF8A73; color: #4A130A; }
      .ss-live-note-btn { display: flex; align-items: center; gap: 6px; margin-top: 14px; font-size: 13px; font-weight: 700; color: rgba(217,244,79,.65); padding: 6px 10px; }
      .ss-live-note {
        width: 100%; max-width: 320px; margin-top: 14px; background: rgba(217,244,79,.08);
        border: 1.5px solid rgba(217,244,79,.35); border-radius: 12px; padding: 10px 12px;
        font-size: 15px; font-family: inherit; color: var(--hivis); outline: none; resize: none;
      }
      .ss-live-note::placeholder { color: rgba(217,244,79,.4); }

      .ss-cell { position: relative; }
      .ss-cell-no { position: absolute; left: 4px; bottom: 4px; font-size: 10px; font-weight: 800; background: rgba(10,14,11,.66); color: #fff; border-radius: 6px; padding: 1px 5px; font-variant-numeric: tabular-nums; }
      .ss-lb-no { text-align: center; color: #fff; font-size: 13px; font-weight: 800; margin-bottom: 2px; }
      .ss-rep-case { display: grid; grid-template-columns: auto 1fr; gap: 3px 14px; margin: 12px 0 0; font-size: 13px; }
      .ss-rep-case dt { font-weight: 800; color: var(--muted); }
      .ss-rep-case dd { margin: 0; }
      .ss-rep-grid figure { margin: 0; }
      .ss-rep-grid figcaption { font-size: 10.5px; font-weight: 700; color: var(--muted); margin-top: 3px; }

      .ss-lastup { display: flex; align-items: center; gap: 7px; font-size: 12.5px; font-weight: 700; border-radius: 10px; padding: 9px 12px; margin-top: 14px; }
      .ss-lastup.ok { background: var(--pine-tint); color: var(--pine); }
      .ss-lastup.bad { background: var(--red-tint); color: var(--red); }

      .ss-job-up { display: inline-flex; align-items: center; gap: 4px; font-size: 11px; font-weight: 800; border-radius: 999px; padding: 2px 8px; margin-top: 4px; }
      .ss-job-up.ok { background: var(--pine-tint); color: var(--pine); }
      .ss-job-up.bad { background: var(--red-tint); color: var(--red); }

      .ss-alert {
        position: fixed; top: 0; left: 50%; transform: translateX(-50%); z-index: 60;
        width: 100%; max-width: 430px; display: flex; align-items: flex-start; gap: 10px;
        background: var(--red); color: #fff; padding: 12px 14px calc(12px + env(safe-area-inset-top));
        padding-top: calc(12px + env(safe-area-inset-top));
        font-size: 13px; font-weight: 700; line-height: 1.4;
        box-shadow: 0 6px 20px rgba(16,36,29,.25);
      }
      .ss-alert svg { flex-shrink: 0; margin-top: 1px; }
      .ss-alert span { flex: 1; }
      .ss-alert button { color: rgba(255,255,255,.85); flex-shrink: 0; }

      .ss-tip { display: flex; gap: 9px; align-items: flex-start; background: var(--amber-tint); color: var(--amber); border-radius: 12px; padding: 11px 13px; margin-top: 14px; font-size: 12.5px; font-weight: 600; line-height: 1.45; }
      .ss-tip svg { flex-shrink: 0; margin-top: 1px; }

      .ss-filter { margin-bottom: 12px; font-size: 15px; padding: 11px 13px; }
      .ss-group-label { font-size: 11px; font-weight: 800; letter-spacing: .07em; text-transform: uppercase; color: var(--muted); margin: 14px 2px 7px; }
      .ss-chip-main { font-size: 13.5px; }

      .ss-accept { display: flex; gap: 9px; align-items: flex-start; text-align: left; background: var(--paper); border: 1px solid var(--line); border-radius: 10px; padding: 11px 12px; margin-bottom: 14px; font-size: 13px; font-weight: 600; color: var(--ink); }
      .ss-accept input { width: 19px; height: 19px; flex-shrink: 0; accent-color: var(--red); margin: 0; }

      .ss-row-done { opacity: .82; }
      .ss-row-done .ss-row-tap:disabled { cursor: default; }
      .ss-job-up.warn { background: var(--amber-tint); color: var(--amber); }
      .ss-empty-note { font-size: 13.5px; color: var(--muted); text-align: center; padding: 22px 10px 4px; margin: 0; }

      .ss-shots { display: grid; grid-template-columns: repeat(2, 1fr); gap: 12px; }
      .ss-shot { display: flex; flex-direction: column; gap: 6px; }
      .ss-shot .ss-cell { width: 100%; }
      .ss-caption {
        width: 100%; background: var(--card); border: 1px solid var(--line);
        border-radius: 9px; padding: 8px 10px; font-size: 13px; font-family: inherit;
        color: var(--ink); outline: none;
      }
      .ss-caption:focus { border-color: var(--pine); }
      .ss-caption::placeholder { font-size: 12px; }
      .ss-modal-left { text-align: left; }
      .ss-modal-left .ss-modal-title { text-align: center; }

      /* ---- in-page live camera ---- */
      .ss-livecam {
        position: fixed; inset: 0; z-index: 65; background: #000;
        display: flex; flex-direction: column;
        max-width: 430px; margin: 0 auto; overflow: hidden;
      }
      /* contain, not cover: the saved photo is the whole frame, so the preview
         must show the whole frame — cropping a 4:3 feed to fill a tall phone
         hides ~40% of its width and reads as "zoomed in" next to the camera app */
      .ss-livecam-video { flex: 1; width: 100%; height: 100%; object-fit: contain; background: #000; touch-action: none; }
      .ss-livecam-seg { display: flex; gap: 2px; background: rgba(255,255,255,.14); border-radius: 999px; padding: 2px; flex-shrink: 0; }
      .ss-livecam-seg button { color: #fff; font-weight: 800; font-size: 12.5px; border-radius: 999px; padding: 5px 10px; font-variant-numeric: tabular-nums; }
      .ss-livecam-seg button.on { background: var(--hivis); color: var(--hivis-deep); }
      .ss-livecam-zoom {
        position: absolute; left: 50%; bottom: calc(112px + env(safe-area-inset-bottom));
        transform: translateX(-50%); z-index: 2;
        display: flex; align-items: center; gap: 10px;
        background: rgba(0,0,0,.5); border-radius: 999px; padding: 6px 16px 6px 12px;
      }
      .ss-livecam-zoom-label { color: #fff; font-weight: 800; font-size: 12.5px; font-variant-numeric: tabular-nums; min-width: 32px; text-align: center; }
      .ss-livecam-zoom-slider { width: 110px; accent-color: var(--hivis); touch-action: pan-x; }
      .ss-livecam-wide {
        display: flex; align-items: center; gap: 6px; white-space: nowrap; flex-shrink: 0;
        background: var(--hivis); color: var(--hivis-deep); font-weight: 800; font-size: 12.5px;
        border-radius: 999px; padding: 7px 12px;
      }
      .ss-camcheck {
        white-space: pre-wrap; word-break: break-word; margin: 10px 0 0;
        font: 600 11.5px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace;
        background: var(--paper); border: 1px solid var(--line); border-radius: 10px; padding: 10px; color: var(--ink);
      }
      .ss-livecam-flash { position: absolute; inset: 0; background: #fff; opacity: .85; animation: ss-flashfade .13s ease-out forwards; pointer-events: none; }
      @keyframes ss-flashfade { from { opacity: .85; } to { opacity: 0; } }
      .ss-livecam-top {
        position: absolute; top: 0; left: 0; right: 0;
        padding: 14px 14px calc(14px + env(safe-area-inset-top));
        padding-top: calc(14px + env(safe-area-inset-top));
        display: flex; align-items: center; gap: 10px;
        background: linear-gradient(rgba(0,0,0,.55), transparent);
      }
      .ss-livecam-close { width: 36px; height: 36px; border-radius: 999px; background: rgba(0,0,0,.4); color: #fff; display: flex; align-items: center; justify-content: center; }
      .ss-livecam-label { flex: 1; color: #fff; font-weight: 800; font-size: 15px; text-shadow: 0 1px 3px rgba(0,0,0,.5); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      .ss-livecam-count { min-width: 28px; text-align: center; background: var(--hivis); color: var(--hivis-deep); font-weight: 900; font-size: 14px; border-radius: 999px; padding: 4px 10px; font-variant-numeric: tabular-nums; }
      .ss-livecam-lens { height: 34px; padding: 0 10px; border-radius: 999px; background: rgba(0,0,0,.4); color: #fff; display: flex; align-items: center; justify-content: center; gap: 5px; flex-shrink: 0; font-weight: 800; font-size: 12px; font-variant-numeric: tabular-nums; }
      .ss-livecam-msg {
        position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center;
        gap: 14px; color: #fff; text-align: center; padding: 40px 32px; font-size: 14.5px; font-weight: 600;
      }
      .ss-livecam-fallback {
        display: flex; align-items: center; gap: 8px; background: var(--hivis); color: var(--hivis-deep);
        font-weight: 800; font-size: 14px; border-radius: 999px; padding: 11px 20px; margin-top: 6px;
      }
      .ss-livecam-bottom {
        position: absolute; bottom: 0; left: 0; right: 0;
        display: flex; align-items: center; justify-content: center; gap: 0;
        padding: 20px 24px calc(28px + env(safe-area-inset-bottom));
        background: linear-gradient(transparent, rgba(0,0,0,.55));
      }
      .ss-livecam-shutter {
        width: 72px; height: 72px; border-radius: 999px; background: #fff;
        border: 4px solid rgba(255,255,255,.5); flex-shrink: 0;
        transition: transform .08s ease;
      }
      .ss-livecam-shutter:active { transform: scale(.9); }
      .ss-livecam-last {
        position: absolute; left: 24px; bottom: calc(28px + env(safe-area-inset-bottom));
        width: 44px; height: 44px; border-radius: 10px; object-fit: cover;
        border: 2px solid rgba(255,255,255,.7); box-shadow: 0 4px 12px rgba(0,0,0,.4);
      }
      .ss-livecam-switch {
        position: absolute; right: 24px; bottom: calc(38px + env(safe-area-inset-bottom));
        width: 40px; height: 40px; border-radius: 999px; background: rgba(0,0,0,.4); color: #fff;
        display: flex; align-items: center; justify-content: center;
      }

      /* ---- case details ---- */
      .ss-case-toggle { display: flex; align-items: center; gap: 6px; margin: 10px auto 0; font-size: 12.5px; font-weight: 700; color: var(--muted); padding: 6px; }
      .ss-case { display: flex; flex-direction: column; gap: 8px; background: var(--card); border: 1px solid var(--line); border-radius: 13px; padding: 12px; margin-top: 6px; }

      /* ---- inspection list ---- */
      .ss-job { flex-direction: column; align-items: flex-start; gap: 2px; }
      .ss-job-sub { font-size: 12.5px; font-weight: 600; color: var(--muted); }
      .ss-job-x { width: 40px; height: 40px; display: flex; align-items: center; justify-content: center; color: var(--muted2); flex-shrink: 0; border-radius: 10px; }
      .ss-job-x:active { background: #F1F4EF; color: var(--red); }
      .ss-row .ss-row-tap { padding: 10px 0 10px 12px; }

      /* ---- voice memos ---- */
      .ss-vm { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin-top: 10px; }
      .ss-vm-btn {
        display: inline-flex; align-items: center; gap: 7px; font-size: 13px; font-weight: 800;
        border: 1.5px solid var(--line); background: var(--paper); color: var(--pine);
        border-radius: 999px; padding: 8px 14px;
      }
      .ss-vm-btn.rec { background: var(--red); border-color: var(--red); color: #fff; }
      .ss-vm-pulse { width: 9px; height: 9px; border-radius: 999px; background: #fff; animation: ss-pulse 1.2s ease-in-out infinite; }
      .ss-vm-item {
        display: inline-flex; align-items: center; gap: 6px; font-size: 12px; font-weight: 700;
        background: var(--pine-tint); color: var(--pine); border-radius: 999px; padding: 6px 6px 6px 11px;
      }
      .ss-vm-item button { display: inline-flex; color: var(--muted); padding: 2px; }
      .ss-vm-msg { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; font-weight: 600; color: var(--muted); }
      .ss-vm.dark .ss-vm-btn { background: rgba(217,244,79,.1); border-color: rgba(217,244,79,.35); color: var(--hivis); }
      .ss-vm.dark .ss-vm-btn.rec { background: #FF8A73; border-color: #FF8A73; color: #4A130A; }
      .ss-vm.dark .ss-vm-pulse { background: #4A130A; }
      .ss-vm.dark .ss-vm-item { background: rgba(217,244,79,.14); color: var(--hivis); }
      .ss-vm.dark .ss-vm-item button { color: rgba(217,244,79,.7); }
      .ss-vm.dark .ss-vm-msg { color: rgba(217,244,79,.6); }
      .ss-vm.dark { justify-content: center; }

      .ss-key-row { display: flex; align-items: center; gap: 8px; margin-top: 8px; color: var(--muted); }
      .ss-key-row .ss-input { flex: 1; }

      /* ---- upload progress ---- */
      .ss-upbar { height: 6px; border-radius: 999px; background: var(--line-soft); overflow: hidden; margin-top: 10px; }
      .ss-upbar > div { height: 100%; background: var(--pine); border-radius: 999px; transition: width .25s ease; }

      /* ---- modal ---- */
      .ss-modal-back { position: fixed; inset: 0; z-index: 60; background: rgba(10,14,11,.55); display: flex; align-items: center; justify-content: center; padding: 24px; }
      .ss-modal { width: 100%; max-width: 340px; background: var(--card); border-radius: 18px; padding: 22px; text-align: center; box-shadow: 0 20px 60px rgba(16,36,29,.35); }
      .ss-modal-icon { width: 44px; height: 44px; margin: 0 auto 12px; border-radius: 13px; background: var(--red-tint); color: var(--red); display: flex; align-items: center; justify-content: center; }
      .ss-modal-title { font-size: 18px; font-weight: 800; margin-bottom: 6px; }
      .ss-modal p { font-size: 13.5px; color: var(--muted); line-height: 1.5; margin: 0 0 16px; }

      /* ---- lightbox timestamp ---- */
      .ss-lb-time { text-align: center; color: rgba(255,255,255,.65); font-size: 12.5px; font-weight: 600; margin-bottom: 10px; }

      /* ---- report ---- */
      .ss-report { position: fixed; inset: 0; z-index: 70; background: #fff; overflow-y: auto; }
      .ss-report-bar {
        position: sticky; top: 0; z-index: 5; display: flex; justify-content: space-between;
        padding: 12px 16px; background: rgba(255,255,255,.95); backdrop-filter: blur(8px);
        border-bottom: 1px solid var(--line);
      }
      .ss-report-bar button { display: flex; align-items: center; gap: 6px; font-weight: 800; font-size: 13.5px; padding: 9px 14px; border-radius: 10px; }
      .ss-report-bar .close { color: var(--muted); }
      .ss-report-bar .print { background: var(--pine); color: #fff; }
      .ss-report-page { max-width: 720px; margin: 0 auto; padding: 28px 22px 48px; color: var(--ink); }
      .ss-rep-head { border-bottom: 3px solid var(--pine); padding-bottom: 18px; margin-bottom: 22px; }
      .ss-rep-brand { display: flex; align-items: center; gap: 6px; font-weight: 900; font-size: 13px; letter-spacing: .06em; text-transform: uppercase; color: var(--pine); margin-bottom: 10px; }
      .ss-rep-head h1 { font-family: 'Libre Caslon Text', Georgia, serif; font-size: 26px; font-weight: 700; margin: 0 0 8px; line-height: 1.15; }
      .ss-rep-meta { display: flex; flex-wrap: wrap; gap: 6px 16px; font-size: 13px; font-weight: 600; color: var(--muted); }
      .ss-rep-room { margin-bottom: 24px; break-inside: avoid-page; }
      .ss-rep-room-head { display: flex; align-items: center; gap: 4px; margin-bottom: 8px; }
      .ss-rep-room-head h2 { font-size: 16px; font-weight: 800; margin: 0; }
      .ss-rep-count { margin-left: auto; font-size: 12px; font-weight: 700; color: var(--muted); }
      .ss-rep-note { font-size: 13.5px; color: var(--ink); background: #F5F7F3; border-left: 3px solid var(--pine); border-radius: 0 8px 8px 0; padding: 8px 12px; margin: 0 0 10px; white-space: pre-wrap; }
      .ss-rep-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; }
      .ss-rep-grid img { width: 100%; aspect-ratio: 4/3; object-fit: cover; border-radius: 8px; border: 1px solid var(--line); }
      .ss-rep-foot { margin-top: 30px; padding-top: 14px; border-top: 1px solid var(--line); font-size: 12px; color: var(--muted); font-weight: 600; }

      @media print {
        .ss-noprint, .ss-toast, .ss-modal-back { display: none !important; }
        /* the app shell (.ss-root, min-height: 100vh) sits before the
           portaled .ss-report in the document; left visible it reserves a
           blank leading page before the report content even starts */
        .ss-root { display: none !important; }
        .ss-report { position: static; overflow: visible; }
        .ss-report-page { max-width: none; padding: 0; }
        .ss-rep-grid img { border: none; }
      }

      /* ---- settings / home header ---- */
      .ss-home-top { display: flex; align-items: center; justify-content: space-between; padding: 16px 16px 0; }
      .ss-icon-btn {
        width: 34px; height: 34px; border-radius: 10px; background: var(--card); border: 1px solid var(--line);
        display: flex; align-items: center; justify-content: center; color: var(--muted); flex-shrink: 0;
      }
      .ss-icon-btn:active { background: var(--line-soft); }
      .ss-topbar .ss-icon-btn { margin-left: 4px; }

      .ss-search-row {
        display: flex; align-items: center; gap: 8px; margin: 12px 16px 0; padding: 10px 12px;
        background: var(--card); border: 1px solid var(--line); border-radius: 12px;
      }
      .ss-search-ic { color: var(--muted); flex-shrink: 0; }
      .ss-search-input { flex: 1; border: none; background: none; font-size: 14.5px; font-family: inherit; color: var(--ink); outline: none; }
      .ss-search-input::placeholder { color: var(--muted2); }
      .ss-search-clear { color: var(--muted); flex-shrink: 0; display: flex; }

      .ss-cloud-connected {
        display: inline-flex; align-items: center; gap: 4px; font-size: 11px; font-weight: 800;
        color: var(--pine-press); background: var(--pine-tint); padding: 3px 9px; border-radius: 999px;
        max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex-shrink: 0;
      }

      /* A ledger row: icon, title + sub, a value or action on the right —
         Settings and the account panel are a continuous list of these
         rather than a stack of separately-bordered cards. */
      .ss-ledger-row { display: flex; align-items: center; gap: 12px; min-height: 54px; padding: 10px 0; border-bottom: 1px solid var(--line); }
      .ss-ledger-ic { color: var(--pine); display: flex; flex-shrink: 0; }
      .ss-ledger-main { flex: 1; min-width: 0; }
      .ss-ledger-title { font-weight: 700; font-size: 15px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      .ss-ledger-sub { font-size: 12px; color: var(--muted); margin-top: 1px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      .ss-ledger-status { font-size: 13px; color: var(--muted); font-weight: 600; flex-shrink: 0; }
      .ss-ledger-row.ss-no-border { border-bottom: none; }

      .ss-settings-row { display: flex; align-items: center; gap: 12px; padding: 13px 0; border-bottom: 1px solid var(--line); }
      .ss-settings-ic {
        width: 36px; height: 36px; border-radius: 10px; background: var(--pine-tint); color: var(--pine-press);
        display: flex; align-items: center; justify-content: center; flex-shrink: 0;
      }
      .ss-settings-title { font-weight: 800; font-size: 14px; }
      .ss-settings-sub { font-size: 12px; font-weight: 600; color: var(--muted); margin-top: 1px; }
      .ss-toggle {
        width: 44px; height: 26px; border-radius: 999px; background: var(--line); position: relative; flex-shrink: 0;
        transition: background .15s ease;
      }
      .ss-toggle.on { background: var(--pine); }
      .ss-toggle span {
        position: absolute; top: 2px; left: 2px; width: 22px; height: 22px; border-radius: 50%;
        background: #fff; box-shadow: 0 1px 3px rgba(0,0,0,.25); transition: transform .15s ease;
      }
      .ss-toggle.on span { transform: translateX(18px); }

      .ss-storage-card { background: var(--card); border: 1px solid var(--line); border-radius: 14px; padding: 14px; }

      /* ---- draft findings ---- */
      .ss-findings-count { font-size: 12.5px; font-weight: 700; color: var(--muted); }
      .ss-findings-page { max-width: 560px; }
      .ss-findings-banner {
        display: flex; gap: 9px; align-items: flex-start; background: var(--amber-tint); color: var(--amber);
        border-radius: 12px; padding: 12px 14px; font-size: 12.5px; font-weight: 600; line-height: 1.45; margin-bottom: 16px;
      }
      .ss-findings-banner svg { flex-shrink: 0; margin-top: 1px; }
      .ss-finding-card { background: var(--card); border: 1px solid var(--line); border-radius: 14px; padding: 14px; margin-bottom: 12px; }
      .ss-finding-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 10px; }
      .ss-finding-room { font-weight: 800; font-size: 13.5px; }
      .ss-pill-conf { font-size: 11px; font-weight: 800; padding: 4px 9px; border-radius: 999px; white-space: nowrap; }
      .ss-pill-conf.ok { background: var(--pine-tint); color: var(--pine-press); }
      .ss-pill-conf.warn { background: var(--amber-tint); color: var(--amber); }
      .ss-finding-label { font-size: 10.5px; font-weight: 800; letter-spacing: .07em; text-transform: uppercase; color: var(--muted2); margin: 10px 0 3px; }
      .ss-finding-label:first-of-type { margin-top: 0; }
      .ss-finding-text { font-family: 'Libre Caslon Text', Georgia, serif; font-size: 15px; line-height: 1.5; margin: 0; }
      .ss-finding-leg { display: inline-flex; align-items: center; gap: 6px; background: var(--pine-tint); color: var(--pine-press); padding: 5px 10px; border-radius: 8px; font-size: 12px; font-weight: 700; }
      .ss-finding-leg-empty { font-size: 12px; font-weight: 600; color: var(--muted2); font-style: italic; }

      /* ---- draft findings (AI step) ---- */
      .ss-ai-bar { display: flex; align-items: center; gap: 10px; padding: 10px 12px; margin-bottom: 12px; border-radius: 12px; background: var(--card); border: 1px solid var(--line); font-size: 12.5px; color: var(--muted); }
      .ss-ai-bar b { color: var(--ink); }
      .ss-ai-bar svg { color: var(--pine); flex-shrink: 0; }
      .ss-draft-rooms { display: flex; flex-direction: column; gap: 6px; margin: 0 0 14px; }
      .ss-draft-room { display: flex; align-items: center; gap: 10px; font-size: 13px; font-weight: 600; padding: 8px 12px; border-radius: 10px; background: var(--card); border: 1px solid var(--line); }
      .ss-draft-room .st { margin-left: auto; font-size: 11.5px; font-weight: 800; letter-spacing: .04em; text-transform: uppercase; color: var(--muted2); display: inline-flex; align-items: center; gap: 5px; }
      .ss-draft-room .st.done { color: var(--pine); }
      .ss-draft-room .st.failed, .ss-draft-room .st.cancelled { color: var(--red); }
      .ss-draft-room .st.drafting, .ss-draft-room .st.transcribing { color: var(--amber); }
      .ss-room-run { margin: 18px 0 8px; }
      .ss-room-run-head { display: flex; align-items: baseline; justify-content: space-between; gap: 10px; }
      .ss-room-run-head h3 { font-size: 15px; font-weight: 800; margin: 0; }
      .ss-room-run-meta { font-size: 11.5px; color: var(--muted2); font-weight: 600; white-space: nowrap; }
      .ss-room-summary { font-family: 'Libre Caslon Text', Georgia, serif; font-size: 14px; color: var(--muted); margin: 6px 0 10px; line-height: 1.5; }
      .ss-gaps { margin: 0 0 12px; padding: 10px 12px; border-radius: 10px; background: var(--amber-tint); color: var(--amber); font-size: 12.5px; font-weight: 600; }
      .ss-gaps ul { margin: 4px 0 0; padding-left: 18px; }
      .ss-transcript-toggle { font-size: 12px; font-weight: 700; color: var(--pine); background: none; padding: 0; margin: 0 0 10px; display: inline-flex; align-items: center; gap: 5px; }
      .ss-transcript { font-size: 13px; color: var(--muted); background: var(--paper-deep); border-radius: 10px; padding: 10px 12px; margin: 0 0 12px; white-space: pre-wrap; line-height: 1.5; }
      .ss-finding-title { font-weight: 800; font-size: 15px; line-height: 1.3; }
      .ss-finding-status { font-size: 10.5px; font-weight: 800; letter-spacing: .06em; text-transform: uppercase; padding: 4px 8px; border-radius: 999px; white-space: nowrap; }
      .ss-finding-status.draft { background: var(--paper-deep); color: var(--muted); }
      .ss-finding-status.approved, .ss-finding-status.edited { background: var(--pine-tint); color: var(--pine-press); }
      .ss-finding-status.rejected { background: var(--red-tint); color: var(--red); }
      .ss-finding-card.rejected { opacity: .6; }
      .ss-flag { display: flex; gap: 10px; padding: 12px; border-radius: 12px; margin: 10px 0 4px; font-size: 13px; line-height: 1.45; }
      .ss-flag svg { flex-shrink: 0; margin-top: 2px; }
      .ss-flag.disagree { background: var(--red-tint); color: var(--red); border: 1px solid color-mix(in srgb, var(--red) 25%, transparent); }
      .ss-flag.uncertain { background: var(--amber-tint); color: var(--amber); border: 1px solid color-mix(in srgb, var(--amber) 25%, transparent); }
      .ss-flag.agree { background: var(--pine-tint); color: var(--pine-press); }
      .ss-flag b { display: block; font-size: 12px; letter-spacing: .05em; text-transform: uppercase; margin-bottom: 4px; }
      .ss-flag .kv { display: grid; grid-template-columns: auto 1fr; gap: 2px 10px; margin: 4px 0; color: var(--ink); }
      .ss-flag .kv span:nth-child(odd) { font-weight: 800; font-size: 12px; }
      .ss-flag p { margin: 6px 0 0; color: var(--ink); }
      .ss-chips { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 4px; }
      .ss-chip { font-size: 11.5px; font-weight: 700; padding: 4px 9px; border-radius: 999px; background: var(--paper-deep); color: var(--muted); display: inline-flex; align-items: center; gap: 4px; }
      .ss-chip.warn { background: var(--amber-tint); color: var(--amber); }
      .ss-chip.leg { background: var(--pine-tint); color: var(--pine-press); }
      .ss-scope { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; font-weight: 800; color: var(--pine); margin: 2px 0 4px; }
      .ss-scope-why { font-size: 12.5px; color: var(--muted); margin: 0; }
      .ss-cost { font-family: 'Libre Caslon Text', Georgia, serif; font-size: 17px; font-weight: 700; }
      .ss-cost.unpriced { color: var(--amber); font-size: 14px; }
      .ss-cost-basis { font-size: 12px; color: var(--muted); margin: 2px 0 0; }
      .ss-finding-actions { display: flex; gap: 8px; margin-top: 12px; flex-wrap: wrap; }
      .ss-finding-actions .ss-btn { flex: 1; min-width: 96px; padding: 10px 12px; font-size: 13px; }
      .ss-btn-danger-ghost { background: var(--red-tint); color: var(--red); }
      .ss-edit-form { display: flex; flex-direction: column; gap: 8px; margin-top: 10px; }
      .ss-edit-form label { font-size: 10.5px; font-weight: 800; letter-spacing: .07em; text-transform: uppercase; color: var(--muted2); }
      .ss-edit-form textarea, .ss-edit-form input { width: 100%; border: 1px solid var(--line); border-radius: 10px; padding: 10px; font: inherit; font-size: 14px; background: var(--card); color: var(--ink); }
      .ss-edit-form .row { display: flex; gap: 8px; }
      .ss-hyp-input { margin-top: 6px; font-size: 14px; }
      /* ID photo slot */
      .ss-idphoto { display: flex; align-items: center; gap: 12px; padding: 12px; border-radius: 13px; background: var(--card); border: 1px solid var(--line); margin-top: 14px; }
      .ss-idphoto img { width: 54px; height: 54px; border-radius: 10px; object-fit: cover; border: 1px solid var(--line); }
      .ss-idphoto .ph { width: 54px; height: 54px; border-radius: 10px; background: var(--paper-deep); display: flex; align-items: center; justify-content: center; color: var(--muted2); }
      .ss-idphoto-main { flex: 1; min-width: 0; }
      .ss-idphoto-main b { display: block; font-size: 14px; }
      .ss-idphoto-main span { font-size: 12px; color: var(--muted); }
      .ss-idphoto-actions { display: flex; gap: 6px; }
      .ss-idphoto-actions button { width: 34px; height: 34px; border-radius: 9px; background: var(--paper-deep); color: var(--pine); display: flex; align-items: center; justify-content: center; }
      /* report */
      .ss-rep-finding { border-left: 3px solid var(--pine); padding: 6px 0 6px 12px; margin: 10px 0 12px; font-size: 13.5px; line-height: 1.5; break-inside: avoid; }
      .ss-rep-finding p { margin: 4px 0; }
      .ss-rep-finding em { font-style: normal; font-weight: 800; color: var(--muted); }
      .ss-rep-finding-head { display: flex; align-items: baseline; gap: 8px; flex-wrap: wrap; margin-bottom: 4px; }
      .ss-rep-finding-n { font-size: 11px; font-weight: 800; letter-spacing: .06em; text-transform: uppercase; color: var(--pine); }
      .ss-rep-finding-leg { font-size: 11.5px; font-weight: 700; color: var(--muted); margin-left: auto; }
      .ss-rep-finding-cost { color: var(--ink); }

      /* ---- on-photo annotation ---- */
      .ss-annotate {
        position: fixed; inset: 0; z-index: 68; background: #0B0F0A;
        display: flex; flex-direction: column; color: #fff;
      }
      .ss-annotate-top {
        display: flex; align-items: center; justify-content: space-between; padding: 16px 18px;
        font-size: 13px; font-weight: 800; letter-spacing: .04em; text-transform: uppercase; color: rgba(255,255,255,.7);
      }
      .ss-annotate-top button { width: 36px; height: 36px; border-radius: 50%; background: rgba(255,255,255,.12); display: flex; align-items: center; justify-content: center; color: #fff; }
      .ss-annotate-top button:disabled { opacity: .35; }
      .ss-annotate-stage { position: relative; flex: 1; min-height: 0; margin: 0 14px 12px; border-radius: 16px; overflow: hidden; display: flex; align-items: center; justify-content: center; background: #000; }
      .ss-annotate-stage img { max-width: 100%; max-height: 100%; width: 100%; height: 100%; object-fit: contain; display: block; user-select: none; }
      .ss-annotate-stage canvas { position: absolute; inset: 0; width: 100%; height: 100%; touch-action: none; }
      .ss-annotate-tools { display: flex; align-items: center; gap: 10px; padding: 14px 18px calc(14px + env(safe-area-inset-bottom)); }
      .ss-annotate-tool { width: 44px; height: 44px; border-radius: 12px; background: rgba(255,255,255,.10); display: flex; align-items: center; justify-content: center; color: #fff; flex-shrink: 0; }
      .ss-annotate-tool.on { background: var(--hivis); color: var(--hivis-deep); }

      /* ---- top-level tab bar (Home / Cases / Settings) ---- */
      .ss-tabbar {
        display: flex; border-top: 1px solid var(--line); background: var(--card);
        padding-bottom: env(safe-area-inset-bottom); flex-shrink: 0;
      }
      .ss-tabbar-item {
        flex: 1; display: flex; flex-direction: column; align-items: center; gap: 3px;
        padding: 9px 0 7px; color: var(--muted2); font-size: 10.5px; font-weight: 700;
      }
      .ss-tabbar-item.on { color: var(--pine); }
      .ss-title-lg { font-family: 'Libre Caslon Text', Georgia, serif; font-size: 22px; font-weight: 700; }

      /* ---- case file: shared tab strip ---- */
      .ss-case-tabs { display: flex; gap: 20px; padding: 0 18px; border-bottom: 1px solid var(--line); background: var(--card); flex-shrink: 0; overflow-x: auto; }
      .ss-case-tab { padding: 12px 2px; font-size: 13px; font-weight: 700; color: var(--muted); border-bottom: 2px solid transparent; white-space: nowrap; }
      .ss-case-tab.on { color: var(--pine); border-bottom-color: var(--pine); }

      /* ---- case file: overview tab ---- */
      .ss-case-cover { margin: 16px 18px 0; background: var(--card); border: 1px solid var(--line); border-radius: 14px; padding: 16px; }
      .ss-case-cover-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 14px; }
      .ss-stamp {
        display: inline-flex; align-items: center; justify-content: center; padding: 4px 11px;
        border: 1.5px solid var(--pine); border-radius: 4px; color: var(--pine);
        font-family: 'Libre Caslon Text', Georgia, serif; font-size: 11px; font-weight: 700;
        letter-spacing: .06em; text-transform: uppercase; transform: rotate(-3deg); white-space: nowrap;
      }
      .ss-stamp.light { border-color: rgba(255,255,255,.6); color: #fff; }
      .ss-case-kv-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 14px 12px; }
      .ss-kv-label { font-size: 10px; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; color: var(--muted2); margin-bottom: 2px; }
      .ss-kv-value { font-size: 13.5px; font-weight: 700; color: var(--ink); }

      .ss-activity { background: var(--card); border: 1px solid var(--line); border-radius: 14px; padding: 4px 14px; }
      .ss-activity-row { display: flex; align-items: flex-start; gap: 11px; padding: 10px 0; border-bottom: 1px solid var(--line); }
      .ss-activity-row:last-child { border-bottom: none; }
      .ss-activity-time { width: 42px; flex-shrink: 0; font-size: 10.5px; font-weight: 700; color: var(--muted2); padding-top: 1px; }
      .ss-activity-dot { width: 5px; height: 5px; border-radius: 50%; background: var(--pine); margin-top: 6px; flex-shrink: 0; }
      .ss-activity-text { flex: 1; font-size: 12.5px; font-weight: 600; color: var(--ink); line-height: 1.4; }

      /* ---- home dashboard: active case hero ---- */
      .ss-case-hero {
        display: block; width: 100%; text-align: left; margin: 16px 18px 0; padding: 18px;
        background: var(--pine); color: #fff; border-radius: 16px; box-shadow: 0 16px 36px rgba(16,53,42,.22);
      }
      .ss-case-hero-head { display: flex; align-items: center; justify-content: space-between; }
      .ss-case-hero-time { font-size: 10.5px; font-weight: 600; color: rgba(255,255,255,.6); }
      .ss-case-hero-title { font-family: 'Libre Caslon Text', Georgia, serif; font-size: 19px; font-weight: 700; margin-top: 13px; }
      .ss-case-hero-sub { font-size: 12px; font-weight: 500; color: rgba(255,255,255,.65); margin-top: 2px; }
      .ss-case-hero-collage { display: grid; grid-template-columns: repeat(4, 1fr); gap: 5px; margin-top: 14px; }
      .ss-case-hero-collage img { width: 100%; aspect-ratio: 1; border-radius: 5px; object-fit: cover; display: block; }
      .ss-case-hero-cta {
        display: flex; align-items: center; justify-content: center; gap: 8px; margin-top: 16px;
        background: var(--hivis); color: var(--hivis-deep); padding: 11px 0; border-radius: 10px; font-size: 13px; font-weight: 800;
      }
      .ss-row-tap-full {
        display: flex; align-items: center; justify-content: space-between; gap: 10px; width: 100%; text-align: left;
        background: var(--card); border: 1px solid var(--line); border-radius: 13px; padding: 13px 14px; font-size: 13.5px; font-weight: 700;
      }

      /* ---- walk: exhibit stamp ---- */
      .ss-live-stamp {
        display: inline-block; margin-top: 10px; padding: 4px 10px; border: 1.5px solid rgba(217,244,79,.5);
        border-radius: 4px; color: var(--hivis); font-size: 11px; font-weight: 700; letter-spacing: .05em; text-transform: uppercase;
      }

      /* ---- accounts: sign-in, firm, team ---- */
      .ss-signin { padding-top: 40px; }
      .ss-signin form { display: flex; flex-direction: column; }
      .ss-code-boxes { position: relative; display: flex; gap: 8px; }
      .ss-code-box { flex: 1; height: 56px; background: var(--card); border: 1px solid var(--line); border-radius: 12px; display: flex; align-items: center; justify-content: center; font: 800 26px/1 ui-monospace, SFMono-Regular, Menlo, monospace; color: var(--ink); }
      .ss-code-box.active { border-color: var(--pine); border-width: 1.5px; }
      .ss-code-input { position: absolute; inset: 0; opacity: 0; border: 0; width: 100%; height: 100%; padding: 0; margin: 0; font-size: 16px; }
      .ss-signin-oauth { display: flex; align-items: center; gap: 8px; margin: 20px 0 0; padding-top: 18px; border-top: 1px solid var(--line); font-size: 13px; color: var(--muted); }
      .ss-signin-dot { color: var(--muted2); }
      .ss-signin-links { display: flex; justify-content: space-between; margin-top: 14px; }
      .ss-signin-links .ss-link { padding: 6px 0; }
      .ss-error { color: var(--red); margin: 12px 2px 0; }
      .ss-invite-banner { background: var(--pine-tint); border: 1px solid var(--line); border-radius: 12px; padding: 12px 14px; font-size: 14px; margin-bottom: 18px; line-height: 1.45; }
      .ss-org-card { background: var(--card); border: 1px solid var(--line); border-radius: 14px; padding: 14px; margin-bottom: 12px; }
      .ss-org-card-title { display: flex; align-items: center; gap: 7px; font-weight: 800; font-size: 14px; }
      .ss-org-row { width: 100%; display: flex; align-items: center; justify-content: space-between; padding: 12px 4px; border-top: 1px solid var(--line-soft); font-weight: 700; font-size: 14px; text-align: left; }
      .ss-org-row:first-of-type { border-top: 0; }
      .ss-role-pill { font-size: 11px; font-weight: 800; letter-spacing: .06em; text-transform: uppercase; color: var(--muted); background: var(--paper-deep); border-radius: 999px; padding: 4px 9px; flex-shrink: 0; }
      .ss-member-row { display: flex; align-items: center; gap: 10px; padding: 10px 0; border-top: 1px solid var(--line-soft); }
      .ss-member-row:first-child { border-top: 0; padding-top: 2px; }
      .ss-member-name { font-weight: 700; font-size: 14px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      .ss-member-sub { font-size: 12px; color: var(--muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      .ss-role-select { appearance: none; -webkit-appearance: none; background: var(--paper-deep); border: 1px solid var(--line); border-radius: 10px; padding: 8px 10px; font: inherit; font-size: 13px; font-weight: 700; color: var(--ink); }
      .ss-icon-btn { width: 32px; height: 32px; border-radius: 999px; display: flex; align-items: center; justify-content: center; color: var(--muted); background: var(--paper-deep); flex-shrink: 0; }
      .ss-invite-result { margin-top: 12px; padding-top: 12px; border-top: 1px solid var(--line-soft); }
      .ss-account-row { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 8px 0; font-size: 13.5px; }
      .ss-account-row .ss-muted { color: var(--muted); }
      /* a wide <select> or a long value in a flex row must shrink, never push
         the page sideways */
      .ss-scroll { overflow-x: hidden; }
      .ss-key-row > * { min-width: 0; }
      .ss-role-select { max-width: 100%; width: 100%; text-overflow: ellipsis; }

      /* ---- team table ---- */
      .ss-team-head {
        display: grid; grid-template-columns: minmax(0, 1fr) 80px 56px; gap: 8px; align-items: baseline;
        padding-bottom: 6px; border-bottom: 1px solid var(--ink);
        font-size: 11px; font-weight: 800; letter-spacing: .09em; text-transform: uppercase; color: var(--muted);
      }
      .ss-team-head span:last-child { text-align: right; }
      .ss-team-row {
        display: grid; grid-template-columns: minmax(0, 1fr) 80px 56px; gap: 8px; align-items: center;
        min-height: 52px; padding: 8px 0; border-bottom: 1px solid var(--line);
      }
      .ss-team-active { font-size: 12.5px; color: var(--muted); text-align: right; font-variant-numeric: tabular-nums; }
      .ss-team-cancel { font-size: 12.5px; font-weight: 700; color: var(--muted); text-align: right; }
      .ss-team-pending { font-size: 10.5px; font-weight: 800; letter-spacing: .08em; text-transform: uppercase; color: var(--amber); }

      /* ---- first run + background filing ---- */
      .ss-cloud-status {
        display: flex; align-items: center; gap: 8px; width: 100%; margin-top: 16px;
        padding: 9px 0; border-top: 1px solid var(--line); border-bottom: 1px solid var(--line);
        font-size: 12.5px; color: var(--muted); text-align: left;
      }
      .ss-cloud-status b { color: var(--ink); }
      .ss-cloud-status-cta { margin-left: auto; display: flex; align-items: center; gap: 2px; color: var(--pine); font-weight: 700; white-space: nowrap; flex-shrink: 0; }
      .ss-home-hero .ss-cloud-status { margin-top: 22px; }
      .ss-live-filing { display: block; margin-top: 8px; font-size: 12px; font-weight: 700; color: var(--hivis); opacity: .85; }
      .ss-filing-note { margin-top: 8px; }

      /* ---- firm register ---- */
      .ss-sync { display: flex; align-items: center; gap: 6px; font-size: 12px; font-weight: 700; color: var(--muted); margin: 10px 2px 0; }
      .ss-sync-error { color: var(--red); }
      .ss-sync-offline { color: var(--amber); }
      .ss-remote-room { background: var(--card); border: 1px solid var(--line); border-radius: 14px; padding: 12px 14px; margin-top: 10px; }
      .ss-remote-room-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
      .ss-remote-note { margin: 6px 0 0; font-size: 13px; color: var(--muted); white-space: pre-wrap; }
      .ss-remote-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; margin-top: 10px; }
      .ss-remote-thumb { margin: 0; }
      .ss-remote-thumb img, .ss-remote-thumb-empty { width: 100%; aspect-ratio: 1; object-fit: cover; border-radius: 8px; background: var(--paper-deep); display: block; }
      .ss-remote-thumb figcaption { font-size: 10.5px; color: var(--muted); margin-top: 3px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      .ss-cond-pill { font-size: 11px; font-weight: 800; letter-spacing: .04em; text-transform: uppercase; border-radius: 999px; padding: 3px 8px; background: var(--paper-deep); color: var(--muted); }
      .ss-cond-pill.poor { background: #F3E3DF; color: var(--red); }
      .ss-cond-pill.fair { background: #F2ECDD; color: var(--amber); }
      .ss-cond-pill.good { background: var(--pine-tint); color: var(--pine); }
    `}</style>
  );
}
