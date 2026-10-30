/**
 * 验证「界面上的缓存命中显示」：直接取 app.html 里的 formatStats 来渲染真实 metrics，
 * 保证展示效果和用户看到的完全一致（而不是我照着重写一遍）。
 *
 *   node probe-ui-metric.mjs [port]
 */
import { readFile } from "node:fs/promises";

const PORT = Number(process.argv[2] ?? 8099);
const BASE = `http://127.0.0.1:${PORT}`;

// 从界面源码里抠出 formatStats 本体，原样复用
const html = await readFile(new URL("./app.html", import.meta.url), "utf8");
const src = html.match(/function formatStats\(usage, metrics\) \{[\s\S]*?\n\}/);
if (!src) throw new Error("没在 app.html 里找到 formatStats");
const formatStats = new Function(`${src[0]}; return formatStats;`)();

async function ask(history, question) {
  const res = await fetch(`${BASE}/v1/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      messages: [{ role: "system", content: "你是一个简洁的中文助手。" }, ...history, { role: "user", content: question }],
      stream: true,
      max_tokens: 90,
      temperature: 0.2,
    }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  let text = "";
  let usage = null;
  let metrics = null;
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
      try { j = JSON.parse(line); } catch { continue; }
      const d = j.choices?.[0]?.delta;
      if (d?.content) text += d.content;
      if (j.usage) usage = j.usage;
      if (j.metrics) metrics = j.metrics;
    }
  }
  return { text, usage, metrics };
}

const history = [];
for (const q of ["KV 缓存是什么？一句话。", "它为什么能加快多轮对话？"]) {
  const { text, usage, metrics } = await ask(history, q);
  console.log(`问：${q}`);
  console.log(`答：${text.replace(/\s+/g, " ").slice(0, 50)}`);
  console.log(`界面指标行 → ${formatStats(usage, metrics)}`);
  console.log(`原始字段   → reused=${metrics.reusedTokens} prefill=${metrics.prefillTokens} hit=${metrics.cacheHit} ttft=${metrics.ttftMs}ms\n`);
  history.push({ role: "user", content: q }, { role: "assistant", content: text });
}
