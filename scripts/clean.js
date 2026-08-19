/**
 * 数据清洗管线
 *
 * 输入：data/*.csv（原始 POS 导出，保持只读）
 * 输出：data/cleaned/*.csv + data/cleaned/quality_report.md
 *
 * 清洗规则（与 README「数据口径」一致）：
 *   1. 日期归一化：YYYY/MM/DD、DD-MM-YYYY -> YYYY-MM-DD
 *   2. 外键归一化：strip + 大写（S01 / s01 -> S01）
 *   3. 丢弃孤儿外键：S99、P99
 *   4. 丢弃无效数量（qty <= 0）与无效金额（空值/解析失败/<= 0）
 *   5. 订单去重：按 (order_id, product_id, qty, amount, payment)，
 *      优先保留「外键原本干净」且日期为 ISO 格式的行
 *   6. 金额口径：amount 为营收事实来源；与 unit_price*qty 的差异视为折扣，不修改
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const RAW_DIR = path.join(ROOT, 'data');
const OUT_DIR = path.join(ROOT, 'data', 'cleaned');

/* ------------------------------ 简易 CSV ------------------------------ */

function parseCSV(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += ch;
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      row.push(field); field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.some((f) => f.trim() !== '')) rows.push(row);
      row = [];
    } else field += ch;
  }
  if (field !== '' || row.length) { row.push(field); if (row.some((f) => f.trim() !== '')) rows.push(row); }
  const header = rows[0];
  return rows.slice(1).map((r) => {
    const obj = {};
    header.forEach((h, idx) => { obj[h] = r[idx] ?? ''; });
    return obj;
  });
}

function toCSV(rows, header) {
  const esc = (v) => {
    const s = String(v);
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [header.join(',')];
  for (const r of rows) lines.push(header.map((h) => esc(r[h] ?? '')).join(','));
  return lines.join('\n') + '\n';
}

/* ------------------------------ 日期/数值 ------------------------------ */

function normalizeDate(raw) {
  const s = raw.trim();
  let m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s); // ISO
  if (m) return { iso: s, wasIso: true };
  m = /^(\d{4})\/(\d{2})\/(\d{2})$/.exec(s); // YYYY/MM/DD
  if (m) return { iso: `${m[1]}-${m[2]}-${m[3]}`, wasIso: false };
  m = /^(\d{2})-(\d{2})-(\d{4})$/.exec(s); // DD-MM-YYYY
  if (m) return { iso: `${m[3]}-${m[2]}-${m[1]}`, wasIso: false };
  return { iso: null, wasIso: false };
}

function validISODate(iso) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return false;
  const [y, mo, d] = iso.split('-').map(Number);
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
}

function parseNumber(raw) {
  const s = String(raw ?? '').trim();
  if (s === '') return { value: null, empty: true };
  const cleaned = s.replace(/[¥￥]/g, '');
  const v = Number(cleaned);
  if (Number.isFinite(v)) return { value: v, empty: false, hadCurrency: cleaned !== s };
  return { value: null, empty: false, unparsable: true };
}

/* ------------------------------ 主管线 ------------------------------ */

