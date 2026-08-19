/**
 * AI 工具注册表：工具 schema（给 LLM 用）、执行器（真实 SQL）、
 * 确定性答案模板、数字校验器与图表联动状态。
 *
 * 设计原则：数字只出现在工具结果里，答案由模板渲染，模型不参与改写数字，
 * 从根上杜绝「AI 编造数字」。
 */

const TOOL_DESCRIPTIONS = {
  overview: '查询某日期区间的总营业额、订单数、客单价及逐日趋势',
  topProducts: '查询某日期区间销售额 Top N 商品',
  revenueByStore: '查询某日期区间各门店营业额（含门店品类、商圈、占比）',
  revenueByCategory: '查询某日期区间各商品品类营业额（含占比）',
  productSales: '查询某款商品在日期区间的营业额、订单数、销量',
  storeSales: '查询某家门店在日期区间的营业额、订单数、客单价',
  aovTrend: '比较两个等长日期区间的客单价变化方向（涨/跌/持平）',
};

export const TOOL_NAMES = Object.keys(TOOL_DESCRIPTIONS);

export function toolSchemas() {
  const dateProps = {
    from: { type: 'string', description: '开始日期，格式 YYYY-MM-DD' },
    to: { type: 'string', description: '结束日期，格式 YYYY-MM-DD' },
  };
  return [
    { type: 'function', function: { name: 'overview', description: TOOL_DESCRIPTIONS.overview, parameters: { type: 'object', properties: dateProps, required: ['from', 'to'] } } },
    { type: 'function', function: { name: 'topProducts', description: TOOL_DESCRIPTIONS.topProducts, parameters: { type: 'object', properties: { ...dateProps, limit: { type: 'integer', description: '返回条数，默认 10' } }, required: ['from', 'to'] } } },
    { type: 'function', function: { name: 'revenueByStore', description: TOOL_DESCRIPTIONS.revenueByStore, parameters: { type: 'object', properties: dateProps, required: ['from', 'to'] } } },
    { type: 'function', function: { name: 'revenueByCategory', description: TOOL_DESCRIPTIONS.revenueByCategory, parameters: { type: 'object', properties: dateProps, required: ['from', 'to'] } } },
    { type: 'function', function: { name: 'productSales', description: TOOL_DESCRIPTIONS.productSales, parameters: { type: 'object', properties: { ...dateProps, productId: { type: 'string', description: '商品 ID，例如 P06（牛肉poke）' } }, required: ['productId', 'from', 'to'] } } },
    { type: 'function', function: { name: 'storeSales', description: TOOL_DESCRIPTIONS.storeSales, parameters: { type: 'object', properties: { ...dateProps, storeId: { type: 'string', description: '门店 ID，例如 S05（Super Tetsudo）' } }, required: ['storeId', 'from', 'to'] } } },
    { type: 'function', function: { name: 'aovTrend', description: TOOL_DESCRIPTIONS.aovTrend, parameters: { type: 'object', properties: dateProps, required: ['from', 'to'] } } },
  ];
}

export function systemPrompt(meta) {
  const stores = meta.stores.map((s) => `${s.store_name}(${s.store_id}, ${s.category}, ${s.district})`).join('；');
  const products = meta.products.map((p) => `${p.product_name}(${p.product_id})`).join('、');
  return `你是连锁餐饮公司的数据问答助手。你的唯一职责是基于数据库查询结果回答经营问题。

规则：
1. 必须通过工具调用获取数据，工具返回的数字是唯一事实来源。
2. 回答时只能使用工具返回的数字，禁止自己计算或凭记忆补充数字。
3. 如果问题无法用提供的工具回答（例如问天气、问无关话题、数据里没有的东西），不要编造，直接回复 FALLBACK。
4. 日期一律使用 YYYY-MM-DD；数据范围为 ${meta.minDate} 至 ${meta.maxDate}。

门店目录：${stores}
商品目录：${products}`;
}

export function executeTool(queries, tool, args) {
  switch (tool) {
    case 'overview': return queries.overview(args);
    case 'topProducts': return queries.topProducts(args);
    case 'revenueByStore': return queries.storesRevenue(args);
    case 'revenueByCategory': return queries.categoriesRevenue(args);
    case 'productSales': return queries.productSales(args);
    case 'storeSales': return queries.storeSales(args);
    case 'aovTrend': return queries.aovTrend(args);
    default: throw new Error(`未知工具：${tool}`);
  }
}

