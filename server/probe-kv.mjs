/**
 * KV 缓存复用实测脚本
 *
 * 用法：node probe-kv.mjs [port]
 *
 * 做法：串起一段多轮对话，逐轮记录
 *   - 客户端侧首字延迟（从发出请求到收到第一个正文增量）
 *   - 服务端返回的 metrics（预填充量、复用 token、预填充耗时）
 * 同一组问题分别在 KV_REUSE=1 / KV_REUSE=0 下各跑一次即可对比。
 */
const PORT = Number(process.argv[2] ?? 8099);
const BASE = `http://127.0.0.1:${PORT}`;

const QUESTIONS = [
  "用一句话说明什么是 KV 缓存。",
  "再补一句：它为什么对本地推理特别重要？",
  "把前两句合并成一句更短的话。",
];

/** 发一轮流式请求，返回 { ttftMs, text, metrics, usage } */
async function ask(history, question) {
  const messages = [...history, { role: "user", content: question }];
  const t0 = Date.now();
  const res = await fetch(`${BASE}/v1/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      messages,
      stream: true,
      max_tokens: 160,
      temperature: 0.2,
      thinking: false,
      tools: false,
    }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);

  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  let ttftMs = null;
  let text = "";
  let metrics = null;
  let usage = null;

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const parts = buf.split("\n\n");
    buf = parts.pop();
    for (const p of parts) {
      const line = p.replace(/^data:\s*/, "").trim();
      if (!line || line === "[DONE]") continue;
      let j;
      try {
        j = JSON.parse(line);
      } catch {
        continue;
      }
      const d = j.choices?.[0]?.delta;
      if (d && (d.content || d.reasoning_content)) {
        if (ttftMs === null) ttftMs = Date.now() - t0;
        text += d.content ?? "";
      }
      if (j.metrics) metrics = j.metrics;
      if (j.usage) usage = j.usage;
    }
  }
  return { ttftMs, text, metrics, usage };
}

const state = await fetch(`${BASE}/api/state`).then((r) => r.json());
console.log(`模型: ${state.loaded} | context ${state.context} | KV_REUSE=${state.kvReuse} | gpu ${state.gpu}`);
console.log("轮次 | 客户端首字 | 服务端 ttft | 预填充 token | 复用 token | 复用率 | 生成 tok/s");
console.log("-----|-----------|------------|-------------|-----------|--------|----------");

const history = [];
for (let i = 0; i < QUESTIONS.length; i++) {
  const { ttftMs, text, metrics } = await ask(history, QUESTIONS[i]);
  const m = metrics ?? {};
  console.log(
    `  ${i + 1}  | ${String(ttftMs).padStart(7)}ms | ${String(m.ttftMs ?? "-").padStart(8)}ms | ` +
      `${String(m.prefillTokens ?? "-").padStart(11)} | ${String(m.reusedTokens ?? "-").padStart(9)} | ` +
      `${String(Math.round((m.cacheHit ?? 0) * 100)).padStart(5)}% | ${String(m.tokPerSec ?? "-").padStart(8)}`,
  );
  console.log(`     回复：${text.replace(/\s+/g, " ").slice(0, 70)}`);
  history.push({ role: "user", content: QUESTIONS[i] });
  history.push({ role: "assistant", content: text });
}

// 换个话题（历史完全不同）——验证前缀对不上时的回退路径依然正确
const { ttftMs, text, metrics } = await ask([], "9 的平方根是多少？只回答数字。");
console.log(
  `新话题| ${String(ttftMs).padStart(7)}ms | 预填充 ${metrics?.prefillTokens} tok | 复用 ${metrics?.reusedTokens} tok | ` +
    `回复：${text.trim().slice(0, 40)}`,
);
