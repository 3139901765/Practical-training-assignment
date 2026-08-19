# 食数 · Moneki 经营看板（全栈作业）

连锁餐饮（5 家门店）经营看板 + **AI 真实取数问答**。数据来自 POS 生产导出（含重复、缺失、格式不一、脏外键），经清洗后入库，看板与 AI 回答的数字全部来自 SQLite 真实查询。

## 3 步跑起来

```bash
npm install     # 安装依赖（server + web）
npm run seed    # 数据清洗 + 建库（输出 data/cleaned/ 与 db/moneki.sqlite）
npm run dev     # 同时启动 API(3001) 与前端(5173)
```

打开 http://localhost:5173 即可。AI 问答默认使用内置 mock 意图解析（工具调用链路完整真实）；如需真实大模型，复制 `.env.example` 为 `.env` 并填入 `DEEPSEEK_API_KEY` 即可，无需改代码。

其他命令：`npm test`（23 个测试：清洗不变量 / API 口径 / AI 数字真值）、`npm run build && npm start`（生产模式，单端口 3001 托管前端）。

> 排障：若 `npm install` 因本机 npm 安全策略拦截了 esbuild 安装脚本，`npm run dev` 会提示找不到 Vite 配置，先执行 `node node_modules/esbuild/install.js` 再重试即可。

## 架构

```
┌─────────────────────────── 浏览器 ───────────────────────────┐
│  Vite + React + ECharts                                       │
│  KPI 卡 / 趋势图 / Top10 / 门店对比 / AI 对话框（图表联动）      │
└───────────────┬───────────────────────────────────────────────┘
                │ /api/*（Vite dev proxy → :3001）
┌───────────────▼───────────────────────────────────────────────┐
│  Express API（server/app.js）                                  │
│  /api/meta · overview · top-products · stores · categories     │
│  POST /api/chat  → AI 问答链路                                 │
│     ① 意图解析：DeepSeek 工具调用（有 key）/ mock 规则解析      │
│     ② 工具执行：server/ai/tools.js → queries.js（真实 SQL）     │
│     ③ 答案渲染：确定性模板（数字只来自工具结果，不经过模型改写）  │
│     ④ 数字校验器：答案关键数字 ⊆ 工具结果（verifyAnswer）        │
│     ⑤ 追问上下文：「那五月呢」继承上一轮商品/门店/区间            │
└───────────────┬───────────────────────────────────────────────┘
                │ node:sqlite（Node ≥22.5 内置，零原生依赖）
┌───────────────▼───────────────────────────────────────────────┐
│  SQLite（db/moneki.sqlite，seed 生成）                         │
│  sales(order_id PK, date, store_id→stores, product_id→products,│
│        qty, amount, payment) + 索引                            │
└───────────────────────────────────────────────────────────────┘
```

## 数据口径（清洗策略）

原始数据 `data/*.csv` 保持只读，`scripts/clean.js` 固定顺序清洗，结果与逐项剔除明细见 `data/cleaned/quality_report.md`：

| 动作 | 行数 |
|---|---|
| 日期归一化（`YYYY/MM/DD`、`DD-MM-YYYY` → ISO） | 150（失败 0） |
| 外键归一化（strip + 大写，`S01 `/`s01` → S01） | 13 |
| 丢弃孤儿外键（S99 / P99） | 7 / 30 |
| 丢弃无效数量（qty ≤ 0） | 25 |
| 金额币符号修复（`¥66.00` → 66.00） | 40 |
| 丢弃无效金额（空值/无法解析） | 119 |
| 丢弃非正金额（amount ≤ 0，非退款） | 49 |
| 订单去重（同 order_id+product+qty+amount+payment 保留一行） | 79 |

**验收基准**：清洗后 **11,822 行 / 总营业额 ¥425,175.00 / 客单价 ¥35.96**；月度：5月 ¥140,080（3,822 单，36.65）、6月 ¥132,861（3,777 单，35.18）、7月 ¥152,234（4,223 单，36.05）；6月牛肉poke ¥13,524；门店第一 Super Tetsudo（日料）¥88,718。

金额口径：`amount` 为营收唯一事实来源；清洗后金额与 `unit_price × qty` 完全一致（74 条原始不一致全部来自被剔除的负金额/无效数量行，已在报告中说明）。

## API

| 接口 | 说明 |
|---|---|
| `GET /api/meta` | 数据日期范围、门店、商品、品类 |
| `GET /api/overview?from&to&storeId` | 总营业额/订单/客单价 + 逐日序列 + 环比（整月区间自动对比上一自然月） |
| `GET /api/top-products?from&to&storeId&limit` | Top N 商品（含占比） |
| `GET /api/stores?from&to` | 各门店营业额/订单/客单价/占比 |
| `GET /api/categories?from&to` | 各商品品类营业额 |
| `POST /api/chat {message, history}` | AI 问答，返回 `{answer, intent, data, chartState, source}` |

非法日期返回 400；`/api/chat` 的 `source` 字段暴露所用工具、返回行数与执行耗时，前端展示为「数据来源」标签。

## AI 问答为什么可信

1. **数字不经过模型**：LLM（或 mock）只负责把自然语言解析成工具调用；服务端执行真实 SQL，答案由确定性模板渲染，模型无法改写数字。
2. **数字校验器**：渲染后校验「答案中的关键数字 ⊆ 工具结果」，测试里对每个用例做同样的断言。
3. **兜底而非编造**：范围外问题（如天气）、查无此物（如「奶茶」）、多商品歧义（如「poke」）都有固定话术；「那五月呢」通过对话历史继承上一轮实体。
4. **口径唯一**：API 与 AI 工具共用 `server/queries.js`，评审可拿第一关接口数字逐一对照。

## 测试

```bash
npm test
```

- `tests/data.test.js`：清洗统计、不变量、验收基准、JOIN 零缺失
- `tests/api.test.js`：API 返回值与直连 SQL 逐日一致、400 校验
- `tests/ai.test.js`：README 三个示例问题 + 追问 + 模糊/兜底用例，断言 AI 回答数字 = 数据库查询数字

## 目录结构

```
scripts/    clean.js（清洗管线）· seed.js（建库）
server/     Express API · queries.js（唯一查询层）· ai/（工具注册表/意图解析/模板/校验器）
web/        Vite + React + ECharts 前端
tests/      node:test 三组测试
data/       raw（只读）· cleaned（清洗产物 + 质量报告）
docs/       AI_USAGE.md · DEMO.md · screenshots/
```

## 选型理由

- **Node.js 全栈**：单语言降低评审门槛；`node:sqlite` 自 Node 22.5 内置，SQLite 是真数据库且零原生编译依赖（Windows 上尤其省事）。
- **SQLite**：数据量小、单文件、可复现；「真实查询结果」一目了然。
- **确定性答案模板 + 数字校验器**：作业硬性要求「AI 数字 = 数据库数字」，与其让模型复述数字再人工核对，不如从架构上让数字不经过模型。
- **配置驱动 LLM（DeepSeek/mock）**：无 key 也能跑通完整工具链路，有 key 一行配置升级真实模型。
- **手写 CSS + ECharts**：不套后台模板，按「运营每天打开」的目标做信息层级；ECharts 负责图表，交互与视觉自绘。
