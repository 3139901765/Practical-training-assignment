import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanData } from '../scripts/clean.js';

const { sales, stores, products, stats } = cleanData();

test('清洗统计与质量报告一致', () => {
  assert.equal(stats.input.sales, 12131);
  assert.equal(stats.dateNormalized, 150);
  assert.equal(stats.dateFailed, 0);
  assert.equal(stats.fkFixed, 13);
  assert.equal(stats.storeOrphanDropped, 7);
  assert.equal(stats.productOrphanDropped, 30);
  assert.equal(stats.qtyInvalidDropped, 25);
  assert.equal(stats.amountInvalidDropped, 119);
  assert.equal(stats.amountNegativeDropped, 49);
  assert.equal(stats.currencyFixed, 40);
  assert.equal(stats.dupDropped, 79);
  assert.equal(stats.output, 11822);
});

test('清洗后数据不变量', () => {
  const storeIds = new Set(stores.map((s) => s.store_id));
  const productIds = new Set(products.map((p) => p.product_id));
  for (const r of sales) {
    assert.match(r.date, /^\d{4}-\d{2}-\d{2}$/, `日期格式：${r.date}`);
    assert.ok(storeIds.has(r.store_id), `孤儿门店：${r.store_id}`);
    assert.ok(productIds.has(r.product_id), `孤儿商品：${r.product_id}`);
    assert.ok(Number(r.qty) > 0, `qty<=0：${r.qty}`);
    assert.ok(Number(r.amount) > 0, `amount<=0：${r.amount}`);
  }
  const orderIds = new Set(sales.map((r) => r.order_id));
  assert.equal(orderIds.size, sales.length, 'order_id 必须唯一');
});

test('验收基准数字（评审口径）', () => {
  const total = sales.reduce((s, r) => s + Number(r.amount), 0);
  assert.equal(Number(total.toFixed(2)), 425175.0);
  assert.equal(sales.length, 11822);
  assert.equal(Number((total / sales.length).toFixed(2)), 35.96);

  const byMonth = {};
  for (const r of sales) {
    const m = r.date.slice(0, 7);
    byMonth[m] = (byMonth[m] ?? 0) + Number(r.amount);
  }
  assert.equal(Number(byMonth['2026-05'].toFixed(2)), 140080.0);
  assert.equal(Number(byMonth['2026-06'].toFixed(2)), 132861.0);
  assert.equal(Number(byMonth['2026-07'].toFixed(2)), 152234.0);
});

test('金额 = 单价 × 数量（清洗后无不一致）', () => {
  const price = new Map(products.map((p) => [p.product_id, Number(p.unit_price)]));
  for (const r of sales) {
    const expected = price.get(r.product_id) * Number(r.qty);
    assert.ok(Math.abs(Number(r.amount) - expected) < 0.01, `金额不一致：${r.order_id}`);
  }
});

test('维度表 JOIN 零缺失', () => {
  const storeIds = new Set(stores.map((s) => s.store_id));
  const productIds = new Set(products.map((p) => p.product_id));
  assert.equal(stores.length, 5);
  assert.equal(products.length, 20);
  assert.equal([...sales].filter((r) => storeIds.has(r.store_id) && productIds.has(r.product_id)).length, sales.length);
});
