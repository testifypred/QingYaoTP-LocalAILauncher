/**
 * 对比"分片"与"单片"两个 qwen2.5-7b 变体的加载与推理性能。
 *   node probe-shard-bench.mjs
 *
 * 每个模型：加载一次 → 新对话连问三轮（第一轮冷 KV，后两轮复用前缀）。
 * 指标全部取服务端返回的 metrics，避免客户端计时误差。
 */
const BASE = "http://127.0.0.1:8099";
const MODELS = [
  { tag: "分片", file: "qwen2.5-7b-instruct-q4_k_m-00001-of-00002.gguf" },
  { tag: "单片", file: "qwen2.5-7b-instruct-1m-q4_k_m.gguf" },
];
const QUESTIONS = ["用一句话解释什么是 KV 缓存。", "那它对显存有什么影响？", "总结成一句更短的话。"];
const SYS = "你是一个简洁的中文助手。";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function ask(history, question) {
  const body = {
    messages: [{ role: "system", content: SYS }, ...history, { role: "user", content: question }],
    stream: true,
    max_tokens: 96,
    temperature: 0,
  };
  const res = await fetch(`${BASE}/v1/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${(await res.text()).slice(0, 160)}`);
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  let text = "";
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
      try {
        j = JSON.parse(line);
      } catch {
        continue;
      }
      if (j.choices?.[0]?.delta?.content) text += j.choices[0].delta.content;
      if (j.metrics) metrics = j.metrics;
    }
  }
  return { text, metrics };
}

const rows = [];
for (const m of MODELS) {
  console.log(`\n=== ${m.tag}：${m.file} ===`);
  const t0 = Date.now();
  const lr = await fetch(`${BASE}/api/load`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ file: m.file, contextSize: 16384 }),
  });
  const lj = await lr.json();
  if (!lr.ok) throw new Error("加载失败 " + JSON.stringify(lj));
  const loadMs = Date.now() - t0;
  console.log(`加载 ${lj.seconds}s（客户端测得 ${(loadMs / 1000).toFixed(1)}s），${lj.layers} 层`);
  await sleep(1000);

  const history = [];
  const turn = [];
  for (const q of QUESTIONS) {
    const { text, metrics } = await ask(history, q);
    turn.push(metrics);
    console.log(
      `  ${turn.length}. ttft ${metrics.ttftMs}ms · 预填充 ${metrics.prefillTokens} tok (${metrics.promptTokPerSec} tok/s) · ` +
        `复用 ${Math.round(metrics.cacheHit * 100)}% · 生成 ${metrics.tokPerSec} tok/s`,
    );
    history.push({ role: "user", content: q }, { role: "assistant", content: text });
  }
  rows.push({ ...m, loadS: lj.seconds, turns: turn });
}

console.log("\n\n对比");
console.log("模型 | 加载 | 冷首字 | 冷预填充 | 生成速度 | 热首字 | 复用率");
console.log("-----|------|--------|----------|----------|--------|------");
for (const r of rows) {
  const cold = r.turns[0];
  const warm = r.turns[1];
  console.log(
    `${r.tag} | ${r.loadS}s | ${cold.ttftMs}ms | ${cold.promptTokPerSec} tok/s | ${cold.tokPerSec} tok/s | ` +
      `${warm.ttftMs}ms | ${Math.round(warm.cacheHit * 100)}%`,
  );
}
