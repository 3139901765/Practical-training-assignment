import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.resolve(__dirname, '..', 'web', 'dist');

function defaultRange(q) {
  const m = q.meta();
  return { from: m.minDate, to: m.maxDate };
}

function pick(obj, keys) {
  const out = {};
  for (const k of keys) if (obj[k] !== undefined) out[k] = obj[k];
  return out;
}

export function createApp(queries, chatHandler = null) {
  const app = express();
  app.use(express.json());

  app.get('/api/health', (req, res) => res.json({ ok: true }));

  app.get('/api/meta', (req, res) => res.json(queries.meta()));

  app.get('/api/overview', (req, res, next) => {
    try {
      const d = defaultRange(queries);
      const from = req.query.from || d.from;
      const to = req.query.to || d.to;
      const storeId = req.query.storeId || null;
      res.json(queries.overview({ from, to, storeId }));
    } catch (e) { next(e); }
  });

  app.get('/api/top-products', (req, res, next) => {
    try {
      const d = defaultRange(queries);
      const from = req.query.from || d.from;
      const to = req.query.to || d.to;
      const storeId = req.query.storeId || null;
      const limit = Math.min(Math.max(parseInt(req.query.limit || '10', 10) || 10, 1), 50);
      res.json(queries.topProducts({ from, to, storeId, limit }));
    } catch (e) { next(e); }
  });

  app.get('/api/stores', (req, res, next) => {
    try {
      const d = defaultRange(queries);
      res.json(queries.storesRevenue({ from: req.query.from || d.from, to: req.query.to || d.to }));
    } catch (e) { next(e); }
  });

  app.get('/api/categories', (req, res, next) => {
    try {
      const d = defaultRange(queries);
      res.json(queries.categoriesRevenue({ from: req.query.from || d.from, to: req.query.to || d.to }));
    } catch (e) { next(e); }
  });

  app.post('/api/chat', (req, res, next) => {
    try {
      const { message, history } = req.body || {};
      if (!message || typeof message !== 'string' || !message.trim()) {
        return res.status(400).json({ error: 'message 不能为空' });
      }
      if (!chatHandler) return res.status(503).json({ error: 'AI 问答未启用' });
      Promise.resolve(chatHandler({ message, history: Array.isArray(history) ? history : [] }))
        .then((result) => res.json(result))
        .catch(next);
    } catch (e) { next(e); }
  });

  // 生产模式：托管前端构建产物
  if (fs.existsSync(DIST)) {
    app.use(express.static(DIST));
    app.get('*', (req, res) => res.sendFile(path.join(DIST, 'index.html')));
  }

  // 统一错误处理
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    const status = err.status || 500;
    if (status === 500) console.error(err);
    res.status(status).json({ error: err.message || '服务器内部错误' });
  });

  return app;
}
