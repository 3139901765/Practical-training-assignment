import { useEffect, useRef, useState } from 'react';
import * as echarts from 'echarts';
import { money } from '../format.js';

const METRICS = [
  { key: 'revenue', label: '营业额', color: '#d9583b' },
  { key: 'orders', label: '订单数', color: '#3b82c4' },
  { key: 'aov', label: '客单价', color: '#8a6d3b' },
];

export default function TrendChart({ perDay = [], highlightKey }) {
  const boxRef = useRef(null);
  const sectionRef = useRef(null);
  const chartRef = useRef(null);
  const [metric, setMetric] = useState('revenue');

  useEffect(() => {
    if (!boxRef.current) return undefined;
    chartRef.current ??= echarts.init(boxRef.current);
    const chart = chartRef.current;
    const dates = perDay.map((d) => d.date.slice(5));
    const active = METRICS.find((m) => m.key === metric);
    const yFmt = (v) => (metric === 'orders' ? `${Number(v).toLocaleString()} 单` : `¥${money(v)}`);
    chart.setOption({
      animationDuration: 400,
      grid: { left: 16, right: 16, top: 30, bottom: 8, containLabel: true },
      tooltip: {
        trigger: 'axis',
        backgroundColor: '#2b2f2b',
        borderWidth: 0,
        textStyle: { color: '#fff', fontSize: 12 },
        formatter(params) {
          const i = params[0].dataIndex;
          const d = perDay[i];
          if (!d) return '';
          return `<b>${d.date}</b><br/>营业额 ¥${money(d.revenue)}<br/>订单数 ${Number(d.orders).toLocaleString()} 单<br/>客单价 ¥${money(d.aov)}`;
        },
      },
      xAxis: {
        type: 'category',
        data: dates,
        boundaryGap: false,
        axisLine: { lineStyle: { color: '#d8d3c8' } },
        axisLabel: { color: '#8a8578', fontSize: 11 },
      },
      yAxis: {
        type: 'value',
        axisLabel: { color: '#8a8578', fontSize: 11 },
        splitLine: { lineStyle: { color: '#eeeae1' } },
      },
      series: [
        {
          name: active.label,
          type: 'line',
          data: perDay.map((d) => d[metric]),
          smooth: 0.35,
          symbol: 'circle',
          symbolSize: 5,
          lineStyle: { width: 2.5, color: active.color },
          itemStyle: { color: active.color },
          areaStyle: {
            color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
              { offset: 0, color: `${active.color}55` },
              { offset: 1, color: `${active.color}05` },
            ]),
          },
        },
      ],
    });
    const onResize = () => chart.resize();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [perDay, metric]);

  useEffect(() => {
    if (highlightKey === 'trend' && sectionRef.current) {
      sectionRef.current.classList.add('flash');
      const t = setTimeout(() => sectionRef.current.classList.remove('flash'), 2200);
      return () => clearTimeout(t);
    }
    return undefined;
  }, [highlightKey]);

  return (
    <section className="card trend-card" ref={sectionRef}>
      <div className="card-head">
        <h2>营业额趋势</h2>
        <div className="seg">
          {METRICS.map((m) => (
            <button
              key={m.key}
              className={metric === m.key ? 'active' : ''}
              onClick={() => setMetric(m.key)}
            >
              {m.label}
            </button>
          ))}
        </div>
      </div>
      <div className="chart" ref={boxRef} aria-label="营业额趋势图" />
    </section>
  );
}
