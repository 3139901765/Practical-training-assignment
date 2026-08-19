/**
 * 共享查询层：所有经营数字的唯一出处。
 * API 路由与 AI 工具都调用这里，保证「看板数字 = AI 回答数字」。
 */

const DAY = 24 * 60 * 60 * 1000;

export function parseDateRange(from, to) {
  const re = /^\d{4}-\d{2}-\d{2}$/;
  if (!re.test(from) || !re.test(to)) {
    const err = new Error('日期格式必须是 YYYY-MM-DD');
    err.status = 400;
    throw err;
  }
  const f = new Date(`${from}T00:00:00Z`);
  const t = new Date(`${to}T00:00:00Z`);
  if (Number.isNaN(f.getTime()) || Number.isNaN(t.getTime()) || f > t) {
    const err = new Error('日期区间无效：from 必须在 to 之前或相等');
    err.status = 400;
    throw err;
  }
  return { from, to };
}

function monthPrevWindow(from, to) {
  const lastDay = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();
  const pad = (n) => String(n).padStart(2, '0');
  const [fy, fm] = from.split('-').map(Number);
  const [ty, tm] = to.split('-').map(Number);
  const isFullMonth = fy === ty && from === `${fy}-${pad(fm)}-01` && to === `${fy}-${pad(fm)}-${pad(lastDay(fy, fm))}`;
  if (!isFullMonth) return null;
  const py = fm === 1 ? fy - 1 : fy;
  const pm = fm === 1 ? 12 : fm - 1;
  return { from: `${py}-${pad(pm)}-01`, to: `${py}-${pad(pm)}-${pad(lastDay(py, pm))}` };
}

function previousWindow(from, to) {
  const monthPrev = monthPrevWindow(from, to);
  if (monthPrev) return monthPrev;
  const len = (new Date(`${to}T00:00:00Z`) - new Date(`${from}T00:00:00Z`)) / DAY + 1;
  const pTo = new Date(new Date(`${from}T00:00:00Z`) - DAY).toISOString().slice(0, 10);
  const pFrom = new Date(new Date(`${from}T00:00:00Z`) - DAY * len).toISOString().slice(0, 10);
  return { from: pFrom, to: pTo, len };
}

function pct(cur, prev) {
  if (prev === 0 || prev == null) return null;
  return Number(((cur - prev) / prev * 100).toFixed(2));
}

