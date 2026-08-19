import { useEffect, useRef, useState } from 'react';

const SUGGESTIONS = [
  '哪个品类的门店营业额最高？',
  '牛肉poke 六月卖了多少钱？',
  '客单价最近是涨了还是跌了？',
  'Top 10 商品排行？',
];

export default function ChatPanel({ messages, sending, onSend }) {
  const [input, setInput] = useState('');
  const listRef = useRef(null);

  useEffect(() => {
    if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight;
  }, [messages, sending]);

  const submit = (text) => {
    const t = (text ?? input).trim();
    if (!t || sending) return;
    onSend(t);
    setInput('');
  };

  return (
    <section className="card chat-card">
      <div className="card-head">
        <h2>数据问答</h2>
        <span className="badge">AI</span>
      </div>
      <div className="chat-list" ref={listRef}>
        {messages.length === 0 && (
          <div className="chat-empty">
            <p>问它任何经营数据问题，答案里的数字都来自数据库真实查询。</p>
            <div className="chips">
              {SUGGESTIONS.map((s) => (
                <button key={s} className="chip" onClick={() => submit(s)}>{s}</button>
              ))}
            </div>
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i} className={`msg ${m.role}`}>
            {m.role === 'user' ? (
              <div className="bubble user">{m.content}</div>
            ) : (
              <div className="bubble ai">
                <div className="ai-answer">{m.content}</div>
                {m.source && (
                  <div className="ai-source">
                    <span className={`mode ${m.source.mode}`}>{m.source.mode === 'mock' ? 'mock' : 'DeepSeek'}</span>
                    {m.source.tool && <span>工具：{m.source.tool}</span>}
                    {m.source.rows != null && <span>{m.source.rows} 行</span>}
                    {m.source.execMs != null && <span>{m.source.execMs}ms</span>}
                  </div>
                )}
                {m.chartState && (
                  <div className="ai-link">
                    <span>✓ 已联动图表</span>
                    <span className="muted">{m.chartState.from} ~ {m.chartState.to}</span>
                  </div>
                )}
              </div>
            )}
          </div>
        ))}
        {sending && (
          <div className="msg assistant">
            <div className="bubble ai typing"><span /> <span /> <span /></div>
          </div>
        )}
      </div>
      <div className="chat-input">
        <input
          value={input}
          placeholder="例如：牛肉poke 六月卖了多少钱？"
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && submit()}
        />
        <button className="send" disabled={sending} onClick={() => submit()}>发送</button>
      </div>
    </section>
  );
}
