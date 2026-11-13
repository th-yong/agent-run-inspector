// Number formatting for the UI. Unknown values (null, undefined, NaN) show as a dash.
const DASH = '—';
const known = (n) => typeof n === 'number' && Number.isFinite(n);

/** 999 -> "999", 1200 -> "1.2k", 3400000 -> "3.4M" */
export function fmtTokens(n) {
  if (!known(n)) return DASH;
  if (n < 1000) return String(Math.round(n));
  const tenthsOfK = Math.round(n / 100);
  if (tenthsOfK < 10000) return `${(tenthsOfK / 10).toFixed(1)}k`;
  return `${(n / 1e6).toFixed(1)}M`;
}

/** 0.0123 -> "$0.0123", 1.25 -> "$1.25" */
export function fmtUsd(v) {
  if (!known(v)) return DASH;
  if (v < 1 && v.toFixed(4) !== '1.0000') return `$${v.toFixed(4)}`;
  return `$${v.toFixed(2)}`;
}

/** 820 -> "820ms", 12400 -> "12.4s", 185000 -> "3m 05s", 3720000 -> "1h 02m" */
export function fmtDuration(ms) {
  if (!known(ms)) return DASH;
  const r = Math.round(ms);
  if (r < 1000) return `${r}ms`;
  const tenths = Math.round(ms / 100);
  if (tenths < 600) return `${(tenths / 10).toFixed(1)}s`;
  const total = Math.round(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}h ${String(m).padStart(2, '0')}m`;
  return `${m}m ${String(s).padStart(2, '0')}s`;
}
