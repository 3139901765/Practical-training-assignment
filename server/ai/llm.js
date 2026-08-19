/**
 * DeepSeek（OpenAI 兼容）工具调用客户端。
 * 只负责「自然语言 → 工具调用」，数字仍由服务端 SQL 执行产出。
 */

const TIMEOUT_MS = 20000;

export async function callToolLLM({ messages, tools, config }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const url = `${config.baseUrl.replace(/\/$/, '')}/chat/completions`;
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        model: config.model,
        messages,
        tools,
        tool_choice: 'auto',
        temperature: 0,
      }),
      signal: controller.signal,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`LLM API ${res.status}: ${text.slice(0, 200)}`);
    }
    const data = await res.json();
    const choice = data.choices?.[0]?.message;
    const toolCall = choice?.tool_calls?.[0];
    if (toolCall?.function?.name) {
      let args = {};
      try { args = JSON.parse(toolCall.function.arguments || '{}'); } catch { args = {}; }
      return { tool: toolCall.function.name, args };
    }
    const content = (choice?.content || '').trim();
    if (content.includes('FALLBACK')) return { fallback: true };
    // 模型没走工具也没说 FALLBACK：视为无法回答，绝不放行自由文本数字
    return { fallback: true };
  } finally {
    clearTimeout(timer);
  }
}
