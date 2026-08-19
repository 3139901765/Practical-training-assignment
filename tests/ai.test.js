import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../server/db.js';
import { createQueries } from '../server/queries.js';
import { createChatHandler } from '../server/ai/chain.js';
import { keyFigures, verifyAnswer } from '../server/ai/tools.js';
import { cleanData } from '../scripts/clean.js';
import { seedFromResult } from '../scripts/seed.js';

let db;
let queries;
let chat;

before(() => {
  db = openDb(':memory:');
  seedFromResult(db, cleanData());
  queries = createQueries(db);
  chat = createChatHandler(queries, { llmMode: 'mock' });
});

after(() => db.close());

function money(v) {
  return v.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function num(v) {
  return Number(v).toLocaleString('zh-CN', { maximumFractionDigits: 0 });
}

async function ask(message, history = []) {
  return chat({ message, history });
}

function assertTruthful(res) {
  assert.ok(res.data, '必须有工具数据');
  // 真值测试：答案里必须出现工具结果的关键数字（格式化后）
  verifyAnswer(res.answer, keyFigures(res.intent.tool, res.data));
  assert.ok(res.source.rows >= 1);
  assert.ok(typeof res.source.execMs === 'number');
  return res;
}

test('README 示例 1：哪个品类的门店营业额最高 → JOIN 门店表', async () => {
  const res = await ask('哪个品类的门店营业额最高？');
  assert.equal(res.intent.tool, 'revenueByStore');
  assert.equal(res.data.items[0].store_name, 'Super Tetsudo');
  assert.ok(res.answer.includes('Super Tetsudo'));
  assert.ok(res.answer.includes(money(88718)));
  assert.equal(res.chartState.view, 'stores');
  assertTruthful(res);
});

test('README 示例 2：牛肉poke 六月卖了多少钱 → JOIN 商品表', async () => {
  const res = await ask('牛肉poke 六月卖了多少钱？');
  assert.equal(res.intent.tool, 'productSales');
  assert.equal(res.data.revenue, 13524);
  assert.equal(res.data.orders, 182);
  assert.ok(res.answer.includes('¥13,524.00'));
  assert.equal(res.chartState.from, '2026-06-01');
  assert.equal(res.chartState.productId, 'P06');
  assertTruthful(res);
  // 与数据库直接查询一致
  const direct = queries.productSales({ productId: 'P06', from: '2026-06-01', to: '2026-06-30' });
  assert.equal(res.data.revenue, direct.revenue);
});

test('README 示例 3：客单价最近是涨了还是跌了', async () => {
  const res = await ask('客单价最近是涨了还是跌了？');
  assert.equal(res.intent.tool, 'aovTrend');
  assert.equal(res.data.direction, 'up');
  assert.equal(res.data.current.aov, 36.05);
  assert.equal(res.data.previous.aov, 35.18);
  assert.ok(res.answer.includes('涨了'));
  assert.ok(res.answer.includes('35.18'));
  assert.ok(res.answer.includes('36.05'));
  assertTruthful(res);
});

test('追问：那五月呢 → 继承商品维度并替换月份', async () => {
  const first = await ask('牛肉poke 六月卖了多少钱？');
  const history = [{ role: 'user', content: '牛肉poke 六月卖了多少钱？', intent: first.intent }];
  const res = await ask('那五月呢？', history);
  assert.equal(res.intent.tool, 'productSales');
  assert.equal(res.intent.args.productId, 'P06');
  assert.equal(res.intent.args.from, '2026-05-01');
  assert.equal(res.data.revenue, 13104);
  assert.ok(res.answer.includes('¥13,104.00'));
  assertTruthful(res);
});

test('模糊商品名：poke 命中多款商品 → 合理兜底', async () => {
  const res = await ask('poke 六月卖了多少钱？');
  assert.ok(res.answer.includes('多个商品'));
  assert.ok(res.answer.includes('牛肉poke'));
  assert.equal(res.data, null);
});

test('查无此商品 → 不编造，明确说没有', async () => {
  const res = await ask('奶茶 六月卖了多少钱？');
  assert.ok(res.answer.includes('答不了') || res.answer.includes('没有'));
});

test('范围外问题（天气）→ 兜底话术', async () => {
  const res = await ask('今天天气怎么样？');
  assert.equal(res.intent, null);
  assert.ok(res.answer.includes('答不了'));
  assert.equal(res.data, null);
});

test('Top 10 商品排行 → 数字来自工具结果', async () => {
  const res = await ask('Top 10 商品排行？');
  assert.equal(res.intent.tool, 'topProducts');
  assert.equal(res.data.items[0].product_name, '牛肉poke');
  assert.ok(res.answer.includes(money(39984)));
  assert.ok(res.answer.includes('牛肉poke'));
  assertTruthful(res);
});

test('指定门店销售额 → storeSales 真实 SQL', async () => {
  const res = await ask('Super Tetsudo 六月营业额多少？');
  assert.equal(res.intent.tool, 'storeSales');
  assert.equal(res.intent.args.storeId, 'S05');
  const direct = queries.storeSales({ storeId: 'S05', from: '2026-06-01', to: '2026-06-30' });
  assert.equal(res.data.revenue, direct.revenue);
  assert.ok(res.answer.includes(money(direct.revenue)));
  assert.equal(res.chartState.storeId, 'S05');
  assertTruthful(res);
});

test('品类排行 → revenueByCategory', async () => {
  const res = await ask('哪个品类卖得最好？');
  assert.equal(res.intent.tool, 'revenueByCategory');
  assert.equal(res.data.items[0].category, '主食');
  assert.ok(res.answer.includes('主食'));
  assertTruthful(res);
});

test('每日趋势 → overview 含逐日数据', async () => {
  const res = await ask('六月每天营业额趋势？');
  assert.equal(res.intent.tool, 'overview');
  assert.equal(res.data.totalRevenue, 132861);
  assert.equal(res.data.perDay.length, 30);
  assert.equal(res.chartState.view, 'trend');
  assertTruthful(res);
});
