/**
 * 建库脚本：先跑清洗，再创建 SQLite 库并灌入清洗后数据。
 * 用法：npm run seed（默认写入 db/moneki.sqlite，可用 DB_PATH 覆盖）
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb } from '../server/db.js';
import { cleanData, writeCleaned } from './clean.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

export function seedDb(dbPath) {
  const result = cleanData();
  writeCleaned(result);

  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = openDb(dbPath);
  db.exec('DROP TABLE IF EXISTS sales');
  db.exec('DROP TABLE IF EXISTS stores');
  db.exec('DROP TABLE IF EXISTS products');
  db.exec(`
    CREATE TABLE stores (
      store_id   TEXT PRIMARY KEY,
      store_name TEXT NOT NULL,
      category   TEXT NOT NULL,
      district   TEXT NOT NULL
    );
    CREATE TABLE products (
      product_id       TEXT PRIMARY KEY,
      product_name     TEXT NOT NULL,
      product_category TEXT NOT NULL,
      unit_price       REAL NOT NULL
    );
    CREATE TABLE sales (
      order_id   TEXT PRIMARY KEY,
      date       TEXT NOT NULL,
      store_id   TEXT NOT NULL REFERENCES stores(store_id),
      product_id TEXT NOT NULL REFERENCES products(product_id),
      qty        INTEGER NOT NULL,
      amount     REAL NOT NULL,
      payment    TEXT NOT NULL
    );
    CREATE INDEX idx_sales_date ON sales(date);
    CREATE INDEX idx_sales_store ON sales(store_id);
    CREATE INDEX idx_sales_product ON sales(product_id);
  `);

  const insStore = db.prepare('INSERT INTO stores VALUES (?, ?, ?, ?)');
  for (const s of result.stores) insStore.run(s.store_id, s.store_name, s.category, s.district);

  const insProduct = db.prepare('INSERT INTO products VALUES (?, ?, ?, ?)');
  for (const p of result.products) {
    insProduct.run(p.product_id, p.product_name, p.product_category, Number(p.unit_price));
  }

  const insSale = db.prepare('INSERT INTO sales VALUES (?, ?, ?, ?, ?, ?, ?)');
  try {
    db.exec('BEGIN');
    for (const r of result.sales) {
      insSale.run(r.order_id, r.date, r.store_id, r.product_id, Number(r.qty), Number(r.amount), r.payment);
    }
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }

  const summary = db.prepare('SELECT COUNT(*) AS n, ROUND(SUM(amount), 2) AS revenue FROM sales').get();
  db.close();
  return { rows: Number(summary.n), revenue: Number(summary.revenue), dbPath };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const dbPath = process.env.DB_PATH || path.join(ROOT, 'db', 'moneki.sqlite');
  const { rows, revenue, dbPath: out } = seedDb(dbPath);
  console.log(`建库完成：${out}`);
  console.log(`sales ${rows} 行，总营业额 ¥${revenue.toFixed(2)}`);
}