export function createQueries(db) {
  const q = {
    meta() {
      const range = db.prepare('SELECT MIN(date) AS minDate, MAX(date) AS maxDate FROM sales').get();
      const stores = db.prepare(
        'SELECT store_id, store_name, category, district FROM stores ORDER BY store_id'
      ).all();
      const productCategories = db.prepare(
        'SELECT DISTINCT product_category FROM products ORDER BY product_category'
      ).all().map((r) => r.product_category);
      const products = db.prepare(
        'SELECT product_id, product_name, product_category, unit_price FROM products ORDER BY product_id'
      ).all();
      return { ...range, stores, productCategories, products };
    },

    overview({ from, to, storeId = null }) {
      const { from: f, to: t } = parseDateRange(from, to);
      const where = 'date BETWEEN ? AND ?' + (storeId ? ' AND store_id = ?' : '');
      const params = storeId ? [f, t, storeId] : [f, t];
      const days = db.prepare(
        `SELECT date, ROUND(SUM(amount), 2) AS revenue, COUNT(*) AS orders
         FROM sales WHERE ${where} GROUP BY date ORDER BY date`
      ).all(...params);
      const totalRevenue = days.reduce((s, d) => s + Number(d.revenue), 0);
      const totalOrders = days.reduce((s, d) => s + Number(d.orders), 0);
      const aov = totalOrders ? Number((totalRevenue / totalOrders).toFixed(2)) : 0;
      const perDay = days.map((d) => ({
        date: d.date,
        revenue: Number(d.revenue),
        orders: Number(d.orders),
        aov: d.orders ? Number((d.revenue / d.orders).toFixed(2)) : 0,
      }));

      // 环比：与前一等长区间比较
      const prev = previousWindow(f, t);
      const prevDays = db.prepare(
        `SELECT ROUND(SUM(amount), 2) AS revenue, COUNT(*) AS orders
         FROM sales WHERE ${where}`
      ).get(...(storeId ? [prev.from, prev.to, storeId] : [prev.from, prev.to]));
      const pRevenue = Number(prevDays.revenue ?? 0);
      const pOrders = Number(prevDays.orders ?? 0);
      const pAov = pOrders ? pRevenue / pOrders : 0;

      return {
        from: f, to: t, storeId,
        totalRevenue: Number(totalRevenue.toFixed(2)),
        totalOrders,
        aov,
        perDay,
        days: perDay.length,
        delta: {
          revenue: Number((totalRevenue - pRevenue).toFixed(2)),
          revenuePct: pct(totalRevenue, pRevenue),
          orders: totalOrders - pOrders,
          ordersPct: pct(totalOrders, pOrders),
          aov: Number((aov - pAov).toFixed(2)),
          aovPct: pct(aov, pAov),
        },
      };
    },

    topProducts({ from, to, storeId = null, limit = 10 }) {
      const { from: f, to: t } = parseDateRange(from, to);
      const where = 's.date BETWEEN ? AND ?' + (storeId ? ' AND s.store_id = ?' : '');
      const params = storeId ? [f, t, storeId] : [f, t];
      const rows = db.prepare(
        `SELECT p.product_id, p.product_name, p.product_category,
                ROUND(SUM(s.amount), 2) AS revenue, COUNT(*) AS orders, SUM(s.qty) AS qty
         FROM sales s JOIN products p ON p.product_id = s.product_id
         WHERE ${where}
         GROUP BY p.product_id, p.product_name, p.product_category
         ORDER BY revenue DESC LIMIT ?`
      ).all(...params, limit);
      const total = rows.reduce((s, r) => s + Number(r.revenue), 0);
      return {
        from: f, to: t, storeId, limit,
        totalRevenue: Number(total.toFixed(2)),
        items: rows.map((r) => ({
          ...r,
          revenue: Number(r.revenue),
          orders: Number(r.orders),
          qty: Number(r.qty),
          share: total ? Number((r.revenue / total * 100).toFixed(2)) : 0,
        })),
      };
    },

    storesRevenue({ from, to }) {
      const { from: f, to: t } = parseDateRange(from, to);
      const rows = db.prepare(
        `SELECT st.store_id, st.store_name, st.category, st.district,
                ROUND(SUM(s.amount), 2) AS revenue, COUNT(*) AS orders
         FROM sales s JOIN stores st ON st.store_id = s.store_id
         WHERE s.date BETWEEN ? AND ?
         GROUP BY st.store_id, st.store_name, st.category, st.district
         ORDER BY revenue DESC`
      ).all(f, t);
      const total = rows.reduce((s, r) => s + Number(r.revenue), 0);
      return {
        from: f, to: t, totalRevenue: Number(total.toFixed(2)),
        items: rows.map((r) => ({
          ...r,
          revenue: Number(r.revenue),
          orders: Number(r.orders),
          aov: r.orders ? Number((r.revenue / r.orders).toFixed(2)) : 0,
          share: total ? Number((r.revenue / total * 100).toFixed(2)) : 0,
        })),
      };
    },

    categoriesRevenue({ from, to }) {
      const { from: f, to: t } = parseDateRange(from, to);
      const rows = db.prepare(
        `SELECT p.product_category AS category,
                ROUND(SUM(s.amount), 2) AS revenue, COUNT(*) AS orders
         FROM sales s JOIN products p ON p.product_id = s.product_id
         WHERE s.date BETWEEN ? AND ?
         GROUP BY p.product_category ORDER BY revenue DESC`
      ).all(f, t);
      const total = rows.reduce((s, r) => s + Number(r.revenue), 0);
      return {
        from: f, to: t, totalRevenue: Number(total.toFixed(2)),
        items: rows.map((r) => ({
          ...r,
          revenue: Number(r.revenue),
          orders: Number(r.orders),
          share: total ? Number((r.revenue / total * 100).toFixed(2)) : 0,
        })),
      };
    },

    productSales({ productId, from, to }) {
      const { from: f, to: t } = parseDateRange(from, to);
      const row = db.prepare(
        `SELECT p.product_id, p.product_name, p.product_category,
                ROUND(SUM(s.amount), 2) AS revenue, COUNT(*) AS orders, SUM(s.qty) AS qty
         FROM sales s JOIN products p ON p.product_id = s.product_id
         WHERE s.product_id = ? AND s.date BETWEEN ? AND ?`
      ).get(productId, f, t);
      if (!row) {
        return { from: f, to: t, productId, found: false, revenue: 0, orders: 0, qty: 0 };
      }
      return { from: f, to: t, found: true, ...row, revenue: Number(row.revenue), orders: Number(row.orders), qty: Number(row.qty) };
    },

    storeSales({ storeId, from, to }) {
      const { from: f, to: t } = parseDateRange(from, to);
      const row = db.prepare(
        `SELECT st.store_id, st.store_name, st.category, st.district,
                ROUND(SUM(s.amount), 2) AS revenue, COUNT(*) AS orders
         FROM sales s JOIN stores st ON st.store_id = s.store_id
         WHERE s.store_id = ? AND s.date BETWEEN ? AND ?`
      ).get(storeId, f, t);
      if (!row) {
        return { from: f, to: t, storeId, found: false, revenue: 0, orders: 0, aov: 0 };
      }
      return { from: f, to: t, found: true, ...row, revenue: Number(row.revenue), orders: Number(row.orders), aov: Number((row.revenue / row.orders).toFixed(2)) };
    },

    aovTrend({ from, to }) {
      const cur = q.overview({ from, to });
      const prev = previousWindow(from, to);
      const prevRes = q.overview({ from: prev.from, to: prev.to });
      const direction = cur.aov > prevRes.aov ? 'up' : cur.aov < prevRes.aov ? 'down' : 'flat';
      return {
        current: { from: cur.from, to: cur.to, revenue: cur.totalRevenue, orders: cur.totalOrders, aov: cur.aov },
        previous: { from: prevRes.from, to: prevRes.to, revenue: prevRes.totalRevenue, orders: prevRes.totalOrders, aov: prevRes.aov },
        direction,
        pct: pct(cur.aov, prevRes.aov),
        series: cur.perDay.map((d) => ({ date: d.date, aov: d.aov, revenue: d.revenue, orders: d.orders })),
      };
    },
  };

  return q;
}
