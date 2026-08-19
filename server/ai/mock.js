/**
 * 内置 mock 意图解析器（确定性规则版 LLM）。
 * 与真实 LLM 走同一套工具 schema 与响应形状，保证「无 key 也能跑通全链路」。
 * 职责：自然语言 → { tool, args }，支持月份/门店/商品/「那五月呢？」追问继承。
 */

const CN_MONTHS = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10, 十一: 11, 十二: 12 };

function lastDayOfMonth(y, m) {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

function pad(n) { return String(n).padStart(2, '0'); }

function monthRange(y, m) {
  return { from: `${y}-${pad(m)}-01`, to: `${y}-${pad(m)}-${pad(lastDayOfMonth(y, m))}` };
}

function fullRange(meta) {
  return { from: meta.minDate, to: meta.maxDate };
}

/**
 * 从消息中解析日期区间。返回 { from, to } 或 null（未提及日期）。
 */
export function parsePeriod(message, meta) {
  const maxDate = meta.maxDate; // 2026-07-31
  const maxY = Number(maxDate.slice(0, 4));
  const maxM = Number(maxDate.slice(5, 7));
  const yearOf = (m) => (m > maxM ? maxY - 1 : maxY);

  // 最近 N 天 / 近 N 天
  let m = message.match(/最?近\s*(\d{1,3})\s*天/);
  if (m) {
    const days = Number(m[1]);
    const end = new Date(`${maxDate}T00:00:00Z`);
    const start = new Date(end - (days - 1) * 86400000);
    return { from: start.toISOString().slice(0, 10), to: maxDate };
  }

  // 具体日：5月1日 / 5月1号
  m = message.match(/(?:(\d{4})\s*年\s*)?(\d{1,2})\s*月\s*(\d{1,2})\s*[日号]/);
  if (m) {
    const y = m[1] ? Number(m[1]) : yearOf(Number(m[2]));
    const day = pad(Number(m[3]));
    return { from: `${y}-${pad(Number(m[2]))}-${day}`, to: `${y}-${pad(Number(m[2]))}-${day}` };
  }

  // 区间：5月到7月 / 5月至7月 / 2026年5月到2026年7月
  m = message.match(/(?:(\d{4})\s*年\s*)?(\d{1,2}|[一二三四五六七八九十]{1,2})\s*月\s*(?:到|至|～|-)\s*(?:(\d{4})\s*年\s*)?(\d{1,2}|[一二三四五六七八九十]{1,2})\s*月/);
  if (m) {
    const a = CN_MONTHS[m[2]] ?? Number(m[2]);
    const b = CN_MONTHS[m[4]] ?? Number(m[4]);
    const y = m[1] ? Number(m[1]) : yearOf(a);
    const r1 = monthRange(y, a);
    const r2 = monthRange(m[3] ? Number(m[3]) : y, b);
    return { from: r1.from, to: r2.to };
  }

  // 单独月份：五月 / 5月 / 2026年6月 / 2026-06 / 2026/06
  m = message.match(/(?:(\d{4})\s*[年/-]\s*)?(\d{1,2}|[一二三四五六七八九十]{1,2})\s*月/);
  if (m) {
    const mo = CN_MONTHS[m[2]] ?? Number(m[2]);
    const y = m[1] ? Number(m[1]) : yearOf(mo);
    return monthRange(y, mo);
  }

  // 本月 / 上月 / 上个月 / 这个月
  if (/上个月|上月/.test(message)) {
    const pm = maxM === 1 ? 12 : maxM - 1;
    const py = maxM === 1 ? maxY - 1 : maxY;
    return monthRange(py, pm);
  }
  if (/这个月|本月/.test(message)) return monthRange(maxY, maxM);

  return null;
}

const PRODUCT_ALIASES = {
  豚骨: 'P01', 味增拉面: 'P02', 照烧鸡: 'P03', 三文鱼: 'P04', 鸡肉: 'P05', 牛肉: 'P06',
  小笼包: 'P07', 灌汤包: 'P08', 煎饺: 'P09', 照烧三明治: 'P10', 吞拿鱼: 'P11',
  味增汤: 'P12', 炸鸡: 'P13', 毛豆: 'P14', 绿茶: 'P15', 可乐: 'P16', 柚子茶: 'P17',
  抹茶: 'P18', 啤酒: 'P19', 梅子酒: 'P20',
};
const AMBIGUOUS_PRODUCT = new Set(['拉面', 'poke', '三明治', '饭', '包', '饮品', '饮料']);

function resolveProduct(message, meta) {
  // 精确商品名优先
  const names = [...meta.products].sort((a, b) => b.product_name.length - a.product_name.length);
  for (const p of names) {
    if (message.includes(p.product_name)) return { id: p.product_id, name: p.product_name };
  }
  // 商品 ID（P01..P20）
  const idM = message.match(/\bP\d{2}\b/);
  if (idM) {
    const p = meta.products.find((x) => x.product_id === idM[0]);
    if (p) return { id: p.product_id, name: p.product_name };
  }
  // 别名
  for (const [alias, id] of Object.entries(PRODUCT_ALIASES)) {
    if (message.includes(alias)) {
      const p = meta.products.find((x) => x.product_id === id);
      return { id, name: p?.product_name ?? alias };
    }
  }
  // 模糊词：可能命中多个商品
  for (const amb of AMBIGUOUS_PRODUCT) {
    if (message.includes(amb)) {
      const candidates = meta.products.filter((p) => p.product_name.includes(amb));
      if (candidates.length === 1) return { id: candidates[0].product_id, name: candidates[0].product_name };
      if (candidates.length > 1) return { ambiguous: true, candidates: candidates.map((c) => c.product_name) };
    }
  }
  return null;
}

const STORE_BY_CATEGORY = { 拉面: 'S01', 轻食: 'S02', 点心: 'S03', 三明治: 'S04', 日料: 'S05' };
const STORE_BY_DISTRICT = { 徐汇: 'S01', 静安: 'S02', 浦东: 'S03', 长宁: 'S04', 黄浦: 'S05' };

function resolveStore(message, meta) {
  const lower = message.toLowerCase();
  for (const s of meta.stores) {
    if (lower.includes(s.store_name.toLowerCase())) return { id: s.store_id, name: s.store_name, category: s.category };
  }
  const idM = message.match(/\bS\d{2}\b/);
  if (idM) {
    const s = meta.stores.find((x) => x.store_id === idM[0]);
    if (s) return { id: s.store_id, name: s.store_name, category: s.category };
  }
  for (const [cat, id] of Object.entries(STORE_BY_CATEGORY)) {
    if (message.includes(cat)) {
      const s = meta.stores.find((x) => x.store_id === id);
      return { id, name: s?.store_name ?? cat, category: cat };
    }
  }
  for (const [dist, id] of Object.entries(STORE_BY_DISTRICT)) {
    if (message.includes(dist)) {
      const s = meta.stores.find((x) => x.store_id === id);
      return { id, name: s?.store_name ?? dist, category: s?.category };
    }
  }
  return null;
}

function lastIntent(history) {
  for (let i = history.length - 1; i >= 0; i--) {
    const it = history[i]?.intent;
    if (it && it.tool) return it;
  }
  return null;
}

/**
 * mock 意图解析。
 * @param {{message:string, history:Array, meta:object}} ctx
 * @returns {{tool:string, args:object}|null} null = 无法回答
 */
export function mockResolveIntent({ message, history = [], meta }) {
  const msg = message.trim();
  const hasMonth = /月|最近|近|天/.test(msg);
  const period = parsePeriod(msg, meta) ?? null;
  const product = resolveProduct(msg, meta);
  const store = resolveStore(msg, meta);
  const prev = lastIntent(history);

  const defaultRange = () => fullRange(meta);
  const range = () => period ?? defaultRange();
  const lastMonth = () => monthRange(Number(meta.maxDate.slice(0, 4)), Number(meta.maxDate.slice(5, 7)));

  const isFollowup = /^(那|那这|所以)?(?:[一二三四五六七八九十\d]{1,2})?\s*月(?:呢|怎么样|如何|情况)?[？?]?$/.test(msg) && !product && !store;

  // 追问：只带月份/「那五月呢」→ 继承上一轮工具与实体
  if (prev && (isFollowup || (!period && !product && !store && /呢|那|月/.test(msg)))) {
    const args = { ...prev.args };
    if (period) { args.from = period.from; args.to = period.to; }
    return { tool: prev.tool, args };
  }

  // 门店维度（特定门店）
  if (store && /营业额|收入|卖了|销售|多少钱|表现|情况|卖得/.test(msg)) {
    return { tool: 'storeSales', args: { storeId: store.id, ...range() } };
  }

  // 商品维度
  if (product && !product.ambiguous && /营业额|收入|卖了|销售|多少钱|卖得|多少/.test(msg)) {
    return { tool: 'productSales', args: { productId: product.id, ...range() } };
  }
  if (product?.ambiguous) {
    return { tool: 'productAmbiguous', args: { candidates: product.candidates, ...range() } };
  }

  // 客单价趋势
  if (msg.includes('客单价') && /涨|跌|趋势|比较|对比|最近|比/.test(msg)) {
    return { tool: 'aovTrend', args: period ?? lastMonth() };
  }

  // 门店对比 / 哪个门店
  if ((msg.includes('门店') || msg.includes('各店') || msg.includes('店')) && /最高|排行|对比|比较|哪个|第一|谁/.test(msg)) {
    return { tool: 'revenueByStore', args: range() };
  }

  // 品类对比
  if ((msg.includes('品类') || msg.includes('类目')) && /最高|排行|哪个|第一|谁|最好/.test(msg)) {
    return { tool: 'revenueByCategory', args: range() };
  }

  // Top 商品
  if ((/top\s*10|前十|排行|最受欢迎|卖得最好|畅销/.test(msg)) && (msg.includes('商品') || msg.includes('产品') || msg.includes('卖'))) {
    return { tool: 'topProducts', args: { limit: 10, ...range() } };
  }

  // 「XX 卖了多少钱」但 XX 查无此物 → 明确说没有，而不是答成综合看板
  if (/卖了多少钱|卖了多少/.test(msg) && !product && !store) {
    const m = msg.match(/(.{1,12}?)(?:卖了多少钱|卖了多少)/);
    const entity = (m?.[1] || msg)
      .replace(/[一二三四五六七八九十\d]{1,2}\s*月/g, '')
      .replace(/最近\s*\d+\s*天/g, '')
      .replace(/[？?。!！\s]/g, '');
    if (entity) return { tool: 'notFound', args: { entity } };
  }

  // 综合看板 / 每日趋势
  if (/每日|每天|趋势|营业额|销售|收入|订单|客单价|卖了多少钱|总体|整体|看板/.test(msg)) {
    return { tool: 'overview', args: range() };
  }

  // 纯追问但无上下文
  if (hasMonth && /呢|那/.test(msg) && !prev) {
    return { tool: 'overview', args: range() };
  }

  return null;
}