export function cleanData() {
  const stats = {
    input: { sales: 0 },
    dateNormalized: 0,
    dateFailed: 0,
    fkFixed: 0,
    storeOrphanDropped: 0,
    productOrphanDropped: 0,
    qtyInvalidDropped: 0,
    amountInvalidDropped: 0,
    amountNegativeDropped: 0,
    currencyFixed: 0,
    dupDropped: 0,
    output: 0,
  };

  const storesRaw = parseCSV(fs.readFileSync(path.join(RAW_DIR, 'stores.csv'), 'utf8'));
  const productsRaw = parseCSV(fs.readFileSync(path.join(RAW_DIR, 'products.csv'), 'utf8'));
  const salesRaw = parseCSV(fs.readFileSync(path.join(RAW_DIR, 'sales.csv'), 'utf8'));
  stats.input.sales = salesRaw.length;

  const storeIds = new Set(storesRaw.map((r) => r.store_id.trim()));
  const productIds = new Set(productsRaw.map((r) => r.product_id.trim()));

  // 1. 日期归一化
  const withDate = salesRaw.map((r) => {
    const d = normalizeDate(r.date);
    if (!d.iso || !validISODate(d.iso)) { stats.dateFailed++; return { ...r, date: null, _wasIso: false }; }
    if (!d.wasIso) stats.dateNormalized++;
    return { ...r, date: d.iso, _wasIso: d.wasIso };
  }).filter((r) => r.date !== null);

  // 2. 外键归一化（strip + 大写），同时标记原本是否干净（用于去重优先级）
  const withFk = withDate.map((r) => {
    const storeRaw = r.store_id;
    const storeNorm = storeRaw.trim().toUpperCase();
    const productNorm = r.product_id.trim().toUpperCase();
    const storeDirty = storeRaw !== storeNorm;
    if (storeDirty) stats.fkFixed++;
    return {
      ...r,
      store_id: storeNorm,
      product_id: productNorm,
      _storeWasClean: !storeDirty,
    };
  });

  // 3. 丢弃孤儿外键
  const noOrphan = withFk.filter((r) => {
    if (!storeIds.has(r.store_id)) { stats.storeOrphanDropped++; return false; }
    if (!productIds.has(r.product_id)) { stats.productOrphanDropped++; return false; }
    return true;
  });

  // 4a. 无效数量
  const validQty = noOrphan.filter((r) => {
    const q = parseNumber(r.qty);
    if (q.empty || q.unparsable || q.value <= 0) { stats.qtyInvalidDropped++; return false; }
    r._qty = q.value;
    return true;
  });

  // 4b. 无效金额（先处理币符号，再判断空/解析失败/<=0）
  const validAmount = validQty.filter((r) => {
    const a = parseNumber(r.amount);
    if (a.hadCurrency) stats.currencyFixed++;
    if (a.empty || a.unparsable) { stats.amountInvalidDropped++; return false; }
    if (a.value <= 0) { stats.amountNegativeDropped++; return false; }
    r._amount = a.value;
    r.amount = a.value.toFixed(2);
    return true;
  });

  // 5. 订单去重：key = order_id|product_id|qty|amount|payment
  const key = (r) => [r.order_id, r.product_id, r.qty, r.amount, r.payment].join('|');
  const sorted = [...validAmount].sort((a, b) => {
    const k = key(a).localeCompare(key(b));
    if (k !== 0) return k;
    if (a._storeWasClean !== b._storeWasClean) return a._storeWasClean ? -1 : 1;
    if (a._wasIso !== b._wasIso) return a._wasIso ? -1 : 1;
    return 0;
  });
  const seen = new Set();
  const deduped = [];
  for (const r of sorted) {
    const k = key(r);
    if (seen.has(k)) { stats.dupDropped++; continue; }
    seen.add(k);
    deduped.push(r);
  }

  // 6. 输出行：去掉内部字段，保持原始列顺序
  const header = ['order_id', 'date', 'store_id', 'product_id', 'qty', 'amount', 'payment'];
  const salesOut = deduped.map((r) => {
    const o = {};
    for (const h of header) o[h] = r[h];
    o.qty = r._qty;
    return o;
  });
  stats.output = salesOut.length;

  const storesOut = storesRaw.map((r) => ({
    store_id: r.store_id.trim(), store_name: r.store_name.trim(),
    category: r.category.trim(), district: r.district.trim(),
  }));
  const productsOut = productsRaw.map((r) => ({
    product_id: r.product_id.trim(), product_name: r.product_name.trim(),
    product_category: r.product_category.trim(), unit_price: r.unit_price.trim(),
  }));

  // 金额与单价*qty 的差异统计（只报告，不修改）
  const priceByProduct = new Map(productsOut.map((p) => [p.product_id, Number(p.unit_price)]));
  let mismatch = 0;
  const mismatchRows = [];
  for (const r of salesOut) {
    const expected = priceByProduct.get(r.product_id) * Number(r.qty);
    if (Math.abs(Number(r.amount) - expected) >= 0.01) {
      mismatch++;
      mismatchRows.push(r.order_id);
    }
  }
  stats.amountPriceMismatch = mismatch;
  stats.mismatchRows = mismatchRows;

  return { sales: salesOut, stores: storesOut, products: productsOut, stats };
}

/* ------------------------------ 报告与写盘 ------------------------------ */

