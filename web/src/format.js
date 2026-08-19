export function money(v) {
  return Number(v ?? 0).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function num(v) {
  return Number(v ?? 0).toLocaleString('zh-CN', { maximumFractionDigits: 0 });
}

export function pct(v) {
  if (v === null || v === undefined) return '—';
  const sign = v > 0 ? '+' : '';
  return `${sign}${Number(v).toFixed(2)}%`;
}
