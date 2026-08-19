import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb } from './db.js';
import { createQueries } from './queries.js';
import { createApp } from './app.js';
import { seedDb } from '../scripts/seed.js';
import { createChatHandler } from './ai/chain.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

// 加载 .env（不存在则跳过）
const envPath = path.join(ROOT, '.env');
if (fs.existsSync(envPath)) process.loadEnvFile(envPath);

const DB_PATH = process.env.DB_PATH || path.join(ROOT, 'db', 'moneki.sqlite');
if (!fs.existsSync(DB_PATH)) {
  console.log('数据库不存在，先执行 seed…');
  seedDb(DB_PATH);
}

const db = openDb(DB_PATH);
const queries = createQueries(db);
const chatHandler = createChatHandler(queries, {
  llmMode: process.env.LLM_MODE || 'auto',
  llmConfig: process.env.DEEPSEEK_API_KEY
    ? {
        apiKey: process.env.DEEPSEEK_API_KEY,
        baseUrl: process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com',
        model: process.env.DEEPSEEK_MODEL || 'deepseek-chat',
      }
    : null,
});
const app = createApp(queries, chatHandler);

const PORT = Number(process.env.PORT || 3001);
app.listen(PORT, () => {
  console.log(`API 已启动：http://localhost:${PORT}`);
});
