import {
  toolSchemas, systemPrompt, executeTool, renderAnswer,
  keyFigures, verifyAnswer, FALLBACK_ANSWER, TOOL_NAMES,
} from './tools.js';
import { mockResolveIntent } from './mock.js';
import { callToolLLM } from './llm.js';

function buildMessages(meta, history, message) {
  const msgs = [{ role: 'system', content: systemPrompt(meta) }];
  for (const h of history.slice(-8)) {
    if (h.role === 'user' || h.role === 'assistant') {
      msgs.push({ role: h.role, content: String(h.content || '') });
    }
  }
  msgs.push({ role: 'user', content: message });
  return msgs;
}

const SOURCE_DESCRIPTION = {
  overview: 'SELECT date, SUM(amount), COUNT(*) FROM sales GROUP BY date（JOIN 口径见 queries.js）',
  topProducts: 'SELECT 商品, SUM(amount) FROM sales JOIN products GROUP BY product_id ORDER BY revenue DESC LIMIT n',
  revenueByStore: 'SELECT 门店, SUM(amount) FROM sales JOIN stores GROUP BY store_id',
  revenueByCategory: 'SELECT 品类, SUM(amount) FROM sales JOIN products GROUP BY product_category',
  productSales: 'SELECT SUM(amount), COUNT(*), SUM(qty) FROM sales JOIN products WHERE product_id = ?',
  storeSales: 'SELECT SUM(amount), COUNT(*) FROM sales JOIN stores WHERE store_id = ?',
  aovTrend: 'SELECT 客单价 = SUM(amount)/COUNT(*) 按区间对比（queries.aovTrend）',
};

function validateArgs(tool, args) {
  if (tool === 'productSales' && !args.productId) return '你想问哪款商品？例如：牛肉poke 六月卖了多少钱。';
  if (tool === 'storeSales' && !args.storeId) return '你想问哪家门店？例如：Super Tetsudo 六月营业额。';
  if (tool === 'productAmbiguous') return `数据里有多个商品包含你提到的名字：${args.candidates.join('、')}。请说得更具体些，例如「牛肉poke」。`;
  if (tool === 'notFound') return `数据中没有找到「${args.entity}」相关的销售记录。`;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(args.from || '') || !/^\d{4}-\d{2}-\d{2}$/.test(args.to || '')) {
    return '请给出有效的日期范围（YYYY-MM-DD）。';
  }
  return null;
}

export function createChatHandler(queries, { llmMode = 'auto', llmConfig = null } = {}) {
  const useRealLLM = llmMode === 'deepseek' || (llmMode === 'auto' && llmConfig?.apiKey);

  return async function chat({ message, history = [] }) {
    const meta = queries.meta();
    let intent = null;
    let llmError = null;

    if (useRealLLM) {
      try {
        const res = await callToolLLM({
          messages: buildMessages(meta, history, message),
          tools: toolSchemas(),
          config: llmConfig,
        });
        if (res.fallback) intent = null;
        else intent = { tool: res.tool, args: res.args };
      } catch (e) {
        llmError = e.message;
        intent = null;
      }
    }

    if (!intent) {
      const mock = mockResolveIntent({ message, history, meta });
      if (mock) intent = mock;
    }

    if (!intent || (!TOOL_NAMES.includes(intent.tool) && intent.tool !== 'productAmbiguous' && intent.tool !== 'notFound')) {
      return {
        answer: FALLBACK_ANSWER,
        intent: null,
        data: null,
        chartState: null,
        source: { mode: useRealLLM ? 'deepseek' : 'mock', llmError: llmError || null, fallback: true },
      };
    }

    const guide = validateArgs(intent.tool, intent.args);
    if (guide) {
      return {
        answer: guide,
        intent: { tool: intent.tool, args: intent.args },
        data: null,
        chartState: null,
        source: { mode: useRealLLM ? 'deepseek' : 'mock', guide: true },
      };
    }

    const t0 = Date.now();
    let result;
    try {
      result = executeTool(queries, intent.tool, intent.args);
    } catch (e) {
      return {
        answer: `查询出错了：${e.message}。`,
        intent: { tool: intent.tool, args: intent.args },
        data: null,
        chartState: null,
        source: { mode: useRealLLM ? 'deepseek' : 'mock', error: e.message },
      };
    }
    const execMs = Date.now() - t0;

    const { answer, chartState } = renderAnswer(intent.tool, intent.args, result);
    // 数字校验器：答案必须包含工具结果的关键数字（确定性模板下恒真，作为安全网）
    try {
      verifyAnswer(answer, keyFigures(intent.tool, result));
    } catch (e) {
      console.error('[verifier]', e.message);
    }

    const rows = Array.isArray(result.items) ? result.items.length : result.perDay ? result.perDay.length : 1;
    return {
      answer,
      intent: { tool: intent.tool, args: intent.args },
      data: result,
      chartState,
      source: {
        mode: useRealLLM ? 'deepseek' : 'mock',
        tool: intent.tool,
        sql: SOURCE_DESCRIPTION[intent.tool],
        rows,
        execMs,
      },
    };
  };
}
