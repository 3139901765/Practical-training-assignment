import { money, num, pct } from '../format.js';

function Delta({ value, label }) {
  if (value === null || value === undefined) {
    return <span className="delta neutral">无同期数据</span>;
  }
  const up = value >= 0;
  return (
    <span className={`delta ${up ? 'up' : 'down'}`}>
      <span className="arrow">{up ? '▲' : '▼'}</span>
      {pct(value)}
      <span className="delta-label">较{label}</span>
    </span>
  );
}

export default function KpiCards({ overview }) {
  if (!overview) return null;
  const cards = [
    { label: '总营业额', value: money(overview.totalRevenue), hint: `${overview.days} 天累计`, delta: overview.delta.revenuePct, deltaLabel: '上期' },
    { label: '订单数', value: num(overview.totalOrders), hint: `日均 ${num(Math.round(overview.totalOrders / overview.days))} 单`, delta: overview.delta.ordersPct, deltaLabel: '上期' },
    { label: '客单价', value: money(overview.aov), hint: '营业额 ÷ 订单数', delta: overview.delta.aovPct, deltaLabel: '上期' },
  ];
  return (
    <div className="kpi-row">
      {cards.map((c) => (
        <div className="kpi-card" key={c.label}>
          <div className="kpi-label">{c.label}</div>
          <div className="kpi-value">{c.value}</div>
          <div className="kpi-foot">
            <span className="kpi-hint">{c.hint}</span>
            <Delta value={c.delta} label={c.deltaLabel} />
          </div>
        </div>
      ))}
    </div>
  );
}