function money(v) {
  return v.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function num(v) {
  return Number(v).toLocaleString('zh-CN', { maximumFractionDigits: 0 });
}

function directionWord(toolResult, key) {
  const v = toolResult[key] ?? toolResult.pct;
  if (v == null) return '';
  return v > 0 ? '上涨' : v < 0 ? '下降' : '持平';
}

function itemLines(items, max = 5, formatter) {
  return items.slice(0, max).map((it, i) => formatter(it, i)).join('\n');
}

function chartStateFor(tool, args, result) {
  const base = { from: args.from, to: args.to };
  switch (tool) {
    case 'overview': return { ...base, view: 'trend', metric: 'revenue' };
    case 'topProducts': return { ...base, view: 'top' };
    case 'revenueByStore': return { ...base, view: 'stores' };
    case 'revenueByCategory': return { ...base, view: 'categories' };
    case 'productSales': return { ...base, view: 'trend', metric: 'revenue', productId: args.productId };
    case 'storeSales': return { ...base, view: 'stores', storeId: args.storeId };
    case 'aovTrend': return { ...base, view: 'trend', metric: 'aov' };
    default: return base;
  }
}

export function renderAnswer(tool, args, result) {
  let answer = '';
  switch (tool) {
    case 'overview': {
      const d = result.delta;
      const revWord = directionWord(d, 'revenuePct');
      const aovWord = directionWord(d, 'aovPct');
      answer = `${args.from} 至 ${args.to}：营业额 ¥${money(result.totalRevenue)}，订单 ${num(result.totalOrders)} 单，客单价 ¥${money(result.aov)}。` +
        `较上一区间（${d.revenuePct == null ? '无数据' : revWord + ' ' + Math.abs(d.revenuePct).toFixed(2) + '%'}），` +
        `客单价${d.aovPct == null ? '无同期数据可比' : `${aovWord} ${Math.abs(d.aovPct).toFixed(2)}%`}。`;
      break;
    }
    case 'topProducts': {
      const items = result.items;
      answer = `${args.from} 至 ${args.to} 销售额 Top ${items.length} 商品：\n` +
        itemLines(items, 5, (it, i) => `${i + 1}. ${it.product_name}（${it.product_category}）¥${money(it.revenue)}，${num(it.orders)} 单，占比 ${it.share}%`);
      if (items.length > 5) answer += `\n……完整 ${items.length} 名见数据表。`;
      break;
    }
    case 'revenueByStore': {
      const items = result.items;
      const top = items[0];
      answer = `${args.from} 至 ${args.to} 各门店营业额：\n` +
        itemLines(items, 5, (it, i) => `${i + 1}. ${it.store_name}（${it.category}，${it.district}）¥${money(it.revenue)}，${num(it.orders)} 单，占比 ${it.share}%`);
      if (top) answer += `\n营业额最高的是 ${top.store_name}（${top.category}），¥${money(top.revenue)}。`;
      break;
    }
    case 'revenueByCategory': {
      const items = result.items;
      const top = items[0];
      answer = `${args.from} 至 ${args.to} 各商品品类营业额：\n` +
        itemLines(items, 5, (it, i) => `${i + 1}. ${it.category} ¥${money(it.revenue)}，${num(it.orders)} 单，占比 ${it.share}%`);
      if (top) answer += `\n营业额最高的品类是 ${top.category}，¥${money(top.revenue)}。`;
      break;
    }
    case 'productSales': {
      answer = result.found
        ? `${result.product_name} 在 ${args.from} 至 ${args.to} 卖出 ¥${money(result.revenue)}（${num(result.orders)} 单，${num(result.qty)} 件）。`
        : `数据中没有找到商品「${args.productId}」在 ${args.from} 至 ${args.to} 的销售记录。`;
      break;
    }
    case 'storeSales': {
      answer = result.found
        ? `${result.store_name}（${result.category}，${result.district}）在 ${args.from} 至 ${args.to} 营业额 ¥${money(result.revenue)}，${num(result.orders)} 单，客单价 ¥${money(result.aov)}。`
        : `数据中没有找到门店「${args.storeId}」在 ${args.from} 至 ${args.to} 的销售记录。`;
      break;
    }
    case 'aovTrend': {
      const w = result.direction === 'up' ? '涨了' : result.direction === 'down' ? '跌了' : '持平';
      answer = `客单价对比：${result.previous.from} 至 ${result.previous.to} 为 ¥${money(result.previous.aov)}，` +
        `${result.current.from} 至 ${result.current.to} 为 ¥${money(result.current.aov)}，${w}` +
        `${result.pct == null ? '' : `（${result.pct > 0 ? '+' : ''}${result.pct.toFixed(2)}%）`}。`;
      break;
    }
    default:
      answer = '这个问题我答不了。我只能回答这份销售数据相关的问题，比如：某段时间的营业额/订单数/客单价、Top 商品、各门店或品类的表现、某款商品的销量，也支持「那六月呢？」这类追问。';
  }
  return { answer, chartState: chartStateFor(tool, args, result) };
}

export const FALLBACK_ANSWER = '这个问题我答不了。我只能回答这份销售数据相关的问题，比如：某段时间的营业额/订单数/客单价、Top 商品、各门店或品类的表现、某款商品的销量，也支持「那六月呢？」这类追问。';

/** 从工具结果提取关键数字（用于校验答案是否包含真实数字） */
export function keyFigures(tool, result) {
  const figs = [];
  const push = (v) => { const n = Number(v); if (Number.isFinite(n) && n !== 0) figs.push(n); };
  switch (tool) {
    case 'overview': push(result.totalRevenue); push(result.totalOrders); push(result.aov); push(result.delta.revenuePct); push(result.delta.aovPct); break;
    case 'topProducts': result.items.slice(0, 5).forEach((it) => { push(it.revenue); push(it.orders); }); break;
    case 'revenueByStore': result.items.slice(0, 5).forEach((it) => push(it.revenue)); break;
    case 'revenueByCategory': result.items.slice(0, 5).forEach((it) => push(it.revenue)); break;
    case 'productSales': push(result.revenue); push(result.orders); push(result.qty); break;
    case 'storeSales': push(result.revenue); push(result.orders); push(result.aov); break;
    case 'aovTrend': push(result.current.aov); push(result.previous.aov); push(result.pct); break;
    default: break;
  }
  return figs;
}

/** 数字校验器：答案必须包含工具结果里的关键数字（格式化后），否则抛错 */
export function verifyAnswer(answer, figures) {
  const missing = figures.filter((f) => {
    const variants = [
      f.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
      f.toLocaleString('zh-CN', { maximumFractionDigits: 2 }),
      String(f),
      // 模板对百分比用绝对值展示（涨跌方向由文字表达），因此绝对值也视为匹配
      Math.abs(f).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
      Math.abs(f).toLocaleString('zh-CN', { maximumFractionDigits: 2 }),
    ];
    return !variants.some((v) => answer.includes(v));
  });
  if (missing.length) {
    throw new Error(`答案数字校验失败，缺失：${missing.join(', ')}`);
  }
  return true;
}
