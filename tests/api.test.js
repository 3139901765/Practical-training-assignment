import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../server/db.js';
import { createQueries } from '../server/queries.js';
import { createApp } from '../server/app.js';
import { cleanData } from '../scripts/clean.js';
import { seedFromResult } from '../scripts/seed.js';

let db;
let queries;
let server;
let baseURL;

before(() => {
  db = openDb(':memory:');
  seedFromResult(db, cleanData());
  queries = createQueries(db);
  const app = createApp(queries);
  server = app.listen(0);
  baseURL = `http://127.0.0.1:${server.address().port}`;
});

after(() => {
  server.close();
  db.close();
});

async function getJSON(path) {
  const res = await fetch(`${baseURL}${path}`);
  return { status: res.status, body: await res.json() };
}

test('meta：日期范围与维度表', async () => {
  const { status, body } = await getJSON('/api/meta');
  assert.equal(status, 200);
  assert.equal(body.minDate, '2026-05-01');
  assert.equal(body.maxDate, '2026-07-31');
  assert.equal(body.stores.length, 5);
  assert.equal(body.products.length, 20);
});

test('overview 全量：总营业额/订单/客单价', async () => {
  const { status, body } = await getJSON('/api/overview?from=2026-05-01&to=2026-07-31');
  assert.equal(status, 200);
  assert.equal(body.totalRevenue, 425175);
  assert.equal(body.totalOrders, 11822);
  assert.equal(body.aov, 35.96);
  assert.equal(body.days, 92);
  assert.equal(body.perDay.length, 92);
});

test('overview 与直连 SQL 逐日一致', async () => {
  const { body } = await getJSON('/api/overview?from=2026-06-01&to=2026-06-30');
  const direct = db.prepare(
    'SELECT date, ROUND(SUM(amount), 2) AS revenue, COUNT(*) AS orders FROM sales WHERE date BETWEEN ? AND ? GROUP BY date ORDER BY date'
  ).all('2026-06-01', '2026-06-30');
  assert.equal(body.perDay.length, direct.length);
  for (let i = 0; i < direct.length; i++) {
    assert.equal(body.perDay[i].date, direct[i].date);
    assert.equal(body.perDay[i].revenue, Number(direct[i].revenue));
    assert.equal(body.perDay[i].orders, Number(direct[i].orders));
  }
  assert.equal(body.totalRevenue, 132861);
  assert.equal(body.totalOrders, 3777);
  assert.equal(body.aov, 35.18);
  assert.equal(body.delta.revenuePct, -5.15);
});

test('top-products 排序与占比', async () => {
  const { status, body } = await getJSON('/api/top-products?from=2026-05-01&to=2026-07-31&limit=3');
  assert.equal(status, 200);
  assert.equal(body.items.length, 3);
  assert.equal(body.items[0].product_name, '牛肉poke');
  assert.equal(body.items[0].revenue, 39984);
  assert.ok(body.items[0].share > body.items[1].share);
  const direct = db.prepare(
    `SELECT p.product_name, ROUND(SUM(s.amount), 2) AS revenue
     FROM sales s JOIN products p ON p.product_id = s.product_id
     WHERE s.date BETWEEN ? AND ? GROUP BY p.product_id, p.product_name ORDER BY revenue DESC LIMIT 3`
  ).all('2026-05-01', '2026-07-31');
  assert.equal(body.items[0].revenue, Number(direct[0].revenue));
});

test('stores：门店营业额排行', async () => {
  const { status, body } = await getJSON('/api/stores?from=2026-05-01&to=2026-07-31');
  assert.equal(status, 200);
  assert.equal(body.items.length, 5);
  assert.equal(body.items[0].store_name, 'Super Tetsudo');
  assert.equal(body.items[0].revenue, 88718);
  const totalShare = body.items.reduce((s, it) => s + it.share, 0);
  assert.ok(Math.abs(totalShare - 100) < 0.5);
});

test('categories：品类营业额排行', async () => {
  const { body } = await getJSON('/api/categories?from=2026-05-01&to=2026-07-31');
  assert.equal(body.items[0].category, '主食');
  assert.equal(body.items[0].revenue, 245298);
});

test('非法日期返回 400', async () => {
  const { status, body } = await getJSON('/api/overview?from=bad&to=2026-07-31');
  assert.equal(status, 400);
  assert.ok(body.error);
  const r2 = await getJSON('/api/overview?from=2026-07-31&to=2026-05-01');
  assert.equal(r2.status, 400);
});