function formatMoney(v) {
  return v.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function buildReport(result) {
  const { stats } = result;
  const total = result.sales.reduce((s, r) => s + Number(r.amount), 0);
  const aov = total / stats.output;
  const months = {};
  for (const r of result.sales) {
    const m = r.date.slice(0, 7);
    months[m] ??= { revenue: 0, orders: 0 };
    months[m].revenue += Number(r.amount);
    months[m].orders++;
  }
  const lines = [];
  lines.push('# 数据质量报告（data/cleaned 生成依据）');
  lines.push('');
  lines.push('## 输入');
  lines.push('');
  lines.push(`- sales.csv：${stats.input.sales} 行`);
  lines.push('- stores.csv：5 行；products.csv：20 行');
  lines.push('');
  lines.push('## 清洗动作与剔除明细');
  lines.push('');
  lines.push('| 步骤 | 说明 | 行数 |');
  lines.push('|---|---|---|');
  lines.push(`| 日期归一化 | YYYY/MM/DD、DD-MM-YYYY → YYYY-MM-DD | ${stats.dateNormalized}（失败 ${stats.dateFailed}） |`);
  lines.push(`| 外键归一化 | strip + 大写（S01 / s01 → S01） | ${stats.fkFixed} |`);
  lines.push(`| 丢弃孤儿门店外键 | S99 不在门店维表 | ${stats.storeOrphanDropped} |`);
  lines.push(`| 丢弃孤儿商品外键 | P99 不在商品维表 | ${stats.productOrphanDropped} |`);
  lines.push(`| 丢弃无效数量 | qty ≤ 0 或无法解析 | ${stats.qtyInvalidDropped} |`);
  lines.push(`| 金额币符号修复 | ¥ 前缀去除后正常解析 | ${stats.currencyFixed} |`);
  lines.push(`| 丢弃无效金额 | 空值或无法解析 | ${stats.amountInvalidDropped} |`);
  lines.push(`| 丢弃非正金额 | amount ≤ 0（qty 为正，视为录入错误，非退款） | ${stats.amountNegativeDropped} |`);
  lines.push(`| 订单去重 | 同 (order_id, product_id, qty, amount, payment) 保留一行 | ${stats.dupDropped} |`);
  lines.push('');
  lines.push(`去重优先级：外键原本干净 > 日期为 ISO 格式。示例：ORD103779 同一订单同时出现 s01/S05，保留外键干净的 S05 行。`);
  lines.push('');
  lines.push('## 清洗后基准数字（验收口径）');
  lines.push('');
  lines.push(`- 最终行数 / 订单数：**${stats.output}**`);
  lines.push(`- 总营业额：**¥${formatMoney(total)}**`);
  lines.push(`- 客单价（营业额/订单数）：**¥${formatMoney(aov)}**`);
  lines.push('');
  lines.push('| 月份 | 营业额 | 订单数 | 客单价 |');
  lines.push('|---|---|---|---|');
  for (const m of Object.keys(months).sort()) {
    const mm = months[m];
    lines.push(`| ${m} | ¥${formatMoney(mm.revenue)} | ${mm.orders} | ¥${formatMoney(mm.revenue / mm.orders)} |`);
  }
  lines.push('');
  lines.push('## 金额口径说明');
  lines.push('');
  lines.push(`- amount 为营收唯一事实来源；与 unit_price×qty 不一致的行共 **${stats.amountPriceMismatch}** 条（占比 ${(stats.amountPriceMismatch / stats.output * 100).toFixed(2)}%），视为折扣/促销，不做修改。`);
  lines.push('');
  return lines.join('\n');
}

export function writeCleaned(result) {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const salesHeader = ['order_id', 'date', 'store_id', 'product_id', 'qty', 'amount', 'payment'];
  const storeHeader = ['store_id', 'store_name', 'category', 'district'];
  const productHeader = ['product_id', 'product_name', 'product_category', 'unit_price'];
  fs.writeFileSync(path.join(OUT_DIR, 'sales_clean.csv'), toCSV(result.sales, salesHeader), 'utf8');
  fs.writeFileSync(path.join(OUT_DIR, 'stores_clean.csv'), toCSV(result.stores, storeHeader), 'utf8');
  fs.writeFileSync(path.join(OUT_DIR, 'products_clean.csv'), toCSV(result.products, productHeader), 'utf8');
  fs.writeFileSync(path.join(OUT_DIR, 'quality_report.md'), buildReport(result), 'utf8');
}

/* CLI */
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = cleanData();
  writeCleaned(result);
  const { stats } = result;
  const total = result.sales.reduce((s, r) => s + Number(r.amount), 0);
  console.log(`输入 ${stats.input.sales} 行 → 输出 ${stats.output} 行`);
  console.log(`总营业额 ¥${total.toFixed(2)}，客单价 ¥${(total / stats.output).toFixed(2)}`);
  console.log(`剔除明细：孤儿门店 ${stats.storeOrphanDropped}，孤儿商品 ${stats.productOrphanDropped}，数量无效 ${stats.qtyInvalidDropped}，金额无效 ${stats.amountInvalidDropped}，金额≤0 ${stats.amountNegativeDropped}，重复 ${stats.dupDropped}，日期归一 ${stats.dateNormalized}，外键修复 ${stats.fkFixed}，币符号修复 ${stats.currencyFixed}`);
  console.log(`已写入 data/cleaned/（sales_clean.csv / stores_clean.csv / products_clean.csv / quality_report.md）`);
}
