import { money, num } from '../format.js';

export default function TopProducts({ items = [], highlightProductId, highlightKey }) {
  const max = Math.max(...items.map((it) => it.revenue), 1);
  return (
    <section className={`card top-card ${highlightKey === 'top' ? 'flash' : ''}`} id="top-products">
      <div className="card-head">
        <h2>Top {items.length} 商品</h2>
        <span className="card-hint">按营业额排序 · 共 {items.reduce((s, it) => s + it.orders, 0).toLocaleString()} 单</span>
      </div>
      <table className="top-table">
        <thead>
          <tr>
            <th className="col-rank">#</th>
            <th>商品</th>
            <th>品类</th>
            <th className="col-num">营业额</th>
            <th className="col-num">订单数</th>
            <th className="col-share">占比</th>
          </tr>
        </thead>
        <tbody>
          {items.map((it, i) => (
            <tr key={it.product_id} className={highlightProductId === it.product_id ? 'highlight-row' : ''}>
              <td className="col-rank rank">{i + 1}</td>
              <td className="name">{it.product_name}</td>
              <td className="muted">{it.product_category}</td>
              <td className="col-num strong">¥{money(it.revenue)}</td>
              <td className="col-num">{num(it.orders)}</td>
              <td className="col-share">
                <div className="share-bar">
                  <div className="share-fill" style={{ width: `${(it.revenue / max) * 100}%` }} />
                  <span>{it.share}%</span>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
