import { useEffect, useRef, useState } from 'react';
import { api } from './api.js';
import KpiCards from './components/KpiCards.jsx';
import TrendChart from './components/TrendChart.jsx';
import TopProducts from './components/TopProducts.jsx';
import ComparePanel from './components/ComparePanel.jsx';
import ChatPanel from './components/ChatPanel.jsx';

function monthRange(month) {
  const [y, m] = month.split('-').map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const pad = (n) => String(n).padStart(2, '0');
  return { from: `${y}-${pad(m)}-01`, to: `${y}-${pad(m)}-${pad(last)}` };
}

export default function App() {
  const [meta, setMeta] = useState(null);
  const [range, setRange] = useState(null);
  const [custom, setCustom] = useState({ from: '', to: '' });
  const [storeId, setStoreId] = useState('');
  const [overview, setOverview] = useState(null);
  const [top, setTop] = useState(null);
  const [stores, setStores] = useState([]);
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [messages, setMessages] = useState([]);
  const [sending, setSending] = useState(false);
  const [highlightKey, setHighlightKey] = useState(null);
  const [highlightProduct, setHighlightProduct] = useState(null);
  const historyRef = useRef([]);

  useEffect(() => {
    api.meta().then((m) => {
      setMeta(m);
      setRange({ from: m.minDate, to: m.maxDate });
      setCustom({ from: m.minDate, to: m.maxDate });
    }).catch((e) => setError(e.message));
  }, []);

  useEffect(() => {
    if (!range) return undefined;
    setLoading(true);
    const params = { from: range.from, to: range.to, ...(storeId ? { storeId } : {}) };
    Promise.all([
      api.overview(params),
      api.topProducts({ ...params, limit: 10 }),
      api.stores({ from: range.from, to: range.to }),
      api.categories({ from: range.from, to: range.to }),
    ]).then(([ov, tp, st, ca]) => {
      setOverview(ov);
      setTop(tp);
      setStores(st.items);
      setCategories(ca.items);
      setError('');
    }).catch((e) => setError(e.message)).finally(() => setLoading(false));
  }, [range, storeId]);

  // AI 联动：高亮并滚动到对应视图
  useEffect(() => {
    if (!highlightKey) return undefined;
    const t = setTimeout(() => {
      if (highlightKey === 'top' || highlightKey === 'stores' || highlightKey === 'categories') {
        document.getElementById(highlightKey === 'top' ? 'top-products' : 'compare')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
      setHighlightKey(null);
    }, 350);
    return () => clearTimeout(t);
  }, [highlightKey]);

  useEffect(() => {
    if (!highlightProduct) return undefined;
    const t = setTimeout(() => setHighlightProduct(null), 3000);
    return () => clearTimeout(t);
  }, [highlightProduct]);

  const applyChartState = (chartState) => {
    if (!chartState) return;
    if (chartState.from && chartState.to) setRange({ from: chartState.from, to: chartState.to });
    setStoreId(chartState.storeId || '');
    setHighlightKey(chartState.view || 'trend');
    if (chartState.productId) setHighlightProduct(chartState.productId);
  };

  const onSend = async (message) => {
    const userMsg = { role: 'user', content: message };
    setMessages((prev) => [...prev, userMsg]);
    setSending(true);
    try {
      const res = await api.chat({ message, history: historyRef.current.slice(-8) });
      const assistantMsg = {
        role: 'assistant',
        content: res.answer,
        intent: res.intent,
        chartState: res.chartState,
        source: res.source,
      };
      setMessages((prev) => [...prev, assistantMsg]);
      historyRef.current = [...historyRef.current, { ...userMsg, intent: null }, { ...assistantMsg, content: res.answer }];
      applyChartState(res.chartState);
    } catch (e) {
      setMessages((prev) => [...prev, { role: 'assistant', content: `出错了：${e.message}` }]);
    } finally {
      setSending(false);
    }
  };

  const presets = meta ? [
    { label: '全部', range: { from: meta.minDate, to: meta.maxDate } },
    ...(meta.minDate && meta.maxDate
      ? [monthRange(meta.minDate.slice(0, 7)), monthRange(meta.maxDate.slice(0, 7))].map((r, i) => ({
        label: `${Number(meta.minDate.slice(5, 7)) + i} 月`,
        range: r,
      }))
      : []),
  ] : [];

  const applyCustom = () => {
    if (custom.from && custom.to && custom.from <= custom.to) {
      setRange({ from: custom.from, to: custom.to });
    }
  };

  const toggleStore = (id) => setStoreId((cur) => (cur === id ? '' : id));

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="logo">食</span>
          <div>
            <h1>食数 · Moneki 经营看板</h1>
            <p>连锁餐饮 · 5 家门店 · 数据区间 {meta ? `${meta.minDate} ~ ${meta.maxDate}` : '加载中…'}</p>
          </div>
        </div>
        <div className="controls">
          <div className="presets">
            {presets.map((p) => (
              <button
                key={p.label}
                className={range && range.from === p.range.from && range.to === p.range.to ? 'active' : ''}
                onClick={() => setRange(p.range)}
              >
                {p.label}
              </button>
            ))}
          </div>
          <div className="daterange">
            <input type="date" value={custom.from} onChange={(e) => setCustom({ ...custom, from: e.target.value })} />
            <span>~</span>
            <input type="date" value={custom.to} onChange={(e) => setCustom({ ...custom, to: e.target.value })} />
            <button className="ghost" onClick={applyCustom}>应用</button>
          </div>
          <select value={storeId} onChange={(e) => setStoreId(e.target.value)}>
            <option value="">全部门店</option>
            {(meta?.stores || []).map((s) => (
              <option key={s.store_id} value={s.store_id}>{s.store_name}（{s.category}）</option>
            ))}
          </select>
        </div>
      </header>

      {error && <div className="error-banner">{error} <button onClick={() => window.location.reload()}>重试</button></div>}

      <main>
        {loading && !overview && <div className="loading">数据加载中…</div>}
        <KpiCards overview={overview} />
        <div className="grid">
          <div className="left">
            <TrendChart perDay={overview?.perDay} highlightKey={highlightKey} />
            <TopProducts items={top?.items} highlightProductId={highlightProduct} highlightKey={highlightKey} />
          </div>
          <ChatPanel messages={messages} sending={sending} onSend={onSend} />
        </div>
        <ComparePanel
          stores={stores}
          categories={categories}
          activeStoreId={storeId}
          onStoreClick={toggleStore}
          highlightKey={highlightKey}
        />
      </main>

      <footer>
        看板与 AI 回答的数字均来自 SQLite 真实查询（清洗口径见 <code>data/cleaned/quality_report.md</code>）· 演示数据 2026-05 ~ 2026-07
      </footer>
    </div>
  );
}
