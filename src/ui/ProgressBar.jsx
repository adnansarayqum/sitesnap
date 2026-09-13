// A thin determinate bar. `value` is 0–100.
export function ProgressBar({ value, label }) {
  const pct = Math.max(0, Math.min(100, Math.round(Number(value) || 0)));
  return (
    <div className="ss-progress" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label={label}>
      <div style={{ width: `${pct}%` }} />
    </div>
  );
}
