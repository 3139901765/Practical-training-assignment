import { useEffect, useRef, useState } from 'react';
import * as echarts from 'echarts';
import { money } from '../format.js';

export default function ComparePanel({ stores = [], categories = [], activeStoreId, onStoreClick, highlightKey }) {
  const ref = useRef(null);
  const chartRef = useRef(null);
  const [tab, setTab] = useState('stores');

  useEffect(() => {
    if (!ref.current) return undefined;
    chartRef.current ??= echarts.init(ref.current);
    const chart = chartRef.current;
    const data = tab === 'stores' ? stores : categories;
    const key = tab === 'stores' ? 'store_name' : 'category';
    chart.setOption({
      animationDuration: 400,
      grid: { left: 8, right: 60, top: 8, bottom: 8, containLabel: true },
      tooltip: {
        trigger: 'item',
        backgroundColor: '#2b2f2b',
        borderWidth: 0,
        textStyle: { color: '#fff' },
        formatter: (p) => `${p.name}<br/>¥${money(p.value)}`,
      },
      xAxis: {
        type: 'value',
        axisLabel: { color: '#8a8578', fontSize: 11, formatter: (v) => `¥${(v / 10000).toFixed(1)}w` },
        splitLine: { lineStyle: { color: '#eeeae1' } },
      },
      yAxis: {
        type: 'category',
        inverse: true,
        data: data.map((d) => d[key]),
        axisLabel: { color: '#3d3a34', fontSize: 12 },
        axisLine: { show: false },
        axisTick: { show: false },
      },
      series: [
        {
          type: 'bar',
          data: data.map((d) => d.revenue),
          barWidth: 18,
          itemStyle: {
            color: (p) => (tab === 'stores' && stores[p.dataIndex]?.store_id === activeStoreId ? '#d9583b' : '#e8a87c'),
            borderRadius: [0, 9, 9, 0],
          },
          label: {
            show: true,
            position: 'right',
            color: '#3d3a34',
            fontSize: 11,
            formatter: (p) => {
              const d = data[p.dataIndex];
              return `${money(d.revenue)} · ${d.share}%`;
            },
          },
        },
      ],
    });
    chart.off('click');
    if (tab === 'stores') {
      chart.on('click', (p) => {
        const st = stores[p.dataIndex];
        if (st) onStoreClick(st.store_id);
      });
    }
    const onResize = () => chart.resize();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [tab, stores, categories, activeStoreId]);

  useEffect(() => {
    if (highlightKey === 'stores' || highlightKey === 'categories') {
      setTab(highlightKey === 'stores' ? 'stores' : 'categories');
    }
  }, [highlightKey]);

  return (
    <section className={`card compare-card ${highlightKey === 'stores' || highlightKey === 'categories' ? 'flash' : ''}`} id="compare">
      <div className="card-head">
        <h2>门店对比</h2>
        <div className="seg">
          <button className={tab === 'stores' ? 'active' : ''} onClick={() => setTab('stores')}>门店</button>
          <button className={tab === 'categories' ? 'active' : ''} onClick={() => setTab('categories')}>品类</button>
        </div>
      </div>
      <div className="chart chart-compare" ref={ref} />
      <p className="panel-note">点击门店柱条可筛选该门店，再次点击取消。</p>
    </section>
  );
}
